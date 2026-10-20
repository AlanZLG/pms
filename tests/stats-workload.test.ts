import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject, seedTask, genId } from './helpers/test-db'
import { userRepo } from '../api/repository/repo.ts'
import { computeWorkload } from '../api/routes/stats.ts'

const DAY = 86400000
const dateStr = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)

/** 插入测试工时登记（task_hours），返回记录 id */
function seedHours(taskId: string, userId: string, date: string, actualHours: number): string {
  const id = genId()
  db.prepare(
    'INSERT INTO task_hours (id, task_id, user_id, date, planned_hours, actual_hours, billed_hours, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, taskId, userId, date, 0, actualHours, 0, '', new Date().toISOString())
  return id
}

describe('成员工作量 computeWorkload 双口径', () => {
  let adminId: string

  beforeEach(() => {
    db.prepare('DELETE FROM task_hours').run()
    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    adminId = seedUser(db, { email: 'wl-admin@pm.dev', name: '管理员', role: 'admin' })
  })

  it('任务数口径：total/done/inProgress 按指派人统计，无指派任务不计入', () => {
    const pid = seedProject(db, adminId, { name: 'P1' })
    seedTask(db, pid, { title: 'A', status: 'done', assigneeId: adminId })
    seedTask(db, pid, { title: 'B', status: 'in_progress', assigneeId: adminId })
    seedTask(db, pid, { title: 'C', status: 'todo', assigneeId: adminId })
    seedTask(db, pid, { title: '审核', status: 'review', assigneeId: adminId })
    seedTask(db, pid, { title: 'X', status: 'done' }) // 无指派人

    const item = computeWorkload(userRepo.findById(adminId)!, '', 0).find((i) => i.userId === adminId)!
    expect(item.total).toBe(4) // 含全部状态
    expect(item.done).toBe(1)
    expect(item.inProgress).toBe(1)
  })

  it('工时口径：计划工时取任务字段，实绩按任务归属汇总（与 Excel 导出同口径）', () => {
    const pid = seedProject(db, adminId, { name: 'P1' })
    const t1 = seedTask(db, pid, { title: 'A', status: 'done', assigneeId: adminId, plannedHours: 8 })
    const t2 = seedTask(db, pid, { title: 'B', status: 'in_progress', assigneeId: adminId, plannedHours: 3.5 })
    seedTask(db, pid, { title: 'C', status: 'todo', assigneeId: adminId }) // 未填计划工时 → 计 0
    seedHours(t1, adminId, dateStr(0), 2.5)
    seedHours(t1, adminId, dateStr(0), 1.25) // 同日重复登记累加
    seedHours(t2, adminId, dateStr(0), 4)

    const item = computeWorkload(userRepo.findById(adminId)!, '', 0).find((i) => i.userId === adminId)!
    expect(item.total).toBe(3)
    expect(item.plannedHours).toBe(11.5)
    expect(item.actualHours).toBe(7.75)
  })

  it('工时归属按任务指派：任务指派给 A、工时由 B 登记 → 实绩归 A，B 不计', () => {
    const pid = seedProject(db, adminId, { name: 'P1' })
    const otherId = seedUser(db, { email: 'wl-other@pm.dev', name: '同事', role: 'guest' })
    const t = seedTask(db, pid, { title: 'A任务', status: 'in_progress', assigneeId: adminId })
    seedHours(t, otherId, dateStr(0), 3) // 登记人 ≠ 指派人

    const items = computeWorkload(userRepo.findById(adminId)!, '', 0)
    expect(items.find((i) => i.userId === adminId)!.actualHours).toBe(3)
    expect(items.find((i) => i.userId === otherId)!.actualHours).toBe(0)
  })

  it('时间窗口：任务按 updated_at 过滤，实绩工时按工时日期过滤', () => {
    const pid = seedProject(db, adminId, { name: 'P1' })
    const tOld = seedTask(db, pid, { title: '旧任务', status: 'done', assigneeId: adminId, plannedHours: 5 })
    seedTask(db, pid, { title: '新任务', status: 'todo', assigneeId: adminId, plannedHours: 2 })
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 20 * DAY).toISOString(), tOld)
    seedHours(tOld, adminId, dateStr(-10), 3) // 窗口外
    seedHours(tOld, adminId, dateStr(-1), 2) // 窗口内

    const item = computeWorkload(userRepo.findById(adminId)!, '', 7).find((i) => i.userId === adminId)!
    expect(item.total).toBe(1) // 旧任务 20 天前更新，被窗口排除
    expect(item.plannedHours).toBe(2)
    expect(item.actualHours).toBe(2) // 只算 1 天前的登记
  })

  it('可见范围：guest 只统计自己参与项目的任务与工时', () => {
    const guestId = seedUser(db, { email: 'wl-guest@pm.dev', name: '访客', role: 'guest' })
    const pidA = seedProject(db, adminId, { name: '项目A' })
    const pidB = seedProject(db, adminId, { name: '项目B' })
    // guest 是 A 的成员（测试库不自动建 owner 成员记录），与 B 无关
    db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
      .run(genId(), pidA, guestId, 'viewer')
    const tA = seedTask(db, pidA, { title: 'A任务', status: 'todo', assigneeId: guestId, plannedHours: 4 })
    seedTask(db, pidB, { title: 'B任务', status: 'todo', assigneeId: guestId, plannedHours: 9 }) // 不可见
    seedHours(tA, guestId, dateStr(0), 1.5)
    const tB = seedTask(db, pidB, { title: 'B任务2', status: 'todo', assigneeId: adminId })
    seedHours(tB, guestId, dateStr(0), 5) // B 项目工时不可见

    const items = computeWorkload(userRepo.findById(guestId)!, '', 0)
    // 成员清单 = 自己 + 可见项目（A）成员（guest），不含 admin
    expect(items.map((i) => i.userId)).toEqual([guestId])
    const me = items[0]
    expect(me.total).toBe(1)
    expect(me.plannedHours).toBe(4)
    expect(me.actualHours).toBe(1.5)
  })

  it('可见范围：指定越权项目 → 空结果；admin 指定项目只统计该项目', () => {
    const guestId = seedUser(db, { email: 'wl-guest2@pm.dev', name: '访客2', role: 'guest' })
    const pidA = seedProject(db, adminId, { name: '项目A' })
    const pidB = seedProject(db, adminId, { name: '项目B' })
    seedTask(db, pidA, { title: 'A1', status: 'todo', assigneeId: adminId, plannedHours: 2 })
    seedTask(db, pidB, { title: 'B1', status: 'todo', assigneeId: adminId, plannedHours: 6 })
    const tB = db.prepare('SELECT id FROM tasks WHERE title = ?').get('B1') as { id: string }

    // guest 访问未参与项目 → 空数组
    expect(computeWorkload(userRepo.findById(guestId)!, pidA, 0)).toEqual([])

    // admin 指定项目 B → 只统计 B 的任务
    const admin = userRepo.findById(adminId)!
    const items = computeWorkload(admin, pidB, 0)
    const me = items.find((i) => i.userId === adminId)!
    expect(me.total).toBe(1)
    expect(me.plannedHours).toBe(6)
    // 实绩工时也只算项目 B
    seedHours(tB.id, adminId, dateStr(0), 1)
    expect(computeWorkload(admin, pidB, 0).find((i) => i.userId === adminId)!.actualHours).toBe(1)
  })
})
