// 任务详情抽屉(含评论 + 附件)

import { useEffect, useState, useRef, useCallback } from 'react'
import { X, Send, Trash2, Calendar, Flag, Tag, Check, Plus, AtSign, Paperclip, Download, FileText, FileImage, FileCode } from 'lucide-react'
import { api } from '@/lib/api'
import { Avatar, Button, PriorityBadge, StatusBadge, LabelTag, Textarea, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { useAsync } from '@/hooks/useAsync'
import { fromNow, dueLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task, Comment, Subtask, User, Attachment } from '../../shared/types'

interface Props {
  taskId: string | null
  onClose: () => void
  onChanged: () => void
}

export default function TaskDrawer({ taskId, onClose, onChanged }: Props) {
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [subtaskBusy, setSubtaskBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const user = useAppStore((s) => s.user)
  const notify = useAppStore((s) => s.notify)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const users = useAsync(() => api.listUsers(), [])
  const allUsers: User[] = users.data?.users || []

  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showMention, setShowMention] = useState(false)
  const [mentionStart, setMentionStart] = useState(-1)

  const filteredUsers = allUsers.filter(
    (u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()) && u.id !== user?.id,
  )

  function handleCommentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setComment(value)
    const cursorPos = e.target.selectionStart
    const before = value.slice(0, cursorPos)
    const atIdx = before.lastIndexOf('@')
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(before[atIdx - 1] || ''))) {
      const query = before.slice(atIdx + 1)
      if (!/\s/.test(query) && query.length <= 20) {
        setMentionQuery(query)
        setMentionStart(atIdx)
        setMentionIndex(0)
        setShowMention(true)
        return
      }
    }
    setShowMention(false)
  }

  function insertMention(name: string) {
    if (mentionStart < 0) return
    const before = comment.slice(0, mentionStart)
    const after = comment.slice(mentionStart + 1 + mentionQuery.length)
    const newComment = `${before}@${name} ${after}`
    setComment(newComment)
    setShowMention(false)
    if (textareaRef.current) {
      const newPos = before.length + name.length + 3
      textareaRef.current.focus()
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(newPos, newPos)
      })
    }
  }

  function handleCommentKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showMention && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % filteredUsers.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + filteredUsers.length) % filteredUsers.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredUsers[mentionIndex].name)
      } else if (e.key === 'Escape') {
        setShowMention(false)
      }
    }
  }

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
        setAttachments(r.attachments || [])
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

  const refreshTaskData = useCallback(async () => {
    if (!task) return
    try {
      const r = await api.getTask(task.id)
      setComments(r.comments)
      setSubtasks(r.subtasks || [])
      setAttachments(r.attachments || [])
    } catch {}
  }, [task])

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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!task || !e.target.files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(e.target.files)) {
        const { attachment: att } = await api.uploadAttachment(task.id, file)
        setAttachments((prev) => [att, ...prev])
      }
      notify('success', '附件已上传')
    } catch (e: any) {
      notify('error', e?.message || '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function deleteAttachment(id: string) {
    if (!confirm('确定删除该附件?')) return
    try {
      await api.deleteAttachment(id)
      setAttachments((prev) => prev.filter((a) => a.id !== id))
      notify('success', '附件已删除')
    } catch (e: any) {
      notify('error', e?.message || '删除失败')
    }
  }

  function getFileIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return <FileImage className="h-4 w-4 text-sky-300" />
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('sheet')) return <FileText className="h-4 w-4 text-warn" />
    if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('json')) return <FileCode className="h-4 w-4 text-brand-soft" />
    return <FileText className="h-4 w-4 text-muted" />
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

              {/* 附件 */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display text-base text-slate-100">
                    附件 ({attachments.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileUpload}
                      accept="*/*"
                    />
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {uploading ? '上传中…' : '上传'}
                    </Button>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="group flex items-center gap-2 rounded-lg bg-bg-panel/50 px-3 py-2 transition hover:bg-bg-panel"
                    >
                      {getFileIcon(a.mimeType)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-200" title={a.originalName}>
                          {a.originalName}
                        </div>
                        <div className="text-xs text-muted">
                          {formatFileSize(a.size)} · {a.userName} · {fromNow(a.createdAt)}
                        </div>
                      </div>
                      <a
                        href={api.getAttachmentUrl(a.id)}
                        download={a.originalName}
                        className="rounded-lg p-1.5 text-muted transition hover:bg-bg-soft hover:text-brand-soft"
                        title="下载"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => deleteAttachment(a.id)}
                        className="rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {attachments.length === 0 && (
                    <li className="rounded-xl border border-dashed border-bg-border px-3 py-4 text-center text-xs text-muted">
                      还没有附件
                    </li>
                  )}
                </ul>
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
                            {isSystem
                              ? c.content
                              : renderCommentWithMentions(c.content)}
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
                <div className="relative flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={comment}
                    onChange={handleCommentChange}
                    onKeyDown={handleCommentKeyDown}
                    rows={2}
                    placeholder="写下你的评论… 输入 @ 提及某人"
                  />
                  {showMention && filteredUsers.length > 0 && (
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-bg-border bg-bg-soft shadow-xl">
                      <div className="flex items-center gap-2 border-b border-bg-border px-3 py-2 text-xs text-muted">
                        <AtSign className="h-3.5 w-3.5" />
                        选择要提及的成员
                      </div>
                      <ul className="max-h-48 overflow-y-auto">
                        {filteredUsers.map((u, i) => (
                          <li
                            key={u.id}
                            onClick={() => insertMention(u.name)}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition',
                              i === mentionIndex
                                ? 'bg-brand/15 text-brand-soft'
                                : 'text-slate-200 hover:bg-bg',
                            )}
                            onMouseEnter={() => setMentionIndex(i)}
                          >
                            <Avatar name={u.name} color={u.avatarColor} size={24} />
                            <span>{u.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
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

function renderCommentWithMentions(content: string) {
  const parts = content.split(/(@\S+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="font-medium text-brand-soft">
          {part}
        </span>
      )
    }
    return part
  })
}