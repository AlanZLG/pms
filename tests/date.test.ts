import { describe, it, expect, afterEach, vi } from 'vitest'
import { dueLabel, toDateInputValue, todayLocal, fmtDateTimeSec, mondayOf } from '../src/lib/date'

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

// 审计/日志时间展示回归（BIZ 系统操作日志）：UTC ISO 不能裸截取原串显示
// （东八区每条早 8 小时），必须先转 Date 再按本地时区格式化
describe('fmtDateTimeSec 本地时间格式化', () => {
  it('UTC ISO → 本地含秒时间（+8 环境：01:50 UTC = 09:50 北京）', () => {
    expect(fmtDateTimeSec('2026-11-13T01:50:24.637Z')).toBe('2026-11-13 09:50:24')
  })

  it('空值与非法值返回空串', () => {
    expect(fmtDateTimeSec(null)).toBe('')
    expect(fmtDateTimeSec('')).toBe('')
    expect(fmtDateTimeSec('not-a-date')).toBe('')
  })
})

// 自动生成默认日期回归：不能用 new Date().toISOString().slice(0, 10)（UTC 日期），
// 东八区 0-8 点会把当天算成前一天（新增台账默认日期等场景）
describe('todayLocal 本地当天日期', () => {
  afterEach(() => vi.useRealTimers())

  it('北京时间凌晨（UTC 还没过日界）→ 仍是本地当天，而非 UTC 前一天', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T17:30:00.000Z')) // 北京 11-13 01:30
    expect(todayLocal()).toBe('2026-11-13')
    expect(todayLocal()).not.toBe(new Date().toISOString().slice(0, 10)) // UTC 日期是 11-12
  })

  it('输出格式为 YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// 周报表周起点回归：本地零点不能切 toISOString（UTC 语义），东八区会恒定提前一天
// （周一被算成周日），导致整周列日期与"一二三四五六日"标签错位
describe('mondayOf 所在周的周一', () => {
  it('周五所在周 → 周一 2026-11-09', () => {
    expect(mondayOf(new Date(2026, 10, 13))).toBe('2026-11-09')
  })

  it('周一当天 → 本身', () => {
    expect(mondayOf(new Date(2026, 10, 9))).toBe('2026-11-09')
  })

  it('周日 → 上周一（周从周一起算）', () => {
    expect(mondayOf(new Date(2026, 10, 8))).toBe('2026-11-02')
  })

  it('跨月不串号', () => {
    // 2026-11-01 是周日 → 上周一 2026-10-26
    expect(mondayOf(new Date(2026, 10, 1))).toBe('2026-10-26')
  })
})
