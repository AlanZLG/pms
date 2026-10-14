import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject, seedTask } from './helpers/test-db'
import { opLogRepo, hoursRepo } from '../api/repository/repo.ts'
import { findOrCreateFallbackTask, resolveOpLogTaskId, syncOpLogHours, OPLOG_FALLBACK_TASK_TITLE } from '../api/routes/opLogs.ts'
import { ApiError } from '../api/lib/utils.ts'

function run(fn: () => void): ApiError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
  throw new Error('期望抛出 ApiError，但未抛出')
}

describe('台账工时入账（v1.9.4 方案 A：台账为录入入口，工时自动落到任务）', () => {
  let userId: string, projectId: string

  beforeEach(() => {
    db.prepare('DELETE FROM task_hours').run()
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    userId = seedUser(db, { email: 'hs-u@pm.dev', name: '运维员' })
    projectId = seedProject(db, userId, { name: '运维项目' })
  })

  describe('兜底任务 findOrCreateFallbackTask', () => {
    it('首次调用为项目创建「运维日常工作」任务', () => {
      const t = findOrCreateFallbackTask(projectId)
      expect(t.title).toBe(OPLOG_FALLBACK_TASK_TITLE)
      expect(t.projectId).toBe(projectId)
    })

    it('再次调用复用同一任务，不重复创建', () => {
      const t1 = findOrCreateFallbackTask(projectId)
      const t2 = findOrCreateFallbackTask(projectId)
      expect(t2.id).toBe(t1.id)
      const cnt = db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id = ? AND title = ?').get(projectId, OPLOG_FALLBACK_TASK_TITLE) as { c: number }
      expect(cnt.c).toBe(1)
    })
  })

  describe('关联任务解析 resolveOpLogTaskId', () => {
    it('显式指定合法任务 → 返回该任务 id', () => {
      const tid = seedTask(db, projectId, { title: '指定任务' })
      expect(resolveOpLogTaskId(projectId, 2, tid, null)).toBe(tid)
    })

    it('显式指定其他项目的任务 → 400', () => {
      const otherProject = seedProject(db, userId, { name: '其他项目' })
      const tid = seedTask(db, otherProject, { title: '别家任务' })
      const e = run(() => resolveOpLogTaskId(projectId, 2, tid, null))
      expect(e.status).toBe(400)
    })

    it('未指定且有工时 → 归集到兜底任务；无工时 → 不关联', () => {
      const tid = resolveOpLogTaskId(projectId, 3, '', null)
      expect(tid).toBeTruthy()
      const t = db.prepare('SELECT title FROM tasks WHERE id = ?').get(tid) as { title: string }
      expect(t.title).toBe(OPLOG_FALLBACK_TASK_TITLE)
      expect(resolveOpLogTaskId(projectId, 0, '', null)).toBeNull()
    })

    it('未指定但已有合法关联 → 沿用现有任务', () => {
      const tid = seedTask(db, projectId, { title: '既有关联' })
      expect(resolveOpLogTaskId(projectId, 2, undefined, tid)).toBe(tid)
    })
  })

  describe('创建/编辑/删除联动 syncOpLogHours', () => {
    it('创建带工时台账（不指定任务）→ 自动入账到兜底任务，台账带 taskId 且 hoursSynced=true', () => {
      const log = opLogRepo.create(userId, { projectId, problem: '服务器宕机', hours: 3.5, logDate: '2026-09-20' })
      const taskId = resolveOpLogTaskId(projectId, 3.5, undefined, null)
      opLogRepo.update(log.id, { taskId })
      syncOpLogHours(log, taskId)

      const after = opLogRepo.findById(log.id)!
      expect(after.taskId).toBe(taskId)
      expect(after.hoursSynced).toBe(true)

      const rows = db.prepare('SELECT * FROM task_hours WHERE op_log_id = ?').all(log.id) as { task_id: string; actual_hours: number; billed_hours: number; date: string; rate_snapshot: number }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].task_id).toBe(taskId)
      expect(rows[0].actual_hours).toBe(3.5)
      expect(rows[0].billed_hours).toBe(3.5)
      expect(rows[0].date).toBe('2026-09-20')
      expect(Number(rows[0].rate_snapshot)).toBeGreaterThan(0)
    })

    it('编辑台账工时/日期 → 入账记录同步更新；工时清零 → 记录删除', () => {
      const log = opLogRepo.create(userId, { projectId, problem: '接口报错', hours: 2, logDate: '2026-09-21' })
      const taskId = resolveOpLogTaskId(projectId, 2, undefined, null)
      syncOpLogHours(log, taskId)

      const edited = opLogRepo.update(log.id, { hours: 5, logDate: '2026-09-22' })!
      syncOpLogHours(edited, taskId)
      const row = db.prepare('SELECT actual_hours, date FROM task_hours WHERE op_log_id = ?').get(log.id) as { actual_hours: number; date: string }
      expect(row.actual_hours).toBe(5)
      expect(row.date).toBe('2026-09-22')

      const cleared = opLogRepo.update(log.id, { hours: 0 })!
      syncOpLogHours(cleared, taskId)
      const cnt = db.prepare('SELECT COUNT(*) c FROM task_hours WHERE op_log_id = ?').get(log.id) as { c: number }
      expect(cnt.c).toBe(0)
    })

    it('删除台账 → 入账记录联动清除（与路由层同口径）', () => {
      const log = opLogRepo.create(userId, { projectId, problem: '数据库慢查询', hours: 4, logDate: '2026-09-23' })
      const taskId = resolveOpLogTaskId(projectId, 4, undefined, null)
      syncOpLogHours(log, taskId)
      expect((db.prepare('SELECT COUNT(*) c FROM task_hours WHERE op_log_id = ?').get(log.id) as { c: number }).c).toBe(1)

      opLogRepo.softDelete(log.id)
      db.prepare('DELETE FROM task_hours WHERE op_log_id = ?').run(log.id)
      expect((db.prepare('SELECT COUNT(*) c FROM task_hours WHERE op_log_id = ?').get(log.id) as { c: number }).c).toBe(0)
    })

    it('手动登记不与台账入账记录混写：同任务同人同天各自独立成条', () => {
      const log = opLogRepo.create(userId, { projectId, problem: '磁盘告警', hours: 8, logDate: '2026-09-24' })
      const taskId = resolveOpLogTaskId(projectId, 8, undefined, null)
      syncOpLogHours(log, taskId)

      // 同任务同人同天手动登记 1h（台账记录 8h 不受影响）
      const rec = hoursRepo.create({ taskId: taskId!, userId, date: '2026-09-24', actualHours: 1, billedHours: 1 })
      expect(rec.actualHours).toBe(1)

      const rows = db.prepare('SELECT id, op_log_id, actual_hours FROM task_hours WHERE task_id = ? AND date = ? ORDER BY actual_hours').all(taskId, '2026-09-24') as { id: string; op_log_id: string | null; actual_hours: number }[]
      expect(rows).toHaveLength(2)
      // 升序：1h 手动记录在前（无 op_log_id），8h 台账入账记录在后
      expect(rows[0].op_log_id).toBeNull()
      expect(rows[0].actual_hours).toBe(1)
      expect(rows[1].op_log_id).toBe(log.id)
      expect(rows[1].actual_hours).toBe(8)
    })

    it('单条 8h 不受 20% 上限影响（豁免由入账路径天然保证）', () => {
      const tid = seedTask(db, projectId, { title: '有计划的任务', plannedHours: 10 })
      const log = opLogRepo.create(userId, { projectId, problem: '整日运维', hours: 8, logDate: '2026-09-25', taskId: tid })
      syncOpLogHours(log, tid)
      const row = db.prepare('SELECT actual_hours FROM task_hours WHERE op_log_id = ?').get(log.id) as { actual_hours: number }
      expect(row.actual_hours).toBe(8)
    })
  })
})
