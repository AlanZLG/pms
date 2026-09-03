import type { TaskStatus, ProjectStatus } from '../../shared/types'

// Task status display config — single source of truth
export const STATUS_META: Record<TaskStatus, { label: string; hex: string; tailwind: string; dot: string }> = {
  todo:       { label: '待办',   hex: '#94A3B8', tailwind: 'bg-slate-500',    dot: 'bg-slate-400' },
  in_progress: { label: '进行中', hex: '#F59E0B', tailwind: 'bg-amber-500',    dot: 'bg-amber-500' },
  review:      { label: '审核中', hex: '#38BDF8', tailwind: 'bg-sky-500',      dot: 'bg-sky-400' },
  done:        { label: '已完成', hex: '#10B981', tailwind: 'bg-emerald-500',  dot: 'bg-emerald-500' },
}

export const STATUS_COLORS_HEX: Record<TaskStatus, string> = {
  todo: STATUS_META.todo.hex,
  in_progress: STATUS_META.in_progress.hex,
  review: STATUS_META.review.hex,
  done: STATUS_META.done.hex,
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: STATUS_META.todo.label,
  in_progress: STATUS_META.in_progress.label,
  review: STATUS_META.review.label,
  done: STATUS_META.done.label,
}

export const STATUS_COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: 'todo',       label: STATUS_META.todo.label,       dot: STATUS_META.todo.dot },
  { status: 'in_progress', label: STATUS_META.in_progress.label, dot: STATUS_META.in_progress.dot },
  { status: 'review',      label: STATUS_META.review.label,      dot: STATUS_META.review.dot },
  { status: 'done',       label: STATUS_META.done.label,       dot: STATUS_META.done.dot },
]

// Project status display
export const PROJECT_STATUS_META: Record<ProjectStatus, { bg: string; text: string; label: string }> = {
  planning:  { bg: 'bg-sky-500/15',   text: 'text-sky-300',     label: '规划中' },
  active:    { bg: 'bg-brand/15',    text: 'text-brand-soft',  label: '进行中' },
  completed: { bg: 'bg-emerald-500/15', text: 'text-ok',         label: '已完成' },
  archived:  { bg: 'bg-slate-500/15',  text: 'text-muted',       label: '已归档' },
}

// Priority display
export const PRIORITY_META: Record<string, { label: string; color: string; weight: number }> = {
  low:    { label: '低',   color: 'bg-slate-500',   weight: 0 },
  medium: { label: '中',   color: 'bg-sky-500',     weight: 1 },
  high:   { label: '高',   color: 'bg-amber-500',   weight: 2 },
  urgent: { label: '紧急', color: 'bg-red-500',     weight: 3 },
}
