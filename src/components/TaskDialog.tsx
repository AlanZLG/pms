// 创建/编辑任务对话框

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ProjectDialog'
import { Button, Input, Textarea } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import type { Task, TaskPriority, TaskStatus } from '../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  task?: Task | null
  defaultStatus?: TaskStatus
  onSaved: () => void
}

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
]
const statuses: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'review', label: '审核中' },
  { value: 'done', label: '已完成' },
]

export default function TaskDialog({ open, onClose, projectId, task, defaultStatus, onSaved }: Props) {
  const users = useAsync(() => api.listUsers(), [projectId])
  const members = users.data?.users || []

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [labels, setLabels] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(task?.title || '')
      setDescription(task?.description || '')
      setStatus(task?.status || defaultStatus || 'todo')
      setPriority(task?.priority || 'medium')
      setAssigneeId(task?.assigneeId || null)
      setLabels(task?.labels.join(', ') || '')
      setDueDate(task?.dueDate?.slice(0, 10) || '')
    }
  }, [open, task, defaultStatus])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        title,
        description,
        status,
        priority,
        assigneeId: assigneeId || null,
        labels: labels
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      }
      if (task) {
        await api.updateTask(task.id, payload)
      } else {
        await api.createTask(projectId, payload)
      }
      onSaved()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? '编辑任务' : '新建任务'} wide>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs text-muted">任务标题</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="简明扼要" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted">描述</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="更详细的说明"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs text-muted">状态</label>
            <SelectBox value={status} onChange={(v) => setStatus(v as TaskStatus)} options={statuses} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">优先级</label>
            <SelectBox value={priority} onChange={(v) => setPriority(v as TaskPriority)} options={priorities} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">负责人</label>
            <select
              value={assigneeId || ''}
              onChange={(e) => setAssigneeId(e.target.value || null)}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
            >
              <option value="">未指派</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">截止日期</label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted">标签(逗号分隔)</label>
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="前端, 设计" />
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
    </Modal>
  )
}

function SelectBox({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}