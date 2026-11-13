import { describe, it, expect, afterEach, vi } from 'vitest'
import { beijingDate, beijingDaysAgo } from '../api/lib/utils.ts'

// 北京时间日期换算回归：自动生成日期类字段（台账工时入账日期、导出登记日期、导出文件名）
// 不能用 toISOString().slice(0, 10)（UTC 日期），东八区 0-8 点会把当天算成前一天；
// 且显式 +8h 计算，服务器部署在 UTC 时区（如 Vercel）时结果同样正确
describe('beijingDate 北京时间日期换算', () => {
  afterEach(() => vi.useRealTimers())

  it('UTC ISO 时间戳 → +8h 后的日历日期', () => {
    // 数据库真实样例：北京 09:50:24，UTC 与北京同日
    expect(beijingDate('2026-11-13T01:50:24.637Z')).toBe('2026-11-13')
  })

  it('东八区凌晨（UTC 还没过日界）→ 归入北京当天而非 UTC 前一天', () => {
    // 北京 2026-11-13 01:30，UTC 日期还是 11-12 —— 修复前的 slice(0,10) 会错误返回 11-12
    expect(beijingDate('2026-11-12T17:30:00.000Z')).toBe('2026-11-13')
    // 北京 23:59:59，仍在 11-12 当天（+8 后未过日界）
    expect(beijingDate('2026-11-12T15:59:59.000Z')).toBe('2026-11-12')
  })

  it('跨月/跨年不串号', () => {
    expect(beijingDate('2026-01-31T17:00:00.000Z')).toBe('2026-02-01')
    expect(beijingDate('2025-12-31T16:30:00.000Z')).toBe('2026-01-01')
  })

  it('纯日期时间串（导入格式无 Z）日期保持不变', () => {
    expect(beijingDate('2026-11-13T00:00:00')).toBe('2026-11-13')
  })

  it('接受 Date 对象入参', () => {
    expect(beijingDate(new Date('2026-11-12T17:30:00.000Z'))).toBe('2026-11-13')
  })

  it('默认入参取当前时刻（mock 时钟：UTC 11-12 深夜 → 北京 11-13）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T17:30:00.000Z'))
    expect(beijingDate()).toBe('2026-11-13')
  })
})

// 统计窗口下界回归：与 th.date / log_date（北京日期列）比较时必须按北京日历取 N 天前，
// UTC 切片在东八区 0-8 点会少算一天，导致"近 N 天"多包含一天更早的数据
describe('beijingDaysAgo 北京日历 N 天前', () => {
  afterEach(() => vi.useRealTimers())

  it('mock 时钟：北京 11-13 01:30 → N=0 取当天 11-13，N=90 取 08-15', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T17:30:00.000Z'))
    // 旧实现 slice(0,10) 在此时刻会返回 11-12 / 08-14（各少算一天）
    expect(beijingDaysAgo(0)).toBe('2026-11-13')
    expect(beijingDaysAgo(90)).toBe('2026-08-15')
  })
})
