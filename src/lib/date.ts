// 日期与显示工具

import { format, formatDistanceToNow, isToday, isPast, isThisWeek } from 'date-fns'
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

export function dueLabel(d: string | null): { text: string; tone: 'normal' | 'soon' | 'overdue' | 'none' } {
  if (!d) return { text: '无截止', tone: 'none' }
  const date = new Date(d)
  if (isPast(date)) return { text: '已逾期', tone: 'overdue' }
  if (isToday(date)) return { text: '今天截止', tone: 'soon' }
  if (isThisWeek(date, { weekStartsOn: 1 })) return { text: format(date, 'EEEE', { locale: zhCN }), tone: 'soon' }
  return { text: format(date, 'MM-dd'), tone: 'normal' }
}

export function firstChar(name: string): string {
  return name?.trim().slice(0, 1) || '?'
}