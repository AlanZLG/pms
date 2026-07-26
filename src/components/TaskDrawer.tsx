// 任务详情抽屉(含评论)

import { useEffect, useState } from 'react'
import { X, Send, Trash2, Calendar, Flag, Tag, Check, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { Avatar, Button, PriorityBadge, StatusBadge, LabelTag, Textarea, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { fmtDateTime, fromNow, dueLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task, Comment, Subtask } from '../../shared/types'

interface Props {
  taskId: string | null
  onClose: () => void
  onChanged: () => void
}

export default function TaskDrawer({ taskId, onClose, onChanged }: Props) {
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [subtaskBusy, setSubtaskBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const user = useAppStore((s) => s.user)
  const notify = useAppStore((s) => s.notify)

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      return
    }
    setLoading(true)
    api
      .getTask(taskId)
      .then((r) => {
        setTask(r.task)
        setComments(r.comments)
        setSubtasks(r.subtasks || [])
      })
      .finally(() => setLoading(false))
  }, [taskId])

  async function addSubtask() {
    if (!task || !newSubtask.trim()) return
    setSubtaskBusy(true)
    try {
      const { subtask: s } = await api.createSubtask(task.id, newSubtask.trim())
      setSubtasks((prev) => [...prev, s])
      setNewSubtask('')
      refreshComments()
    } catch (e: any) {
      notify('error', e?.message || '添加失败')
    } finally {
      setSubtaskBusy(false)
    }
  }

  async function toggleSubtask(s: Subtask) {
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))
    try {
      await api.updateSubtask(s.id, { done: !s.done })
      refreshComments()
    } catch (e: any) {
      setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: s.done } : x)))
      notify('error', e?.message || '更新失败')
    }
  }

  async function removeSubtask(s: Subtask) {
    const prev = subtasks
    setSubtasks((p) => p.filter((x) => x.id !== s.id))
    try {
      await api.deleteSubtask(s.id)
      refreshComments()
    } catch (e: any) {
      setSubtasks(prev)
      notify('error', e?.message || '删除失败')
    }
  }

  async function refreshComments() {
    if (!task) return
    try {
      const r = await api.getTask(task.id)
      setComments(r.comments)
    } catch {}
  }

  async function postComment() {
    if (!task || !comment.trim()) return
    setPosting(true)
    try {
      const { comment: c } = await api.addComment(task.id, comment.trim())
      setComments((prev) => [...prev, c])
      setComment('')
    } catch (e: any) {
      notify('error', e?.message || '评论失败')
    } finally {
      setPosting(false)
    }
  }

  async function removeTask() {
    if (!task) return
    if (!confirm('确定删除该任务?')) return
    await api.deleteTask(task.id)
    notify('success', '任务已删除')
    onChanged()
    onClose()
  }

  const due = dueLabel(task?.dueDate || null)

  return (
    <div className={cn('fixed inset-0 z-40 flex', taskId ? 'pointer-events-auto' : 'pointer-events-none')}>
      {/* 背景遮罩 */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity',
          taskId ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      {/* 抽屉 */}
      <aside
        className={cn(
          'relative ml-auto h-full w-full max-w-lg transform border-l border-bg-border bg-bg-soft shadow-card transition-transform duration-300',
          taskId ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {loading || !task ? (
          <div className="flex h-full items-center justify-center text-muted">加载中…</div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-bg-border px-5 py-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
              </div>
              <button onClick={onClose} className="text-muted hover:text-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              <h2 className="mb-3 font-display text-2xl text-white">{task.title}</h2>
              {task.description ? (
                <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {task.description}
                </p>
              ) : (
                <p className="mb-4 text-sm italic text-muted">暂无描述</p>
              )}

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-bg-panel/60 p-4 text-sm">
                <div className="flex items-center gap-2 text-muted">
                  <Calendar className="h-4 w-4" />
                  <span>截止</span>
                  <span
                    className={cn(
                      'ml-auto font-mono',
                      due.tone === 'overdue' && 'text-danger',
                      due.tone === 'soon' && 'text-warn',
                      due.tone === 'none' && 'text-muted',
                      due.tone === 'normal' && 'text-slate-200',
                    )}
                  >
                    {due.text}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Flag className="h-4 w-4" />
                  <span>优先级</span>
                  <span className="ml-auto">
                    <PriorityBadge priority={task.priority} />
                  </span>
                </div>
                {task.labels.length > 0 && (
                  <div className="col-span-2 flex items-center gap-2 text-muted">
                    <Tag className="h-4 w-4" />
                    <span>标签</span>
                    <span className="ml-auto flex flex-wrap justify-end gap-1">
                      {task.labels.map((l) => (
                        <LabelTag key={l} label={l} />
                      ))}
                    </span>
                  </div>
                )}
              </div>

              {/* 子任务清单 */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display text-base text-slate-100">
                    子任务 ({subtasks.filter((s) => s.done).length}/{subtasks.length})
                  </h3>
                  {subtasks.length > 0 && (
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-soft">
                      <div
                        className="h-full rounded-full bg-ok transition-all"
                        style={{
                          width: `${Math.round((subtasks.filter((s) => s.done).length / subtasks.length) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-lg px-1 py-1 group">
                      <button
                        onClick={() => toggleSubtask(s)}
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition',
                          s.done
                            ? 'border-ok bg-ok text-white'
                            : 'border-bg-border hover:border-brand',
                        )}
                      >
                        {s.done && <Check className="h-3 w-3" />}
                      </button>
                      <span
                        className={cn(
                          'flex-1 text-sm transition',
                          s.done ? 'text-muted line-through' : 'text-slate-200',
                        )}
                      >
                        {s.title}
                      </span>
                      <button
                        onClick={() => removeSubtask(s)}
                        className="text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {subtasks.length === 0 && (
                    <li className="rounded-xl border border-dashed border-bg-border px-3 py-4 text-center text-xs text-muted">
                      还没有子任务
                    </li>
                  )}
                </ul>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        addSubtask()
                      }
                    }}
                    placeholder="添加子任务,回车确认"
                    className="text-sm"
                  />
                  <Button size="sm" variant="soft" onClick={addSubtask} disabled={subtaskBusy || !newSubtask.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* 评论 */}
              <div className="mt-6">
                <h3 className="mb-3 font-display text-base text-slate-100">评论 ({comments.length})</h3>
                <ul className="space-y-3">
                  {comments.map((c) => {
                    const isSystem = c.content.startsWith('—') && c.content.endsWith('—')
                    return (
                      <li key={c.id} className="flex gap-3">
                        <Avatar name={c.userName} color={c.avatarColor} size={32} />
                        <div
                          className={
                            isSystem
                              ? 'flex-1 rounded-xl border border-dashed border-bg-border bg-transparent px-3 py-2'
                              : 'flex-1 rounded-xl rounded-tl-sm bg-bg-panel/70 px-3 py-2'
                          }
                        >
                          <div className="flex items-center justify-between text-xs text-muted">
                            <span className="font-medium text-slate-200">{c.userName}</span>
                            <span>{fromNow(c.createdAt)}</span>
                          </div>
                          <p
                            className={
                              isSystem
                                ? 'mt-1 text-sm italic text-muted'
                                : 'mt-1 whitespace-pre-wrap text-sm text-slate-200'
                            }
                          >
                            {c.content}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                  {comments.length === 0 && (
                    <li className="rounded-xl border border-dashed border-bg-border px-3 py-6 text-center text-sm text-muted">
                      还没有评论,来弹第一条吧
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* 底部操作区 */}
            <div className="border-t border-bg-border p-4">
              <div className="mb-3 flex items-start gap-2">
                {user && <Avatar name={user.name} color={user.avatarColor} size={32} />}
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="写下你的评论…"
                />
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="danger" size="sm" onClick={removeTask}>
                  <Trash2 className="h-3.5 w-3.5" /> 删除任务
                </Button>
                <Button size="sm" onClick={postComment} disabled={posting || !comment.trim()}>
                  <Send className="h-3.5 w-3.5" /> 发表评论
                </Button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}