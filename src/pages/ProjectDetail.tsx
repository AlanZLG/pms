// 项目详情页 - 列表/看板视图切换

import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Plus, ArrowLeft, LayoutGrid, List, Pencil, Trash2 } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import {
  Button,
  Input,
  Skeleton,
  EmptyState,
  Avatar,
  PriorityBadge,
  StatusBadge,
  LabelTag,
} from '@/components/ui'
import ProjectDialog, { ProjectStatusBadge } from '@/components/ProjectDialog'
import TaskDialog from '@/components/TaskDialog'
import TaskDrawer from '@/components/TaskDrawer'
import { useAppStore } from '@/stores/app'
import { fmtDate, dueLabel } from '@/lib/date'
import type { Project, Task, TaskStatus } from '../../shared/types'

const columns: { status: TaskStatus; label: string; accent: string }[] = [
  { status: 'todo', label: '待办', accent: 'text-slate-300' },
  { status: 'in_progress', label: '进行中', accent: 'text-warn' },
  { status: 'review', label: '审核中', accent: 'text-sky-300' },
  { status: 'done', label: '已完成', accent: 'text-ok' },
]

export default function ProjectDetail() {
  const { projectId = '' } = useParams()
  const data = useAsync(() => api.listTasks(projectId), [projectId])
  const notify = useAppStore((s) => s.notify)

  const [view, setView] = useState<'list' | 'kanban'>('kanban')
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [presetStatus, setPresetStatus] = useState<TaskStatus>('todo')
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null)

  const project: Project | undefined = data.data?.project
  const tasks: Task[] = data.data?.tasks || []

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (keyword && !t.title.includes(keyword)) return false
      return true
    })
  }, [tasks, keyword, statusFilter])

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    tasks.forEach((t) => map[t.status]?.push(t))
    return map
  }, [tasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const newStatus = String(over.id) as TaskStatus
    const t = tasks.find((x) => x.id === taskId)
    if (!t || t.status === newStatus) return
    try {
      await api.updateTaskStatus(taskId, newStatus)
      notify('success', '状态已更新')
      data.reload()
    } catch (err: any) {
      notify('error', err?.message || '更新失败')
    }
  }

  function openCreate(status: TaskStatus = 'todo') {
    setEditingTask(null)
    setPresetStatus(status)
    setTaskDialogOpen(true)
  }

  function openEdit(t: Task) {
    setEditingTask(t)
    setPresetStatus(t.status)
    setTaskDialogOpen(true)
  }

  async function deleteTask(t: Task) {
    if (!confirm(`确认删除任务「${t.title}」?`)) return
    try {
      await api.deleteTask(t.id)
      notify('success', '已删除')
      data.reload()
    } catch (err: any) {
      notify('error', err?.message || '删除失败')
    }
  }

  async function saveProject(d: Partial<Project>) {
    if (!project) return
    await api.updateProject(project.id, d)
    notify('success', '项目已更新')
    setProjectDialogOpen(false)
    data.reload()
  }

  if (data.loading && !project) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (!project) {
    return <EmptyState title="项目不存在或已删除" hint="返回项目列表查看" />
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 顶部 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/projects"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-slate-200"
          >
            <ArrowLeft className="h-3 w-3" /> 返回项目
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl text-white">{project.name}</h2>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {project.description || '暂无描述'} · 截止 {fmtDate(project.dueDate, 'yyyy-MM-dd')}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted">
            <span>进度 {project.progress}%</span>
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-soft">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand-soft"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <span>{tasks.length} 个任务</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setProjectDialogOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> 编辑项目
          </Button>
          <Button onClick={() => openCreate('todo')}>
            <Plus className="h-4 w-4" /> 新建任务
          </Button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Input
            placeholder="搜索任务"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {view === 'list' && (
            <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
              {(['all', 'todo', 'in_progress', 'review', 'done'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-medium transition ' +
                    (statusFilter === s
                      ? 'bg-brand text-white'
                      : 'text-muted hover:text-slate-200')
                  }
                >
                  {s === 'all' ? '全部' : columns.find((c) => c.status === s)?.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
            <button
              onClick={() => setView('list')}
              className={
                'rounded-md p-1.5 transition ' +
                (view === 'list' ? 'bg-brand text-white' : 'text-muted hover:text-slate-200')
              }
              title="列表"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('kanban')}
              className={
                'rounded-md p-1.5 transition ' +
                (view === 'kanban' ? 'bg-brand text-white' : 'text-muted hover:text-slate-200')
              }
              title="看板"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 内容 */}
      {view === 'list' ? (
        filtered.length === 0 ? (
          <EmptyState title="没有匹配的任务" hint="调整筛选条件或新建任务" />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-bg-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">任务</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">优先级</th>
                  <th className="px-4 py-3 text-left font-medium">截止</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {filtered.map((t) => {
                  const dl = dueLabel(t.dueDate)
                  return (
                    <tr
                      key={t.id}
                      className="cursor-pointer transition hover:bg-bg-soft/60"
                      onClick={() => setDrawerTaskId(t.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{t.title}</div>
                        {t.labels.length > 0 && (
                          <div className="mt-1 flex gap-1">
                            {t.labels.map((l) => (
                              <LabelTag key={l} label={l} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        <span
                          className={
                            dl.tone === 'overdue'
                              ? 'text-danger'
                              : dl.tone === 'soon'
                                ? 'text-warn'
                                : ''
                          }
                        >
                          {dl.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="mr-2 text-muted hover:text-brand-soft"
                          onClick={() => openEdit(t)}
                          title="编辑"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          className="text-muted hover:text-danger"
                          onClick={() => deleteTask(t)}
                          title="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {columns.map((col) => {
              const list = grouped[col.status]
              return (
                <KanbanColumn
                  key={col.status}
                  status={col.status}
                  label={col.label}
                  accent={col.accent}
                  count={list.length}
                  onAdd={() => openCreate(col.status)}
                >
                  {list.map((t) => (
                    <KanbanCard
                      key={t.id}
                      task={t}
                      onOpen={() => setDrawerTaskId(t.id)}
                      onEdit={() => openEdit(t)}
                      onDelete={() => deleteTask(t)}
                    />
                  ))}
                  {list.length === 0 && (
                    <div className="rounded-xl border border-dashed border-bg-border px-3 py-6 text-center text-xs text-muted">
                      暂无
                    </div>
                  )}
                </KanbanColumn>
              )
            })}
          </div>
        </DndContext>
      )}

      {/* 对话框 */}
      <ProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onSubmit={saveProject}
        title="编辑项目"
        defaultValues={{
          name: project.name,
          description: project.description,
          status: project.status,
          dueDate: project.dueDate || '',
        }}
      />
      <TaskDialog
        open={taskDialogOpen}
        onClose={() => setTaskDialogOpen(false)}
        projectId={projectId}
        task={editingTask}
        defaultStatus={presetStatus}
        onSaved={() => {
          notify('success', editingTask ? '任务已更新' : '任务已创建')
          data.reload()
        }}
      />

      <TaskDrawer
        taskId={drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onChanged={data.reload}
      />
    </div>
  )
}

// ===== 看板列 =====
function KanbanColumn({
  status,
  label,
  accent,
  count,
  onAdd,
  children,
}: {
  status: TaskStatus
  label: string
  accent: string
  count: number
  onAdd: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={
        'flex flex-col rounded-2xl border bg-bg-panel/60 p-3 transition ' +
        (isOver ? 'border-brand/60 bg-brand/5' : 'border-bg-border')
      }
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={'text-sm font-medium ' + accent}>{label}</span>
          <span className="rounded-full bg-bg-soft px-1.5 py-0.5 text-xs text-muted">{count}</span>
        </div>
        <button
          className="text-muted transition hover:text-brand-soft"
          onClick={onAdd}
          title="在该列新建"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// ===== 看板卡片 =====
function KanbanCard({
  task,
  onOpen,
  onEdit,
  onDelete,
}: {
  task: Task
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  const dl = dueLabel(task.dueDate)
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation()
          onOpen()
        }
      }}
      className={
        'group cursor-pointer rounded-xl border border-bg-border bg-bg/60 p-3 shadow-sm transition hover:border-brand/40 hover:shadow-glow ' +
        (isDragging ? 'opacity-60' : '')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-100">{task.title}</p>
        <div className="flex opacity-0 transition group-hover:opacity-100">
          <button
            className="text-muted hover:text-brand-soft"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            title="编辑"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="ml-1 text-muted hover:text-danger"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <LabelTag key={l} label={l} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <PriorityBadge priority={task.priority} />
        <div className="flex items-center gap-2">
          {task.dueDate && (
            <span
              className={
                'text-xs ' +
                (dl.tone === 'overdue'
                  ? 'text-danger'
                  : dl.tone === 'soon'
                    ? 'text-warn'
                    : 'text-muted')
              }
            >
              {dl.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}