// 看板视图 - 基于 dnd-kit 的拖拽看板

import { useMemo } from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MessageSquare, Plus } from 'lucide-react'
import { Avatar, PriorityBadge, LabelTag, Button } from '@/components/ui'
import { dueLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task, TaskStatus } from '../../shared/types'

const columns: { status: TaskStatus; label: string; dot: string }[] = [
  { status: 'todo', label: '待办', dot: 'bg-slate-400' },
  { status: 'in_progress', label: '进行中', dot: 'bg-warn' },
  { status: 'review', label: '审核中', dot: 'bg-sky-400' },
  { status: 'done', label: '已完成', dot: 'bg-ok' },
]

interface Props {
  tasks: Task[]
  users: { id: string; name: string; avatarColor: string }[]
  onMove: (taskId: string, status: TaskStatus) => void
  onClickTask: (taskId: string) => void
  onAddTask: (status: TaskStatus) => void
}

export default function KanbanBoard({ tasks, users, onMove, onClickTask, onAddTask }: Props) {
  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] }
    tasks.forEach((t) => map[t.status].push(t))
    return map
  }, [tasks])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleEnd(e: DragEndEvent) {
    const taskId = e.active.id as string
    const target = e.over?.data.current?.status as TaskStatus | undefined
    if (target) onMove(taskId, target)
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((col) => (
        <div key={col.status} className="flex flex-col rounded-2xl border border-bg-border bg-bg-panel/40">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', col.dot)} />
              <h3 className="font-display text-sm text-slate-100">{col.label}</h3>
              <span className="rounded-full bg-bg-soft px-1.5 text-xs text-muted">
                {grouped[col.status].length}
              </span>
            </div>
            <button
              onClick={() => onAddTask(col.status)}
              className="rounded-md p-1 text-muted hover:bg-bg-soft hover:text-brand-soft"
              title="在此列新建"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleEnd}>
            <SortableContext items={grouped[col.status].map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <div
                className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-3"
                data-status={col.status}
              >
                {grouped[col.status].map((task) => (
                  <SortableCard
                    key={task.id}
                    task={task}
                    users={users}
                    onClick={() => onClickTask(task.id)}
                  />
                ))}
                {grouped[col.status].length === 0 && (
                  <div className="rounded-xl border border-dashed border-bg-border py-6 text-center text-xs text-muted">
                    拖拽任务到此处
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ))}
    </div>
  )
}

function SortableCard({
  task,
  users,
  onClick,
}: {
  task: Task
  users: { id: string; name: string; avatarColor: string }[]
  onClick: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  const assignee = users.find((u) => u.id === task.assigneeId)
  const due = dueLabel(task.dueDate)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-xl border border-bg-border bg-bg-soft/80 p-3 transition hover:border-brand/40 hover:shadow-glow',
        isDragging && 'opacity-70 shadow-glow',
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted/60 group-hover:text-muted" />
        <p className="flex-1 text-sm font-medium leading-snug text-slate-100">{task.title}</p>
      </div>

      {task.labels.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1 pl-6">
          {task.labels.slice(0, 3).map((l) => (
            <LabelTag key={l} label={l} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pl-6">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={task.priority} />
          <span
            className={cn(
              'text-[11px]',
              due.tone === 'overdue' && 'text-danger',
              due.tone === 'soon' && 'text-warn',
              due.tone === 'none' && 'text-muted',
              due.tone === 'normal' && 'text-slate-400',
            )}
          >
            {due.text}
          </span>
        </div>
        {assignee && <Avatar name={assignee.name} color={assignee.avatarColor} size={22} />}
      </div>
    </div>
  )
}