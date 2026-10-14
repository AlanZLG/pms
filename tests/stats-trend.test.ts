import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject, seedTask } from './helpers/test-db'
import { taskRepo } from '../api/repository/repo.ts'

// 统一覆盖任务的 created_at / updated_at（仓库存 ISO UTC 字符串）
function setTime(taskId: string, createdAt: Date, updatedAt?: Date) {
  db.prepare('UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(createdAt.toISOString(), (updatedAt || createdAt).toISOString(), taskId)
}

describe('仪表盘趋势/燃尽时间窗', () => {
  let pid: string

  beforeEach(() => {
    db.exec('DELETE FROM tasks; DELETE FROM projects; DELETE FROM users;')
    const uid = seedUser(db, { email: 'u@pm.dev', name: '用户' })
    pid = seedProject(db, uid, { name: '趋势项目' })
  })

  describe('trendDaily：连续 N 个自然日（含今天）+ 本地时区归日', () => {
    it('固定返回 14 天连续日期轴，无数据补 0，窗口外任务不计入', () => {
      const now = new Date()
      const at = (dayOffset: number, h: number) => {
        const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d
      }
      // 昨天 08:00 创建、昨天 10:00 完成
      const a = seedTask(db, pid, { title: 'A', status: 'done' }); setTime(a, at(-1, 8), at(-1, 10))
      // 今天 09:00 创建，未完成
      const b = seedTask(db, pid, { title: 'B' }); setTime(b, at(0, 9))
      // 20 天前创建（窗口外，不得出现）
      const c = seedTask(db, pid, { title: 'C', status: 'done' }); setTime(c, at(-20, 12), at(-19, 12))

      const trend = taskRepo.trendDaily(14)
      expect(trend).toHaveLength(14)

      const key = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
      const today = new Date(); today.setHours(0, 0, 0, 0)
      expect(trend[13].date).toBe(key(today))
      expect(trend[12].date).toBe(key(new Date(today.getTime() - 86400000)))

      const yesterday = trend[12]
      expect(yesterday.created).toBe(1)
      expect(yesterday.completed).toBe(1)
      expect(trend[13].created).toBe(1)
      expect(trend[13].completed).toBe(0)
      // 中间无动态的日期补 0（断轴修复）
      expect(trend[7]).toEqual({ date: trend[7].date, created: 0, completed: 0 })
      // 窗口外任务既不进 created 也不进 completed
      expect(trend.reduce((s, d) => s + d.created + d.completed, 0)).toBe(3)
    })

    it('本地 0~8 点的操作归当天（UTC 归日会把北京凌晨记到前一天）', () => {
      const d = new Date(); d.setHours(1, 30, 0, 0) // 今天本地凌晨 1:30
      const t = seedTask(db, pid, { title: '凌晨任务' })
      setTime(t, d)

      const trend = taskRepo.trendDaily(14)
      const key = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
      const todayPoint = trend.find((p) => p.date === key)!
      expect(todayPoint.created).toBe(1)
      // 前一天不应被记入（旧 UTC 逻辑会 here 归到昨天）
      const yesterdayKey = (() => {
        const y = new Date(d.getTime() - 86400000)
        return `${y.getFullYear()}-${`${y.getMonth() + 1}`.padStart(2, '0')}-${`${y.getDate()}`.padStart(2, '0')}`
      })()
      const yesterdayPoint = trend.find((p) => p.date === yesterdayKey)!
      expect(yesterdayPoint.created).toBe(0)
    })

    it('projectIds=[] 返回空数组，不回退全量', () => {
      expect(taskRepo.trendDaily(14, [])).toEqual([])
    })
  })

  describe('burndown：时间轴至少延伸到今天', () => {
    it('任务全部在 3 天前完成，时间轴仍延伸到今天，实际线清零后保持 0', () => {
      const at = (dayOffset: number, h: number) => {
        const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d
      }
      const t1 = seedTask(db, pid, { title: 'T1', status: 'done' }); setTime(t1, at(-5, 9), at(-3, 15))
      const t2 = seedTask(db, pid, { title: 'T2', status: 'done' }); setTime(t2, at(-5, 10), at(-3, 18))

      const bd = taskRepo.burndown(undefined, 0)
      const today = new Date()
      const todayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
      // 最后一个点必须是今天（旧实现停在最后完成日，即 3 天前）
      expect(bd.dates[bd.dates.length - 1]).toBe(todayKey)
      // 实际剩余在完成日后清零并保持
      expect(bd.actual[bd.actual.length - 1]).toBe(0)
      // 理想线终点为 0
      expect(bd.ideal[bd.ideal.length - 1]).toBe(0)
    })
  })
})
