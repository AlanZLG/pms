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