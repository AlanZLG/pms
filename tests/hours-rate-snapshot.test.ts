// 工时单价快照单测：登记时冻结当时生效单价（个人价 > 类别价 > 角色默认价），改价不追溯历史
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject, seedTask, seedCategory, seedUserCost } from './helpers/test-db'
import { hoursRepo, resolveHourlyRate, DEFAULT_RATE_OWNER, DEFAULT_RATE_MEMBER, DEFAULT_RATE_OUTSOURCED } from '../api/repository/repo.ts'

const cleanTables = () => {
  for (const t of ['task_hours', 'project_budgets', 'task_history', 'saved_filters',
    'notifications', 'comments', 'subtasks', 'op_logs', 'tasks', 'project_members', 'projects', 'user_categories', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
}

describe('单价解析（resolveHourlyRate 优先级）', () => {
  beforeEach(cleanTables)

  const setup = (opts: { categoryId?: string; hourlyRate?: number | null; isOutsourced?: boolean; pmRole?: string } = {}) => {
    const userId = seedUser(db, { role: 'member' })
    const ownerId = seedUser(db, { role: 'owner' })
    const pid = seedProject(db, ownerId, { name: '项目' })
    seedUserCost(db, userId, opts)
    if (opts.pmRole) {
      db.prepare('INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)')
        .run(`m-${userId}`, pid, userId, opts.pmRole, new Date().toISOString())
    }
    const taskId = seedTask(db, pid, { title: '任务' })
    return { userId, taskId }
  }

  it('个人时薪优先于一切', () => {
    const catId = seedCategory(db, { name: '外包开发', hourlyRate: 300, isOutsourced: true })
    const { userId, taskId } = setup({ categoryId: catId, hourlyRate: 88 })
    expect(resolveHourlyRate(userId, taskId)).toEqual({ rate: 88, source: 'user' })
  })

  it('无个人价时用类别时薪', () => {
    const catId = seedCategory(db, { name: '内部开发', hourlyRate: 200 })
    const { userId, taskId } = setup({ categoryId: catId })
    expect(resolveHourlyRate(userId, taskId)).toEqual({ rate: 200, source: 'category' })
  })

  it('无个人/类别价时项目负责人用角色默认价 200', () => {
    const { userId, taskId } = setup({ pmRole: 'owner' })
    expect(resolveHourlyRate(userId, taskId)).toEqual({ rate: DEFAULT_RATE_OWNER, source: 'role_owner' })
  })

  it('无个人/类别价时外包标记用角色默认价 125', () => {
    const { userId, taskId } = setup({ isOutsourced: true })
    expect(resolveHourlyRate(userId, taskId)).toEqual({ rate: DEFAULT_RATE_OUTSOURCED, source: 'role_outsourced' })
  })

  it('都未配置时成员用角色默认价 150', () => {
    const { userId, taskId } = setup()
    expect(resolveHourlyRate(userId, taskId)).toEqual({ rate: DEFAULT_RATE_MEMBER, source: 'role_member' })
  })
})

describe('登记工时冻结快照（hoursRepo.create）', () => {
  beforeEach(cleanTables)

  const setup = () => {
    const ownerId = seedUser(db, { role: 'owner' })
    const memberId = seedUser(db, { role: 'member' })
    const pid = seedProject(db, ownerId, { name: '项目' })
    const taskId = seedTask(db, pid, { title: '任务' })
    return { ownerId, memberId, pid, taskId }
  }

  it('创建工时写入当时的单价快照与来源', () => {
    const { memberId, taskId } = setup()
    const h = hoursRepo.create({ taskId, userId: memberId, date: '2026-09-24', actualHours: 8 })
    expect(h.rateSnapshot).toBe(DEFAULT_RATE_MEMBER)
    expect(h.rateSource).toBe('role_member')
  })

  it('同任务同人同日累加工时保留首次快照，不随改价刷新', () => {
    const { memberId, taskId } = setup()
    const h1 = hoursRepo.create({ taskId, userId: memberId, date: '2026-09-24', actualHours: 4 })
    // 改个人价后再登记同一天 → 累加到已有记录，快照保持首价
    seedUserCost(db, memberId, { hourlyRate: 500 })
    const h2 = hoursRepo.create({ taskId, userId: memberId, date: '2026-09-24', actualHours: 4 })
    expect(h2.id).toBe(h1.id)
    expect(h2.actualHours).toBe(8)
    expect(h2.rateSnapshot).toBe(DEFAULT_RATE_MEMBER)
    expect(h2.rateSource).toBe('role_member')
  })

  it('改价不追溯：旧工时快照不变，新工时按新价', () => {
    const catId = seedCategory(db, { name: '外包开发', hourlyRate: 300, isOutsourced: true })
    const { memberId, taskId } = setup()
    seedUserCost(db, memberId, { categoryId: catId })

    const old = hoursRepo.create({ taskId, userId: memberId, date: '2026-09-01', actualHours: 10 })
    expect(old.rateSnapshot).toBe(300)

    // 类别改价：旧工时快照不动，新工时按新价
    db.prepare('UPDATE user_categories SET hourly_rate = ? WHERE id = ?').run(200, catId)
    expect(hoursRepo.findById(old.id)!.rateSnapshot).toBe(300)
    const fresh = hoursRepo.create({ taskId, userId: memberId, date: '2026-09-24', actualHours: 10 })
    expect(fresh.rateSnapshot).toBe(200)
    expect(fresh.rateSource).toBe('category')
  })

  it('修改工时小时数不动快照', () => {
    const { memberId, taskId } = setup()
    const h = hoursRepo.create({ taskId, userId: memberId, date: '2026-09-24', actualHours: 8 })
    hoursRepo.update(h.id, { actualHours: 6 })
    expect(hoursRepo.findById(h.id)!.rateSnapshot).toBe(DEFAULT_RATE_MEMBER)
  })
})
