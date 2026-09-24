// 项目负责人指派（transferOwnership）单测：owner 变更 + 成员行升级/降级
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject, seedTask } from './helpers/test-db'
import { projectRepo, taskRepo, activityLogRepo } from '../api/repository/repo.ts'

describe('指派项目负责人（projectRepo.transferOwnership）', () => {
  beforeEach(() => {
    for (const t of ['task_hours', 'project_budgets', 'task_history', 'saved_filters',
      'notifications', 'comments', 'subtasks', 'op_logs', 'tasks', 'project_members', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
  })

  it('转移后 owner_id 变更，新负责人（原成员 editor）升级为 owner，原负责人降为 editor', () => {
    const ownerId = seedUser(db, { role: 'owner' })
    const memberId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, ownerId, { name: '项目' })
    // 模拟真实创建路径：owner 与成员都在项目成员表中
    db.prepare("INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)")
      .run('m-row-0', pid, ownerId, 'owner', new Date().toISOString())
    // 成员已在项目成员表中（editor 角色）
    db.prepare("INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)")
      .run('m-row-1', pid, memberId, 'editor', new Date().toISOString())

    const updated = projectRepo.transferOwnership(pid, memberId, ownerId)
    expect(updated?.ownerId).toBe(memberId)
    // 新负责人成员行升级 owner
    const newRow = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(pid, memberId) as { role: string }
    expect(newRow.role).toBe('owner')
    // 原负责人成员行降级 editor
    const oldRow = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(pid, ownerId) as { role: string }
    expect(oldRow.role).toBe('editor')
  })

  it('新负责人不是成员时补插 owner 成员行；重复转移幂等清理旧 owner 行', () => {
    const ownerId = seedUser(db, { role: 'owner' })
    const outsiderId = seedUser(db, { role: 'member' })
    const thirdId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, ownerId, { name: '项目' })

    projectRepo.transferOwnership(pid, outsiderId, ownerId)
    // 局外人被补插为 owner 成员行
    const rows = db.prepare('SELECT user_id, role FROM project_members WHERE project_id = ?').all(pid) as Array<{ user_id: string; role: string }>
    expect(rows.find((r) => r.user_id === outsiderId)?.role).toBe('owner')
    // 二次转移给第三人：第三人成为 owner，局外人成员行降为 editor（仍在成员表）
    projectRepo.transferOwnership(pid, thirdId, outsiderId)
    const again = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(pid, thirdId) as { role: string }
    expect(again.role).toBe('owner')
    const prev = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(pid, outsiderId) as { role: string }
    expect(prev.role).toBe('editor')
    // 项目 owner_id 已指向第三人
    const p = projectRepo.findById(pid)!
    expect(p.ownerId).toBe(thirdId)
  })
})

describe('人员替换（taskRepo.reassignProjectTasks）', () => {
  beforeEach(() => {
    for (const t of ['task_hours', 'project_budgets', 'task_history', 'saved_filters',
      'notifications', 'comments', 'subtasks', 'op_logs', 'tasks', 'project_members', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
  })

  it('主任务与子任务指派批量替换，计数正确，且只影响本项目', () => {
    const fromId = seedUser(db, { role: 'member' })
    const toId = seedUser(db, { role: 'member' })
    const otherId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, fromId, { name: '目标项目' })
    const otherPid = seedProject(db, fromId, { name: '别的项目' })
    const t1 = seedTask(db, pid, { assigneeId: fromId })
    const t2 = seedTask(db, pid, { assigneeId: fromId })
    const otherIdTask = seedTask(db, pid, { assigneeId: otherId }) // 非目标成员任务不动
    seedTask(db, otherPid, { assigneeId: fromId }) // 别的项目不动
    for (const tid of [t1, t2]) {
      db.prepare('INSERT INTO subtasks (id, task_id, title, assignee_id) VALUES (?,?,?,?)')
        .run(`sub-${tid}`, tid, '子任务', fromId)
    }

    const r = taskRepo.reassignProjectTasks(pid, fromId, toId)
    expect(r.taskIds.sort()).toEqual([t1, t2].sort())
    expect(r.subtaskCount).toBe(2)
    const assigned = (v: string) => (db.prepare('SELECT assignee_id a FROM tasks WHERE id = ?').get(v) as { a: string | null }).a
    expect(assigned(t1)).toBe(toId)
    expect(assigned(t2)).toBe(toId)
    // 子任务全部转移
    const subs = db.prepare('SELECT COUNT(*) c FROM subtasks WHERE assignee_id = ?').get(toId) as { c: number }
    expect(subs.c).toBe(2)
    // 别的项目与其他成员任务不受影响
    const otherTask = db.prepare('SELECT assignee_id a FROM tasks WHERE project_id = ?').get(otherPid) as { a: string }
    expect(otherTask.a).toBe(fromId)
    const otherAssignee = db.prepare('SELECT assignee_id a FROM tasks WHERE id = ?').get(otherIdTask) as { a: string }
    expect(otherAssignee.a).toBe(otherId)
  })

  it('软删除任务不参与替换', () => {
    const fromId = seedUser(db, { role: 'member' })
    const toId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, fromId, { name: '项目' })
    seedTask(db, pid, { assigneeId: fromId })
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE project_id = ?').run(new Date().toISOString(), pid)

    const r = taskRepo.reassignProjectTasks(pid, fromId, toId)
    expect(r.taskIds).toHaveLength(0)
    expect(r.subtaskCount).toBe(0)
  })

  it('项目操作日志写入与查询（activityLogRepo）', () => {
    const uid = seedUser(db, { role: 'admin' })
    const pid = seedProject(db, uid, { name: '项目' })
    activityLogRepo.create(pid, uid, 'reassign', '人员替换: 成员甲 → 成员乙，涉及 2 个任务、1 个子任务')
    activityLogRepo.create(pid, uid, 'owner_transfer', '项目负责人: 成员甲 → 成员乙')

    const rows = activityLogRepo.findByProject(pid)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.action).sort()).toEqual(['owner_transfer', 'reassign'])
    const reassignRow = rows.find((r) => r.action === 'reassign')!
    expect(reassignRow.detail).toContain('涉及 2 个任务')
    expect(reassignRow.userName).toBeTruthy()
    // 空项目日志为空数组
    const otherPid = seedProject(db, uid, { name: '干净项目' })
    expect(activityLogRepo.findByProject(otherPid)).toHaveLength(0)
  })
})
