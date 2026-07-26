import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, UserPlus, Activity, MessageSquare, X, Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '@/stores/notifications'
import { cn } from '@/lib/utils'
import type { Notification } from '../../shared/types'

const iconMap = {
  assign: UserPlus,
  status: Activity,
  comment: MessageSquare,
  system: Inbox,
}

const colorMap = {
  assign: 'bg-brand/20 text-brand',
  status: 'bg-amber-500/20 text-amber-300',
  comment: 'bg-emerald-500/20 text-emerald-300',
  system: 'bg-slate-500/20 text-slate-300',
}

export default function NotificationDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const fetch = useNotificationStore((s) => s.fetch)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const items = useNotificationStore((s) => s.items)
  const unread = useNotificationStore((s) => s.unread)
  const fetched = useNotificationStore((s) => s.fetched)

  useEffect(() => {
    if (open && !fetched) fetch()
  }, [open, fetched, fetch])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function openItem(n: Notification) {
    if (!n.read) await markRead(n.id)
    setOpen(false)
    if (n.projectId) nav(`/projects/${n.projectId}`)
  }

  async function handleMarkAll() {
    await markAllRead()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-300 hover:bg-bg-soft"
        title="通知"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] overflow-hidden rounded-xl border border-bg-border bg-bg-soft shadow-2xl">
          <div className="flex items-center justify-between border-b border-bg-border px-4 py-3">
            <p className="text-sm font-semibold text-slate-100">通知</p>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="flex items-center gap-1 text-xs text-brand hover:text-brand-soft"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  全部已读
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted hover:bg-bg hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-muted">
                <Inbox className="h-8 w-8 opacity-40" />
                <p className="text-sm">暂无通知</p>
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const Icon = iconMap[n.type]
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => openItem(n)}
                        className={cn(
                          'flex w-full items-start gap-3 border-b border-bg-border/60 px-4 py-3 text-left transition hover:bg-bg',
                          !n.read && 'bg-brand/5',
                        )}
                      >
                        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', colorMap[n.type])}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-sm text-slate-100">
                            <span className="truncate">{n.title}</span>
                            {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />}
                          </p>
                          {n.body && (
                            <p className="mt-0.5 truncate text-xs text-muted">{n.body}</p>
                          )}
                          <p className="mt-1 text-[10px] text-muted">{formatTime(n.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} 天前`
  return d.toLocaleDateString('zh-CN')
}
