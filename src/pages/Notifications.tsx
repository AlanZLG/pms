import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  CheckCheck,
  Trash2,
  UserPlus,
  Activity,
  MessageSquare,
  Inbox,
  ChevronLeft,
} from 'lucide-react'
import { Card, Button, Skeleton, EmptyState } from '@/components/ui'
import { useNotificationStore } from '@/stores/notifications'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import type { Notification } from '../../shared/types'

const typeTabs = [
  { value: '', label: '全部', icon: Inbox },
  { value: 'assign', label: '分配', icon: UserPlus },
  { value: 'status', label: '状态', icon: Activity },
  { value: 'comment', label: '评论', icon: MessageSquare },
  { value: 'system', label: '系统', icon: Bell },
] as const

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

export default function Notifications() {
  const [filter, setFilter] = useState<string>('')
  const nav = useNavigate()
  const fetch = useNotificationStore((s) => s.fetch)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const remove = useNotificationStore((s) => s.remove)
  const items = useNotificationStore((s) => s.items)
  const unread = useNotificationStore((s) => s.unread)
  const loading = useNotificationStore((s) => s.loading)
  const notify = useAppStore((s) => s.notify)

  useEffect(() => {
    fetch(filter || undefined)
  }, [filter, fetch])

  async function openItem(n: Notification) {
    if (!n.read) await markRead(n.id)
    if (n.projectId) nav(`/projects/${n.projectId}`)
    else if (n.taskId) nav(`/projects`)
  }

  async function handleMarkAll() {
    await markAllRead()
    notify('success', '已全部标记为已读')
  }

  async function handleDelete(e: React.MouseEvent, n: Notification) {
    e.stopPropagation()
    await remove(n.id)
    notify('success', '通知已删除')
  }

  async function handleMarkSingle(e: React.MouseEvent, n: Notification) {
    e.stopPropagation()
    if (!n.read) await markRead(n.id)
  }

  const counts = {
    all: items.length,
    assign: items.filter((n) => n.type === 'assign').length,
    status: items.filter((n) => n.type === 'status').length,
    comment: items.filter((n) => n.type === 'comment').length,
    system: items.filter((n) => n.type === 'system').length,
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-white">通知中心</h2>
          <p className="mt-1 text-sm text-muted">
            管理系统通知与消息提醒 · 共 {items.length} 条,{unread} 条未读
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAll}>
              <CheckCheck className="h-4 w-4" /> 全部已读
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => nav(-1)}
          >
            <ChevronLeft className="h-4 w-4" /> 返回
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {typeTabs.map((tab) => {
          const count = tab.value ? counts[tab.value as keyof typeof counts] : counts.all
          const isActive = filter === tab.value
          return (
            <button
              key={tab.value || 'all'}
              onClick={() => setFilter(tab.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                isActive
                  ? 'bg-brand text-white shadow-glow'
                  : 'bg-bg-soft text-muted hover:text-slate-200',
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px]',
                  isActive ? 'bg-white/20 text-white' : 'bg-bg text-muted',
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="暂无通知"
            hint={filter ? `当前筛选下没有通知,切换其他类型查看` : `当有新消息时会出现在这里`}
          />
        ) : (
          <ul className="divide-y divide-bg-border">
            {items.map((n) => {
              const Icon = iconMap[n.type]
              return (
                <li key={n.id}>
                  <div
                    onClick={() => openItem(n)}
                    className={cn(
                      'flex cursor-pointer items-start gap-4 px-5 py-4 transition hover:bg-bg-soft/40',
                      !n.read && 'bg-brand/5',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
                        colorMap[n.type],
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {n.title}
                        </p>
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                        )}
                      </div>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                          {n.body}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
                        <span>{formatTime(n.createdAt)}</span>
                        {n.projectId && (
                          <span className="rounded bg-bg px-1.5 py-0.5 text-brand-soft">
                            项目
                          </span>
                        )}
                        {n.taskId && (
                          <span className="rounded bg-bg px-1.5 py-0.5 text-amber-300">
                            任务
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!n.read && (
                        <button
                          onClick={(e) => handleMarkSingle(e, n)}
                          className="rounded-lg p-2 text-muted transition hover:bg-bg hover:text-brand-soft"
                          title="标记已读"
                        >
                          <CheckCheck className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDelete(e, n)}
                        className="rounded-lg p-2 text-muted transition hover:bg-bg hover:text-danger"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
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
