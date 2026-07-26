// 创建/编辑项目的对话框

import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Textarea } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ProjectStatus } from '../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    description: string
    status: ProjectStatus
    dueDate: string | null
  }) => Promise<void>
  title?: string
  defaultValues?: Partial<{ name: string; description: string; status: ProjectStatus; dueDate: string }>
}

const statusOptions: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: '规划中' },
  { value: 'active', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

export default function ProjectDialog({
  open,
  onClose,
  onSubmit,
  title = '新建项目',
  defaultValues,
}: Props) {
  const [name, setName] = useState(defaultValues?.name || '')
  const [description, setDescription] = useState(defaultValues?.description || '')
  const [status, setStatus] = useState<ProjectStatus>(defaultValues?.status || 'planning')
  const [dueDate, setDueDate] = useState(defaultValues?.dueDate?.slice(0, 10) || '')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit({
        name,
        description,
        status,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative w-full max-w-md rounded-2xl p-6 animate-pop-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-white">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-slate-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted">项目名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="如:Atlas 后台重构" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">描述</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="用一两句话说明项目目标"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-muted">状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted">截止日期</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '保存中…' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 共享:状态徽章
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const map: Record<ProjectStatus, { cls: string; label: string }> = {
    planning: { cls: 'bg-slate-500/15 text-slate-300', label: '规划中' },
    active: { cls: 'bg-brand/15 text-brand-soft', label: '进行中' },
    completed: { cls: 'bg-ok/15 text-ok', label: '已完成' },
    archived: { cls: 'bg-muted/15 text-muted', label: '已归档' },
  }
  const s = map[status]
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', s.cls)}>
      {s.label}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  children,
  title,
  wide,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('glass relative w-full rounded-2xl p-6 animate-pop-in', wide ? 'max-w-2xl' : 'max-w-md')}>
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <div className="font-display text-xl text-white">{title}</div>
            <button onClick={onClose} className="text-muted hover:text-slate-200">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}