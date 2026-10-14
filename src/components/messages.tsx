// 站内消息：右键菜单 / 发送弹窗 / 待办卡「消息」Tab（会话列表 + 会话回复）
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, MessageSquarePlus, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, EmptyState } from '@/components/ui'
import { Modal } from '@/components/ProjectDialog'
import { cn } from '@/lib/utils'
import { firstChar, fmtDateTime, fromNow } from '@/lib/date'
import type { Message, MessageThread } from '../../shared/types'

// ===== 右键菜单 =====
export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  useEffect(() => {
    // 冒泡阶段监听 click：菜单项自身 onClick 先执行，再统一关闭
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 防止菜单超出视口
  const left = Math.max(8, Math.min(x, window.innerWidth - 210))
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 40 - 16))

  return createPortal(
    <div
      className="fixed z-[70] min-w-48 overflow-hidden rounded-xl border border-bg-border bg-bg-panel py-1 shadow-xl animate-pop-in"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => { onClose(); it.onClick() }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition hover:bg-bg-soft hover:text-text-primary"
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

// ===== 发送弹窗 =====
export function SendMessageModal({
  recipientId,
  recipientName,
  contextLabel,
  taskId,
  projectId,
  defaultContent = '',
  onClose,
  onSent,
}: {
  recipientId: string
  recipientName: string
  contextLabel: string
  taskId?: string | null
  projectId?: string | null
  defaultContent?: string
  onClose: () => void
  onSent?: () => void
}) {
  const [content, setContent] = useState(defaultContent)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const canSend = !!content.trim() && !sending

  async function send() {
    if (!canSend) return
    setSending(true)
    setError('')
    try {
      await api.sendMessage({ recipientId, content: content.trim(), taskId, projectId })
      onSent?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败，请稍后重试')
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="发送站内消息">
      <div className="space-y-4">
        <div className="rounded-lg bg-bg-soft px-3 py-2 text-sm">
          <span className="text-muted">收件人：</span>
          <span className="text-text-primary">{recipientName}</span>
          <span className="text-muted"> · 关于 </span>
          <span className="text-text-primary">{contextLabel}</span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          maxLength={2000}
          autoFocus
          placeholder="输入消息内容…"
          className="w-full resize-none rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {content.length}/2000
            {error && <span className="ml-2 text-danger">{error}</span>}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" disabled={!canSend} onClick={send}>
              <Send className="h-3.5 w-3.5" /> 发送
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ===== 待办卡「消息」Tab =====
// 会话上下文标签：任务 > 项目 > 私信
export function threadContext(t: Pick<MessageThread, 'taskTitle' | 'projectName'>): string {
  if (t.taskTitle) return `任务「${t.taskTitle}」`
  if (t.projectName) return `项目「${t.projectName}」`
  return '私信'
}

export function MessagesTab({
  threads,
  userId,
  revalidateThreads,
}: {
  threads: MessageThread[]
  userId: string
  revalidateThreads: () => void
}) {
  const [openThread, setOpenThread] = useState<MessageThread | null>(null)

  if (openThread) {
    return (
      <ConversationView
        thread={openThread}
        userId={userId}
        onBack={() => setOpenThread(null)}
        revalidateThreads={revalidateThreads}
      />
    )
  }

  if (threads.length === 0) {
    return <EmptyState title="暂无消息" hint="右键逾期任务/项目可给负责人或执行者发消息" />
  }

  return (
    <ul className="divide-y divide-bg-border">
      {threads.map((t) => (
        <li key={`${t.peerId}|${t.taskId || t.projectId || 'direct'}`}>
          <button
            type="button"
            onClick={() => setOpenThread(t)}
            className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-bg-soft/40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-medium text-brand-soft">
              {firstChar(t.peerName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-text-primary">{t.peerName}</span>
                <span className="shrink-0 truncate rounded bg-bg-soft px-1.5 py-0.5 text-xs text-muted">{threadContext(t)}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">{fromNow(t.lastAt)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={cn('flex-1 truncate text-xs', t.unread > 0 ? 'text-text-primary' : 'text-muted')}>
                  {t.lastContent}
                </span>
                {t.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-medium text-white">{t.unread}</span>
                )}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

// 会话详情：消息气泡 + 回复框；打开即把对方发来的未读标为已读
function ConversationView({
  thread,
  userId,
  onBack,
  revalidateThreads,
}: {
  thread: MessageThread
  userId: string
  onBack: () => void
  revalidateThreads: () => void
}) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const peerId = thread.peerId
  const taskId = thread.taskId
  const projectId = thread.projectId

  const load = useCallback(async () => {
    try {
      const { messages } = await api.listThreadMessages(peerId, taskId, projectId)
      setMessages(messages)
      const hasUnread = messages.some((m) => m.recipientId === userId && !m.read)
      if (hasUnread) {
        api.markThreadRead(peerId, taskId, projectId).then(revalidateThreads).catch(() => {})
      }
    } catch (e) {
      setMessages([])
      setError(e instanceof Error ? e.message : '加载会话失败')
    }
  }, [peerId, taskId, projectId, userId, revalidateThreads])

  useEffect(() => { load() }, [load])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages?.length])

  async function sendReply() {
    const content = reply.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    try {
      await api.sendMessage({ recipientId: peerId, content, taskId, projectId })
      setReply('')
      await load()
      revalidateThreads()
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 border-b border-bg-border pb-3">
        <button type="button" onClick={onBack} className="text-muted transition hover:text-text-secondary" aria-label="返回会话列表">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-medium text-brand-soft">
          {firstChar(thread.peerName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-text-primary">{thread.peerName}</p>
          <p className="truncate text-xs text-muted">{threadContext(thread)}</p>
        </div>
      </div>

      <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {(messages ?? []).map((m) => {
          const mine = m.senderId === userId
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', mine ? 'bg-brand/20 text-text-primary' : 'bg-bg-soft text-text-secondary')}>
                {!mine && <p className="mb-0.5 text-xs text-muted">{m.senderName}</p>}
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className={cn('mt-1 text-right text-[10px]', mine ? 'text-brand-soft/70' : 'text-muted')}>{fmtDateTime(m.createdAt)}</p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 border-t border-bg-border pt-3">
        {error && <p className="mb-2 text-xs text-danger">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendReply()
              }
            }}
            rows={2}
            placeholder={`回复 ${thread.peerName}…（Enter 发送，Shift+Enter 换行）`}
            className="flex-1 resize-none rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <Button size="sm" disabled={!reply.trim() || sending} onClick={sendReply}>
            <Send className="h-3.5 w-3.5" /> 发送
          </Button>
        </div>
      </div>
    </div>
  )
}

// 右键菜单「发送站内消息」的图标，供调用方复用
export const MessageMenuIcon = <MessageSquarePlus className="h-4 w-4" />
