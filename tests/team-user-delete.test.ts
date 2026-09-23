// 用户管理：删除成员的关联清理与守卫单测
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject, seedTask, seedOpLog } from './helpers/test-db'
import { userRepo } from '../api/repository/repo.ts'

describe('删除成员关联清理（userRepo.deleteWithCleanup）', () => {
  beforeEach(() => {
    for (const t of [
      'task_hours', 'project_budgets', 'task_history', 'saved_filters',
      'notifications', 'comments', 'subtasks', 'op_logs', 'tasks',
      'project_members', 'projects', 'users',
    ]) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
  })

  it('名下项目负责人转移给管理员并补 owner 成员行', () => {
    const adminId = seedUser(db, { role: 'admin' })
    const memberId = seedUser(db, { role: 'member' })
    const p1 = seedProject(db, memberId, { name: '成员项目一' })
    const p2 = seedProject(db, memberId, { name: '成员项目二' })

    const r = userRepo.deleteWithCleanup(memberId, adminId)
    expect(r.transferredProjects).toBe(2)
    expect(userRepo.findById(memberId)).toBeNull()
    for (const pid of [p1, p2]) {
      expect((db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(pid) as { owner_id: string }).owner_id).toBe(adminId)
      const m = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(pid, adminId) as { role: string }
      expect(m.role).toBe('owner')
    }
  })

  it('任务/子任务指派置空，评论/通知/筛选器/操作历史清理', () => {
    const adminId = seedUser(db, { role: 'admin' })
    const memberId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, adminId, { name: '项目' })
    const taskId = seedTask(db, pid, { assigneeId: memberId })
    db.prepare('INSERT INTO subtasks (id, task_id, title, assignee_id) VALUES (?,?,?,?)').run(genId(), taskId, '子任务', memberId)
    db.prepare('INSERT INTO comments (id, task_id, user_id, content) VALUES (?,?,?,?)').run(genId(), taskId, memberId, '评论')
    db.prepare('INSERT INTO notifications (id, user_id, type, title) VALUES (?,?,?,?)').run(genId(), memberId, 'task', '通知')
    db.prepare('INSERT INTO saved_filters (id, user_id, name, filter_config) VALUES (?,?,?,?)').run(genId(), memberId, '筛选', '{}')
    db.prepare('INSERT INTO task_history (id, task_id, user_id, action) VALUES (?,?,?,?)').run(genId(), taskId, memberId, 'update')

    userRepo.deleteWithCleanup(memberId, adminId)
    expect((db.prepare('SELECT assignee_id FROM tasks WHERE id = ?').get(taskId) as { assignee_id: string | null }).assignee_id).toBeNull()
    expect((db.prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ?').get(memberId) as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ?').get(memberId) as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) as c FROM saved_filters WHERE user_id = ?').get(memberId) as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) as c FROM task_history WHERE user_id = ?').get(memberId) as { c: number }).c).toBe(0)
    // 其成员行清理，任务仍归属项目
    expect((db.prepare('SELECT COUNT(*) as c FROM project_members WHERE user_id = ?').get(memberId) as { c: number }).c).toBe(0)
    expect(db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)).toBeTruthy()
  })

  it('预算创建人转移给管理员（项目资产不随人删）', () => {
    const adminId = seedUser(db, { role: 'admin' })
    const memberId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, adminId, { name: '项目' })
    db.prepare('INSERT INTO project_budgets (id, project_id, category, amount, created_by) VALUES (?,?,?,?,?)')
      .run(genId(), pid, 'labor', 1000, memberId)

    userRepo.deleteWithCleanup(memberId, adminId)
    expect((db.prepare('SELECT created_by FROM project_budgets WHERE project_id = ?').get(pid) as { created_by: string }).created_by).toBe(adminId)
  })
})

describe('业务流水守卫计数（userRepo.businessRecordCounts）', () => {
  beforeEach(() => {
    for (const t of ['task_hours', 'op_logs', 'project_expenses', 'attachments', 'tasks', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
  })

  it('有工时/台账时计数 > 0（路由层据此拒绝删除）', () => {
    const uid = seedUser(db, { role: 'member' })
    const pid = seedProject(db, uid)
    const taskId = seedTask(db, pid)
    db.prepare('INSERT INTO task_hours (id, task_id, user_id, date) VALUES (?,?,?,?)').run(genId(), taskId, uid, '2026-09-23')
    seedOpLog(db, uid)

    const counts = userRepo.businessRecordCounts(uid)
    expect(counts.hours).toBe(1)
    expect(counts.opLogs).toBe(1)
    expect(counts.expenses).toBe(0)
    expect(counts.attachments).toBe(0)
  })

  it('干净账号全部计数为 0', () => {
    const uid = seedUser(db, { role: 'member' })
    const counts = userRepo.businessRecordCounts(uid)
    expect(counts).toEqual({ hours: 0, opLogs: 0, expenses: 0, attachments: 0 })
  })
})
