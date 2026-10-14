import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject } from './helpers/test-db'
import { opLogRepo, activityLogRepo } from '../api/repository/repo.ts'

function seedOpLog(projectId: string, userId: string, problem: string) {
  const id = genId()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO op_logs (id, project_id, user_id, category, status, recorder, problem, log_date, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, projectId, userId, '需求变更', '已完成', '测试人', problem, '2026-10-09', now, now)
  return id
}

describe('台账删除审计（v1.10.0：deleted_by + 项目活动日志留痕）', () => {
  let ownerId: string, otherId: string, pid: string

  beforeEach(() => {
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM project_activity_log').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    ownerId = seedUser(db, { email: 'aud-o@pm.dev', name: '负责人' })
    otherId = seedUser(db, { email: 'aud-x@pm.dev', name: '别人' })
    pid = seedProject(db, ownerId, { name: '审计项目' })
  })

  it('softDelete 带操作人：deleted_by 落库', () => {
    const id = seedOpLog(pid, ownerId, '登录页报错')
    expect(opLogRepo.softDelete(id, otherId)).toBe(true)
    const row = db.prepare('SELECT deleted_at, deleted_by FROM op_logs WHERE id = ?').get(id) as { deleted_at: string; deleted_by: string }
    expect(row.deleted_by).toBe(otherId)
    expect(row.deleted_at).toBeTruthy()
  })

  it('不带操作人（兼容旧调用）：deleted_by 为 NULL', () => {
    const id = seedOpLog(pid, ownerId, '接口超时')
    expect(opLogRepo.softDelete(id)).toBe(true)
    const row = db.prepare('SELECT deleted_by FROM op_logs WHERE id = ?').get(id) as { deleted_by: string | null }
    expect(row.deleted_by).toBeNull()
  })

  it('重复删除返回 false，不覆盖首次删除人', () => {
    const id = seedOpLog(pid, ownerId, '报表导出失败')
    opLogRepo.softDelete(id, otherId)
    expect(opLogRepo.softDelete(id, ownerId)).toBe(false)
    const row = db.prepare('SELECT deleted_by FROM op_logs WHERE id = ?').get(id) as { deleted_by: string }
    expect(row.deleted_by).toBe(otherId)
  })

  it('项目活动日志留痕 oplog_delete（删除路由同款调用）', () => {
    const id = seedOpLog(pid, ownerId, '特别统计Excel样式调整')
    opLogRepo.softDelete(id, otherId)
    activityLogRepo.create(pid, otherId, 'oplog_delete', '删除台账「特别统计Excel样式调整」(2026-10-09)')
    const logs = activityLogRepo.findByProject(pid)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('oplog_delete')
    expect(logs[0].userName).toBe('别人')
    expect(logs[0].detail).toContain('特别统计Excel样式调整')
  })
})
