// 共享小型 UI 组件

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { TaskPriority, TaskStatus } from '../../shared/types'

// 头像(取首字符)
export function Avatar({
  name,
  color,
  size = 28,
}: {
  name: string
  color: string
  size?: number
}) {
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ring-bg/40"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.42 }}
      title={name}
    >
      {name.slice(0, 1)}
    </div>
  )
}

// 优先级徽章
const priorityStyle: Record<TaskPriority, { dot: string; text: string; label: string }> = {
  low: { dot: 'bg-muted', text: 'text-muted', label: '低' },
  medium: { dot: 'bg-sky-400', text: 'text-sky-300', label: '中' },
  high: { dot: 'bg-warn', text: 'text-warn', label: '高' },
  urgent: { dot: 'bg-danger', text: 'text-danger', label: '紧急' },
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const s = priorityStyle[priority]
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

// 状态徽章
const statusStyle: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  todo: { bg: 'bg-slate-500/15', text: 'text-slate-300', label: '待办' },
  in_progress: { bg: 'bg-warn/15', text: 'text-warn', label: '进行中' },
  review: { bg: 'bg-sky-500/15', text: 'text-sky-300', label: '审核中' },
  done: { bg: 'bg-ok/15', text: 'text-ok', label: '已完成' },
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = statusStyle[status]
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', s.bg, s.text)}>
      {s.label}
    </span>
  )
}

// 标签
export function LabelTag({ label }: { label: string }) {
  return (
    <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-soft">
      {label}
    </span>
  )
}

// 按钮
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'danger' | 'soft'
  size?: 'sm' | 'md'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand-deep shadow-glow',
    ghost: 'border border-bg-border text-slate-200 hover:bg-bg-soft',
    soft: 'bg-brand/10 text-brand-soft hover:bg-brand/20',
    danger: 'bg-danger/90 text-white hover:bg-danger',
  }
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  )
}

// 输入框
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30',
        props.className,
      )}
    />
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30',
        props.className,
      )}
    />
  )
}

// 卡片
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-bg-border bg-bg-panel/70 shadow-card backdrop-blur', className)}>
      {children}
    </div>
  )
}

// 空状态
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-bg-border py-16 text-center">
      <p className="font-display text-lg text-slate-200">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  )
}

// Skeleton
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-white/5', className)} />
}