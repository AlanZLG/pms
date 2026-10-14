import { describe, it, expect } from 'vitest'
import { dueLabel } from '../src/lib/date'

const DAY = 86400000

// 逾期口径回归：截止日 < 今天才算逾期，当天截止不算（与 Dashboard/甘特图/stats 一致）
describe('dueLabel 日级逾期判定', () => {
  it('截止日早于今天 → 已逾期', () => {
    const r = dueLabel(new Date(Date.now() - DAY).toISOString())
    expect(r).toEqual({ text: '已逾期', tone: 'overdue' })
  })

  it('截止日是今天（起止同天的当天任务）→ 今天截止，不算逾期', () => {
    const r = dueLabel(new Date().toISOString())
    expect(r).toEqual({ text: '今天截止', tone: 'soon' })
  })

  it('远期截止 → 只显示日期', () => {
    const r = dueLabel(new Date(Date.now() + 30 * DAY).toISOString())
    expect(r.tone).toBe('normal')
  })

  it('已完成任务不标逾期，只显示日期', () => {
    const r = dueLabel(new Date(Date.now() - DAY).toISOString(), true)
    expect(r.tone).toBe('normal')
  })

  it('无截止日期 → 无截止', () => {
    expect(dueLabel(null)).toEqual({ text: '无截止', tone: 'none' })
  })
})
