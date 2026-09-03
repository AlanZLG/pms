import { useState } from 'react'
import { RotateCcw, Trash, Search, AlertTriangle } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Button, EmptyState, StatusBadge, PriorityBadge } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { useNavigate } from 'react-router-dom'
import { dueLabel } from '@/lib/date'
import type { Task } from '../../shared/types'

export default function TrashPage() {
  const notify = useAppStore((s) => s.notify)
  const nav = useNavigate()
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const trash = useAsync<{ tasks: Task[] }>(() => api.listTrash(), [])

  async function handleRestore(task: Task) {
    try {
      await api.restoreTask(task.id)
      notify('success', `任务「${task.title}」已恢复`)
      trash.reload()
    } catch {
      notify('error', '恢复失败')
    }
  }

  async function handlePhysicalDelete(task: Task) {
    try {
      await api.physicalDeleteTask(task.id)
      notify('success', `任务「${task.title}」已彻底删除`)
      setConfirmDelete(null)
      trash.reload()
    } catch {
      notify('error', '删除失败')
    }
  }

  const tasks = trash.data?.tasks || []
  const filtered = search
    ? tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : tasks

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-text-primary">回收站</h1>
          <p className="mt-1 text-sm text-muted">已删除的任务保留在此处，恢复后可继续使用</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索已删除任务…"
              className="h-9 w-64 rounded-lg border border-bg-border bg-bg-soft pl-9 pr-3 text-sm text-text-primary placeholder:text-muted focus:border-brand focus:outline-none"
            />
          </div>
        </div>
      </div>

      {trash.loading ? (
        <Card className="p-12 text-center text-muted">加载中…</Card>
      ) : filtered.length === 0 ? (
        <EmptyState title="回收站为空" hint="这里没有已删除的任务" />
      ) : (
        <Card className="divide-y divide-bg-border">
          <div className="flex items-center gap-4 px-4 py-3 text-xs font-medium text-muted">
            <div className="flex-1">任务</div>
            <div className="w-24">状态</div>
            <div className="w-24">优先级</div>
            <div className="w-28">截止日期</div>
            <div className="w-20 text-right">删除时间</div>
            <div className="w-32 text-right">操作</div>
          </div>
          {filtered.map((task) => (
            <TrashItem
              key={task.id}
              task={task}
              onRestore={() => handleRestore(task)}
              onPhysicalDelete={() => setConfirmDelete(task.id)}
              navigating={nav}
            />
          ))}
        </Card>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-danger/20">
                <AlertTriangle className="h-6 w-6 text-danger" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-text-primary">彻底删除</h3>
                <p className="mt-1 text-sm text-muted">
                  此操作不可撤销，任务将被永久删除。确定要继续吗？
                </p>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const task = tasks.find((t) => t.id === confirmDelete)
                  if (task) handlePhysicalDelete(task)
                }}
                className="bg-danger hover:bg-danger/90"
              >
                彻底删除
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function TrashItem({
  task,
  onRestore,
  onPhysicalDelete,
  navigating,
}: {
  task: Task
  onRestore: () => void
  onPhysicalDelete: () => void
  navigating: (path: string) => void
}) {
  const deletedDate = task.deletedAt ? new Date(task.deletedAt) : null
  const due = dueLabel(task.dueDate)

  return (
    <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-bg-soft/50">
      <div className="flex-1 min-w-0">
        <button
          onClick={() => navigating(`/projects/${task.projectId}`)}
          className="truncate text-left text-sm text-text-primary hover:text-brand"
        >
          {task.title}
        </button>
        <div className="mt-0.5 text-xs text-muted">
          {task.description?.slice(0, 60) || '无描述'}
        </div>
      </div>
      <div className="w-24">
        <StatusBadge status={task.status} />
      </div>
      <div className="w-24">
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="w-28 text-xs text-muted">
        {due.text}
      </div>
      <div className="w-20 text-right text-xs text-muted">
        {deletedDate ? `${deletedDate.getMonth() + 1}/${deletedDate.getDate()}` : '-'}
      </div>
      <div className="flex w-32 justify-end gap-1">
        <button
          onClick={onRestore}
          className="rounded-md p-2 text-ok hover:bg-ok/10"
          title="恢复"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          onClick={onPhysicalDelete}
          className="rounded-md p-2 text-danger hover:bg-danger/10"
          title="彻底删除"
        >
          <Trash className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
