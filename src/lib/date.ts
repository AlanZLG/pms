// 日期与显示工具

import { format, formatDistanceToNow, isToday, isThisWeek, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function fmtDate(d: string | null, pattern = 'MM-dd'): string {
  if (!d) return ''
  try {
    return format(new Date(d), pattern)
  } catch {
    return ''
  }
}

export function fmtDateTime(d: string | null): string {
  if (!d) return ''
  try {
    return format(new Date(d), 'yyyy-MM-dd HH:mm')
  } catch {
    return ''
  }
}

// 含秒的本地时间（审计/日志类列表用）。后端统一存 UTC ISO，不能直接 slice 原串展示：
// 直接截取会把 UTC 时间当本地时间显示（东八区每条早 8 小时），必须先转 Date 再按本地时区格式化
export function fmtDateTimeSec(d: string | null): string {
  if (!d) return ''
  try {
    return format(new Date(d), 'yyyy-MM-dd HH:mm:ss')
  } catch {
    return ''
  }
}

export function fromNow(d: string | null): string {
  if (!d) return ''
  try {
    return formatDistanceToNow(new Date(d), { addSuffix: true, locale: zhCN })
  } catch {
    return ''
  }
}

export function dueLabel(d: string | null, done = false): { text: string; tone: 'normal' | 'soon' | 'overdue' | 'none' } {
  if (!d) return { text: '无截止', tone: 'none' }
  const date = new Date(d)
  // 已完成的任务/项目不再显示逾期，只展示日期
  if (done) {
    try {
      return { text: format(date, 'MM-dd'), tone: 'normal' }
    } catch {
      return { text: '无截止', tone: 'none' }
    }
  }
  // 逾期按日级比较：截止日早于今天才算逾期，当天截止显示"今天截止"（与 Dashboard/甘特图口径一致）
  // 注意不能用 isPast(startOfDay(date))：那是拿"当天 00:00"和"当前时刻"比，
  // 起止同天的当天任务一创建就会被误判成"已逾期"
  if (startOfDay(date) < startOfDay(new Date())) return { text: '已逾期', tone: 'overdue' }
  if (isToday(date)) return { text: '今天截止', tone: 'soon' }
  if (isThisWeek(date, { weekStartsOn: 1 })) return { text: format(date, 'EEEE', { locale: zhCN }), tone: 'soon' }
  return { text: format(date, 'MM-dd'), tone: 'normal' }
}

export function firstChar(name: string): string {
  return name?.trim().slice(0, 1) || '?'
}

// 日期值转 date-input 用的本地 YYYY-MM-DD。不能用 slice(0, 10) / toISOString（UTC 语义）：
// 东八区下甘特图拖拽产生的本地零点 ISO（如 2026-10-21T16:00:00.000Z = 本地 10-22 00:00）
// 会被切成 10-21，导致编辑保存后截止日期悄悄提前一天、次日即显示逾期
export function toDateInputValue(d: string | Date | null | undefined): string {
  if (!d) return ''
  try {
    return format(d instanceof Date ? d : new Date(d), 'yyyy-MM-dd')
  } catch {
    return ''
  }
}

// 当天本地日期（YYYY-MM-DD），用于"新增记录默认日期"等自动生成场景。
// 不能用 new Date().toISOString().slice(0, 10)：那是 UTC 日期，东八区 0-8 点会算成前一天（同 toDateInputValue 注释）
export function todayLocal(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

// 所在周的周一（YYYY-MM-DD），按本地日历计算。周报表格用。
// 中间步骤不能切 toISOString：本地零点在东八区 = UTC 前一天 16:00，
// slice(0,10) 会恒定提前一天（周一被算成周日），导致整周列与星期标签错位
export function mondayOf(d: Date): string {
  const day = (d.getDay() + 6) % 7 // 周一 = 0
  return toDateInputValue(new Date(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day * 86400000))
}