import { describe, it, expect } from 'vitest'
import { dueLabel, toDateInputValue } from '../src/lib/date'

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

// 编辑回填回归：date-input 回填必须按本地日期切片，
// 甘特拖拽产生的「本地零点 ISO」（东八区 = UTC 前一天 16:00）不能被 slice(0,10) 切成前一天
describe('toDateInputValue 本地日期切片', () => {
  it('本地零点 ISO（甘特拖拽存值）→ 本地日期，而非 UTC 前一天', () => {
    // 2026-10-22 本地 00:00 (+8) = 2026-10-21T16:00:00.000Z
    expect(toDateInputValue('2026-10-21T16:00:00.000Z')).toBe('2026-10-22')
  })

  it('UTC 零点 ISO（弹窗提交存值）→ 本地当天', () => {
    expect(toDateInputValue('2026-10-22T00:00:00.000Z')).toBe('2026-10-22')
  })

  it('纯日期字符串原样返回', () => {
    expect(toDateInputValue('2026-10-22')).toBe('2026-10-22')
  })

  it('空值与非法值返回空串', () => {
    expect(toDateInputValue(null)).toBe('')
    expect(toDateInputValue('')).toBe('')
    expect(toDateInputValue('not-a-date')).toBe('')
  })
})
