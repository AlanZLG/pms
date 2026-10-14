import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject, seedTask } from './helpers/test-db'
import { projectRepo, taskRepo } from '../api/repository/repo.ts'
import { computeProjectHealth } from '../api/routes/stats.ts'

const DAY = 86400000
// 固定"今天"：2026-09-29 本地零点（时区 +08:00 与生产一致）
const TODAY0 = new Date('2026-09-29T00:00:00+08:00')

function setDates(projectId: string, startDate: string | null, dueDate: string | null) {
  db.prepare('UPDATE projects SET start_date = ?, due_date = ? WHERE id = ?').run(startDate, dueDate, projectId)
}

function healthOf(projectId: string, now = TODAY0.getTime()) {
  return computeProjectHealth(projectRepo.findById(projectId)!, taskRepo.findByProject(projectId), TODAY0, now)
}

describe('项目健康度 computeProjectHealth（方案 B）', () => {
  let userId: string

  beforeEach(() => {
    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    userId = seedUser(db, { email: 'health-u@pm.dev', name: '健康测试员' })
  })

  it('时间进度按项目起止周期内插：20 天周期过 10 天 → 50%', () => {
    const pid = seedProject(db, userId, { name: '周期项目' })
    setDates(pid, '2026-09-19T00:00:00+08:00', '2026-10-09T00:00:00+08:00')
    const h = healthOf(pid)
    expect(h.timeProgress).toBe(50)
  })

  it('完成率与偏差：4 个任务完成 2 个、时间进度 50% → 偏差 0', () => {
    const pid = seedProject(db, userId, { name: '偏差项目' })
    setDates(pid, '2026-09-19T00:00:00+08:00', '2026-10-09T00:00:00+08:00')
    seedTask(db, pid, { title: 'A', status: 'done' })
    seedTask(db, pid, { title: 'B', status: 'done' })
    seedTask(db, pid, { title: 'C', status: 'in_progress' })
    seedTask(db, pid, { title: 'D', status: 'todo' })
    const h = healthOf(pid)
    expect(h.doneRate).toBe(50)
    expect(h.deviation).toBe(0)
    expect(h.healthScore).toBe(100) // 偏差 0 不扣分，无逾期无密度
    expect(h.healthLevel).toBe('healthy')
  })

  it('项目逾期分级扣分：≤7 天扣 15 / 8-30 天扣 30 / >30 天扣 50', () => {
    const p1 = seedProject(db, userId, { name: '逾期3天' })
    setDates(p1, '2026-08-01T00:00:00+08:00', '2026-09-26T00:00:00+08:00')
    expect(healthOf(p1).overdueDays).toBe(3)
    expect(healthOf(p1).healthScore).toBe(85)
    expect(healthOf(p1).healthLevel).toBe('healthy')

    const p2 = seedProject(db, userId, { name: '逾期10天' })
    setDates(p2, '2026-08-01T00:00:00+08:00', '2026-09-19T00:00:00+08:00')
    expect(healthOf(p2).healthScore).toBe(70)
    expect(healthOf(p2).healthLevel).toBe('warning')

    const p3 = seedProject(db, userId, { name: '逾期40天' })
    setDates(p3, '2026-07-01T00:00:00+08:00', '2026-08-20T00:00:00+08:00')
    expect(healthOf(p3).healthScore).toBe(50)
    expect(healthOf(p3).healthLevel).toBe('danger')
  })

  it('截止日是带时刻的原始时间戳：逾期天数按日归一为 1（而非 floor 出 0）', () => {
    const pid = seedProject(db, userId, { name: '时刻戳逾期' })
    // 北京 9-28 23:00 截止（不足 24 小时但已跨零点），旧算法 floor(1h/86400000)=0
    setDates(pid, '2026-08-01T00:00:00+08:00', '2026-09-28T15:00:00.000Z')
    const h = healthOf(pid)
    expect(h.overdueDays).toBe(1)
    expect(h.healthScore).toBe(85) // 仅逾期 ≤7 天扣 15，无任务无密度
    expect(h.healthLevel).toBe('healthy')
  })

  it('已完成项目不计逾期天数，恒为健康', () => {
    const pid = seedProject(db, userId, { name: '已完成', status: 'completed' })
    setDates(pid, '2026-08-01T00:00:00+08:00', '2026-09-26T00:00:00+08:00')
    seedTask(db, pid, { title: 'A', status: 'done' })
    const h = healthOf(pid)
    expect(h.overdueDays).toBe(0)
    expect(h.doneRate).toBe(100)
    expect(h.healthScore).toBe(100)
    expect(h.healthLevel).toBe('healthy')
  })

  it('逾期任务密度扣分：偏差落后 + 密度 50% 叠加', () => {
    const pid = seedProject(db, userId, { name: '密度项目' })
    // 20 天周期过 5 天 → 时间进度 25%
    setDates(pid, '2026-09-24T00:00:00+08:00', '2026-10-14T00:00:00+08:00')
    // 4 个活跃任务，2 个任务逾期（截止在 9-28）
    seedTask(db, pid, { title: '逾期1', status: 'in_progress', dueDate: '2026-09-28T00:00:00+08:00' })
    seedTask(db, pid, { title: '逾期2', status: 'todo', dueDate: '2026-09-28T00:00:00+08:00' })
    seedTask(db, pid, { title: '正常1', status: 'in_progress', dueDate: '2026-10-14T00:00:00+08:00' })
    seedTask(db, pid, { title: '正常2', status: 'todo' })
    const h = healthOf(pid)
    expect(h.overdueTasks).toBe(2)
    expect(h.activeTasks).toBe(4)
    // 偏差 -25（doneRate 0 - timeProgress 25）扣 25 + 密度 0.5×30 扣 15 → 60
    expect(h.healthScore).toBe(60)
    expect(h.healthLevel).toBe('warning')
  })

  it('临期预警：未逾期但时间进度 ≥90% 且完成率 <80% → 额外扣 10', () => {
    const pid = seedProject(db, userId, { name: '临期项目' })
    // 20 天周期过 19 天 → 时间进度 95%
    setDates(pid, '2026-09-10T00:00:00+08:00', '2026-09-30T00:00:00+08:00')
    seedTask(db, pid, { title: '未完成', status: 'in_progress' })
    const h = healthOf(pid)
    expect(h.timeProgress).toBe(95)
    // 偏差 -95 扣 95 + 临期 10 → clamp 0
    expect(h.healthScore).toBe(0)
    expect(h.healthLevel).toBe('danger')
  })

  it('无截止日项目：时间进度/偏差为 null，不参与评分', () => {
    const pid = seedProject(db, userId, { name: '无截止' })
    const h = healthOf(pid)
    expect(h.timeProgress).toBeNull()
    expect(h.doneRate).toBeNull()
    expect(h.deviation).toBeNull()
    expect(h.overdueDays).toBe(0)
    expect(h.healthScore).toBe(100)
    expect(h.healthLevel).toBe('healthy')
  })

  it('评分下限为 0，不会出现负分', () => {
    const pid = seedProject(db, userId, { name: '深度逾期' })
    setDates(pid, '2026-01-01T00:00:00+08:00', '2026-05-01T00:00:00+08:00')
    const h = healthOf(pid)
    expect(h.healthScore).toBeGreaterThanOrEqual(0)
    expect(h.healthLevel).toBe('danger')
  })
})
