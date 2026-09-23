// 任务详情抽屉(含评论 + 附件)

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, Trash2, Calendar, Flag, Tag, Check, Plus, AtSign, Paperclip, Download, FileText, FileImage, FileCode, ChevronDown, ChevronUp, Clock, UserPlus, Activity, Calendar as CalendarIcon, Trash2 as RestoreIcon, Sparkles, ArrowRight, FileSpreadsheet, GripVertical } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Avatar, Button, PriorityBadge, StatusBadge, LabelTag, Textarea, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { useAsync } from '@/hooks/useAsync'
import { fromNow, dueLabel } from '@/lib/date'
import { cn, sortUsers } from '@/lib/utils'
import { inlineDiff, parseChangeDetail } from '@/lib/diff'
import TaskToOpLogDialog from '@/components/TaskToOpLogDialog'
import type { Task, Comment, Subtask, User, Attachment, TaskHistory, TaskHours } from '../../shared/types'

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
  const [history, setHistory] = useState<TaskHistory[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState('')
  const [subtaskBusy, setSubtaskBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [uploading, setUploading] = useState(false)
  // 工时登记
  const [hours, setHours] = useState<TaskHours[]>([])
  const [hoursForm, setHoursForm] = useState({ date: new Date().toISOString().slice(0, 10), plannedHours: '', actualHours: '', billedHours: '', description: '' })
  const [hoursBusy, setHoursBusy] = useState(false)
  // 转运维台账
  const [showOpLogDialog, setShowOpLogDialog] = useState(false)
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

  const filteredUsers = sortUsers(allUsers.filter(
    (u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()) && u.id !== user?.id,
  ))

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
    setShowAllHistory(false)
    api
      .getTask(taskId)
      .then((r) => {
        setTask(r.task)
        setComments(r.comments)
        setSubtasks(r.subtasks || [])
        setAttachments(r.attachments || [])
        setHistory(r.history || [])
      })
      .finally(() => setLoading(false))
    api
      .listTaskHours(taskId)
      .then((r) => setHours(r.hours || []))
      .catch(() => setHours([]))
  }, [taskId])

  /** 重新拉取任务信息（同步进度等字段） */
  async function refreshTask() {
    if (!task) return
    try {
      const r = await api.getTask(task.id)
      setTask(r.task)
      setSubtasks(r.subtasks || [])
    } catch {
      // 忽略刷新错误
    }
  }

  async function addSubtask() {
    if (!task || !newSubtask.trim()) return
    setSubtaskBusy(true)
    try {
      const { subtask: s } = await api.createSubtask(task.id, newSubtask.trim(), newSubtaskAssignee || null)
      setSubtasks((prev) => [...prev, s])
      setNewSubtask('')
      setNewSubtaskAssignee('')
      refreshComments()
      refreshTask()
      onChanged()
    } catch (e) {
      notify('error', getErrorMessage(e, '添加失败'))
    } finally {
      setSubtaskBusy(false)
    }
  }

  async function toggleSubtask(s: Subtask) {
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))
    try {
      await api.updateSubtask(s.id, { done: !s.done })
      refreshComments()
      refreshTask()
      onChanged()
    } catch (e) {
      setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, done: s.done } : x)))
      notify('error', getErrorMessage(e, '更新失败'))
    }
  }

  /** 指派/变更子任务负责人 */
  async function assignSubtask(s: Subtask, assigneeId: string | null) {
    setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, assigneeId } : x)))
    try {
      await api.updateSubtask(s.id, { assigneeId })
      onChanged()
    } catch (e) {
      setSubtasks((prev) => prev.map((x) => (x.id === s.id ? { ...x, assigneeId: s.assigneeId } : x)))
      notify('error', getErrorMessage(e, '指派失败'))
    }
  }

  async function removeSubtask(s: Subtask) {
    const prev = subtasks
    setSubtasks((p) => p.filter((x) => x.id !== s.id))
    try {
      await api.deleteSubtask(s.id)
      refreshComments()
      refreshTask()
      onChanged()
    } catch (e) {
      setSubtasks(prev)
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }

  // ===== 子任务编辑 / 拖拽排序 =====
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null)
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('')

  function startEditSubtask(s: Subtask) {
    setEditingSubtaskId(s.id)
    setEditSubtaskTitle(s.title)
  }

  async function saveSubtaskEdit(s: Subtask) {
    const title = editSubtaskTitle.trim()
    setEditingSubtaskId(null)
    if (!title || title === s.title) return
    const prev = subtasks
    setSubtasks((p) => p.map((x) => (x.id === s.id ? { ...x, title } : x)))
    try {
      await api.updateSubtask(s.id, { title })
      refreshComments()
      onChanged()
    } catch (e) {
      setSubtasks(prev)
      notify('error', getErrorMessage(e, '修改失败'))
    }
  }

  const subtaskSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  async function handleSubtaskDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || !task) return
    const oldIndex = subtasks.findIndex((s) => s.id === active.id)
    const newIndex = subtasks.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const prev = subtasks
    const next = arrayMove(prev, oldIndex, newIndex)
    setSubtasks(next)
    try {
      await api.reorderSubtasks(task.id, next.map((s) => s.id))
    } catch (err) {
      setSubtasks(prev)
      notify('error', getErrorMessage(err, '排序失败'))
    }
  }

  // ===== 工时登记 =====
  const totalActualHours = hours.reduce((sum, h) => sum + h.actualHours, 0)
  const totalBilledHours = hours.reduce((sum, h) => sum + h.billedHours, 0)

  async function addHours() {
    if (!task) return
    const actual = Number(hoursForm.actualHours) || 0
    const billed = Number(hoursForm.billedHours) || 0
    const planned = Number(hoursForm.plannedHours) || 0
    if (!hoursForm.date || (actual <= 0 && billed <= 0)) {
      notify('error', '请填写日期和至少一项工时')
      return
    }
    setHoursBusy(true)
    try {
      const { record } = await api.createTaskHours(task.id, {
        date: hoursForm.date,
        plannedHours: planned,
        actualHours: actual,
        billedHours: billed,
        description: hoursForm.description.trim(),
      })
      setHours((prev) => [...prev, record])
      setHoursForm({ date: hoursForm.date, plannedHours: '', actualHours: '', billedHours: '', description: '' })
      notify('success', '工时已登记')
    } catch (e) {
      notify('error', getErrorMessage(e, '工时登记失败'))
    } finally {
      setHoursBusy(false)
    }
  }

  async function removeHours(id: string) {
    try {
      await api.deleteTaskHours(id)
      setHours((prev) => prev.filter((h) => h.id !== id))
      notify('success', '工时记录已删除')
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }

  function userName(id: string | null | undefined): string {
    if (!id) return ''
    return allUsers.find((u) => u.id === id)?.name || ''
  }

  async function refreshComments() {
    if (!task) return
    try {
      const r = await api.getTask(task.id)
      setComments(r.comments)
    } catch {
      // 忽略刷新错误
    }
  }

  async function postComment() {
    if (!task || !comment.trim()) return
    setPosting(true)
    try {
      const { comment: c } = await api.addComment(task.id, comment.trim())
      setComments((prev) => [...prev, c])
      setComment('')
    } catch (e) {
      notify('error', getErrorMessage(e, '评论失败'))
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
    } catch (e) {
      notify('error', getErrorMessage(e, '上传失败'))
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
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
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

  const due = dueLabel(task?.dueDate || null, task?.status === 'done')

  return createPortal(
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
              <button onClick={onClose} className="text-muted hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              <h2 className="mb-3 font-display text-2xl text-text-primary">{task.title}</h2>
              {task.description ? (
                <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
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
                      due.tone === 'normal' && 'text-text-secondary',
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
                <div className="col-span-2 flex items-center gap-2 text-muted">
                  <Clock className="h-4 w-4" />
                  <span>进度</span>
                  <div className="ml-auto flex flex-1 items-center justify-end gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-soft">
                      <div
                        className="h-full rounded-full bg-brand transition-all"
                        style={{ width: `${task.progress || 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-text-secondary">{task.progress || 0}%</span>
                  </div>
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
                  <h3 className="font-display text-base text-text-primary">
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
                        <div className="truncate text-sm text-text-secondary" title={a.originalName}>
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
                  <h3 className="font-display text-base text-text-primary">
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
                  <DndContext sensors={subtaskSensors} collisionDetection={closestCenter} onDragEnd={handleSubtaskDragEnd}>
                    <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                      {subtasks.map((s) => (
                        <SortableSubtaskRow
                          key={s.id}
                          s={s}
                          editing={editingSubtaskId === s.id}
                          editTitle={editSubtaskTitle}
                          onEditTitleChange={setEditSubtaskTitle}
                          onStartEdit={startEditSubtask}
                          onSaveEdit={saveSubtaskEdit}
                          onCancelEdit={() => setEditingSubtaskId(null)}
                          onToggle={toggleSubtask}
                          onAssign={assignSubtask}
                          onRemove={removeSubtask}
                          users={sortUsers(allUsers)}
                          assigneeName={s.assigneeId ? userName(s.assigneeId) : null}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
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
                    className="flex-1 text-sm"
                  />
                  <select
                    value={newSubtaskAssignee}
                    onChange={(e) => setNewSubtaskAssignee(e.target.value)}
                    className="h-9 shrink-0 rounded-lg border border-bg-border bg-bg-soft px-2 text-xs text-muted outline-none focus:border-brand"
                    title="子任务负责人（可选）"
                  >
                    <option value="">负责人…</option>
                    {sortUsers(allUsers).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="soft" onClick={addSubtask} disabled={subtaskBusy || !newSubtask.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* 工时登记（内部投入 / 对客户计费分开） */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display text-base text-text-primary">工时登记 ({hours.length})</h3>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span>
                      内部投入 <span className="font-mono text-text-secondary">{totalActualHours.toFixed(1)}h</span>
                    </span>
                    <span>
                      计费工数 <span className="font-mono text-brand-soft">{totalBilledHours.toFixed(1)}h</span>
                    </span>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {hours.map((h) => (
                    <li
                      key={h.id}
                      className="group flex items-center gap-2 rounded-lg bg-bg-panel/50 px-3 py-2 text-sm"
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="font-mono text-xs text-text-secondary">{h.date}</span>
                      <span className="shrink-0 rounded-full bg-bg-soft px-2 py-0.5 text-xs text-muted">
                        {userName(h.userId) || '未知'}
                      </span>
                      <span className="text-xs text-text-secondary">内部 {h.actualHours.toFixed(1)}h</span>
                      {h.plannedHours > 0 && <span className="text-xs text-muted">计划 {h.plannedHours.toFixed(1)}h</span>}
                      <span className="text-xs text-brand-soft">计费 {h.billedHours.toFixed(1)}h</span>
                      {h.description && (
                        <span className="min-w-0 flex-1 truncate text-xs text-muted" title={h.description}>
                          {h.description}
                        </span>
                      )}
                      <button
                        onClick={() => removeHours(h.id)}
                        className="ml-auto shrink-0 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {hours.length === 0 && (
                    <li className="rounded-xl border border-dashed border-bg-border px-3 py-4 text-center text-xs text-muted">
                      还没有工时记录
                    </li>
                  )}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={hoursForm.date}
                    onChange={(e) => setHoursForm({ ...hoursForm, date: e.target.value })}
                    className="w-36 text-sm"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="计划工时"
                    value={hoursForm.plannedHours}
                    onChange={(e) => setHoursForm({ ...hoursForm, plannedHours: e.target.value })}
                    className="w-24 text-sm"
                    title="本次投入对应的计划工时（选填）"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="内部工时"
                    value={hoursForm.actualHours}
                    onChange={(e) => setHoursForm({ ...hoursForm, actualHours: e.target.value })}
                    className="w-24 text-sm"
                    title="实际投入工时（内部成本口径）"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="计费工数"
                    value={hoursForm.billedHours}
                    onChange={(e) => setHoursForm({ ...hoursForm, billedHours: e.target.value })}
                    className="w-24 text-sm"
                    title="向客户结算的工数"
                  />
                  <Input
                    placeholder="备注"
                    value={hoursForm.description}
                    onChange={(e) => setHoursForm({ ...hoursForm, description: e.target.value })}
                    className="min-w-0 flex-1 text-sm"
                  />
                  <Button size="sm" variant="soft" onClick={addHours} disabled={hoursBusy}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* 操作历史 */}
              <div className="mt-6">
                <button
                  onClick={() => setHistoryExpanded((v) => !v)}
                  className="mb-3 flex w-full items-center justify-between"
                >
                  <h3 className="font-display text-base text-text-primary">操作历史 ({history.length})</h3>
                  {historyExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted" />
                  )}
                </button>
                {historyExpanded && (
                  <>
                    <ul className="space-y-0">
                      {(showAllHistory ? history : history.slice(0, 20)).map((h, i) => {
                        const parsed = h.detail ? parseChangeDetail(h.detail) : null
                        const Icon = getHistoryIcon(h.action)
                        const isLast = i === (showAllHistory ? history.length : Math.min(history.length, 20)) - 1
                        return (
                          <li key={h.id} className="relative flex gap-3 pb-3">
                            {!isLast && (
                              <div className="absolute left-[15px] top-8 bottom-0 w-px bg-bg-border" />
                            )}
                            <div className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-bg-border bg-bg-panel text-muted">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1 pt-1">
                              <div className="text-sm">
                                {parsed ? (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-medium text-text-secondary">{parsed.field}:</span>
                                    <DiffedValue oldVal={parsed.old} newVal={parsed.new} />
                                  </div>
                                ) : (
                                  <span className="text-text-secondary">{h.detail || h.action}</span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                                <span className="font-medium text-text-secondary/80">{h.userName || '未知用户'}</span>
                                <span>·</span>
                                <span>{fromNow(h.createdAt)}</span>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                      {history.length === 0 && (
                        <li className="rounded-xl border border-dashed border-bg-border px-3 py-6 text-center text-sm text-muted">
                          暂无操作记录
                        </li>
                      )}
                    </ul>
                    {history.length > 20 && (
                      <button
                        onClick={() => setShowAllHistory((v) => !v)}
                        className="mt-2 w-full rounded-lg border border-bg-border bg-bg-panel/30 py-2 text-xs text-muted transition hover:bg-bg-panel hover:text-text-secondary"
                      >
                        {showAllHistory ? '收起' : `查看更多 (${history.length - 20} 条)`}
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* 评论 */}
              <div className="mt-6">
                <h3 className="mb-3 font-display text-base text-text-primary">评论 ({comments.length})</h3>
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
                            <span className="font-medium text-text-secondary">{c.userName}</span>
                            <span>{fromNow(c.createdAt)}</span>
                          </div>
                          <p
                            className={
                              isSystem
                                ? 'mt-1 text-sm italic text-muted'
                                : 'mt-1 whitespace-pre-wrap text-sm text-text-secondary'
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
                                : 'text-text-secondary hover:bg-bg',
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
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" onClick={removeTask}>
                    <Trash2 className="h-3.5 w-3.5" /> 删除任务
                  </Button>
                  <Button variant="soft" size="sm" onClick={() => setShowOpLogDialog(true)} title="复制任务内容到运维台账/课题表，保存后自动关联">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> 转台账/课题表
                  </Button>
                </div>
                <Button size="sm" onClick={postComment} disabled={posting || !comment.trim()}>
                  <Send className="h-3.5 w-3.5" /> 发表评论
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 任务 → 运维台账转换对话框 */}
        {task && (
          <TaskToOpLogDialog
            open={showOpLogDialog}
            task={task}
            onClose={() => setShowOpLogDialog(false)}
            onCreated={() => {
              refreshComments()
              onChanged()
            }}
          />
        )}
      </aside>
    </div>,
    document.body,
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

function getHistoryIcon(action: string) {
  const map: Record<string, typeof Sparkles> = {
    create: Sparkles,
    status_change: Activity,
    assignee_change: UserPlus,
    progress_update: Clock,
    date_update: CalendarIcon,
    trash: Trash2,
    restore: RestoreIcon,
  }
  return map[action] || Activity
}

function DiffedValue({ oldVal, newVal }: { oldVal: string; newVal: string }) {
  const segments = inlineDiff(oldVal, newVal)
  const hasAdded = segments.some((s) => s.type === 'added')
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      <span className="text-danger line-through decoration-danger/60">
        {oldVal}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-muted" />
      <span className="text-ok">
        {hasAdded ? (
          segments.map((seg, i) => {
            if (seg.type === 'added') {
              return (
                <span key={i} className="rounded bg-ok/10 px-0.5">
                  {seg.text}
                </span>
              )
            }
            return <span key={i}>{seg.text}</span>
          })
        ) : (
          <span className="rounded bg-ok/10 px-0.5">{newVal}</span>
        )}
      </span>
    </span>
  )
}

// ===== 子任务行（可拖拽 / 可编辑）=====
function SortableSubtaskRow({
  s,
  editing,
  editTitle,
  onEditTitleChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onToggle,
  onAssign,
  onRemove,
  users,
  assigneeName,
}: {
  s: Subtask
  editing: boolean
  editTitle: string
  onEditTitleChange: (v: string) => void
  onStartEdit: (s: Subtask) => void
  onSaveEdit: (s: Subtask) => void
  onCancelEdit: () => void
  onToggle: (s: Subtask) => void
  onAssign: (s: Subtask, assigneeId: string | null) => void
  onRemove: (s: Subtask) => void
  users: User[]
  assigneeName: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition }
    : undefined
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 rounded-lg px-1 py-1',
        isDragging && 'relative z-10 opacity-60',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none text-muted opacity-0 transition hover:text-brand-soft group-hover:opacity-100 active:cursor-grabbing"
        title="拖拽排序"
        onClick={(e) => e.preventDefault()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onToggle(s)}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition',
          s.done
            ? 'border-ok bg-ok text-text-primary'
            : 'border-bg-border hover:border-brand',
        )}
      >
        {s.done && <Check className="h-3 w-3" />}
      </button>
      {editing ? (
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => onEditTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSaveEdit(s)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancelEdit()
            }
          }}
          onBlur={() => onSaveEdit(s)}
          className="min-w-0 flex-1 rounded border border-brand bg-bg-soft px-1.5 py-0.5 text-sm text-text-primary outline-none"
        />
      ) : (
        <span
          onClick={() => onStartEdit(s)}
          className={cn(
            'min-w-0 flex-1 cursor-text truncate text-sm transition hover:text-text-primary',
            s.done ? 'text-muted line-through' : 'text-text-secondary',
          )}
          title={s.title}
        >
          {s.title}
        </span>
      )}
      <select
        value={s.assigneeId || ''}
        onChange={(e) => onAssign(s, e.target.value || null)}
        className="max-w-[6.5rem] shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted outline-none transition hover:border-bg-border focus:border-brand"
        title={s.assigneeId ? `负责人: ${assigneeName}` : '指派负责人'}
      >
        <option value="">
          {s.assigneeId ? assigneeName || '已指派' : '指派…'}
        </option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <button
        onClick={() => onRemove(s)}
        className="text-muted opacity-0 hover:text-danger group-hover:opacity-100"
        title="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}