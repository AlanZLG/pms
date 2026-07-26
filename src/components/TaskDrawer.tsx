// 任务详情抽屉(含评论)

import { useEffect, useState } from 'react'
import { X, Send, Trash2, Calendar, Flag, Tag } from 'lucide-react'
import { api } from '@/lib/api'
import { Avatar, Button, PriorityBadge, StatusBadge, LabelTag, Textarea } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { fmtDateTime, fromNow, dueLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task, Comment } from '../../shared/types'

interface Props {
  taskId: string | null
  onClose: () => void
  onChanged: () => void
}

export default function TaskDrawer({ taskId, onClose, onChanged }: Props) {
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
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
      })
      .finally(() => setLoading(false))
  }, [taskId])

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