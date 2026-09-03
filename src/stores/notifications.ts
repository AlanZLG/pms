import { create } from 'zustand'
import type { Notification } from '../../shared/types'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'

interface NotificationState {
  items: Notification[]
  unread: number
  loading: boolean
  fetched: boolean
  polledAt: string | null
  polling: boolean
  fetch: (type?: string) => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (id: string) => Promise<void>
  reset: () => void
  startPolling: () => void
  stopPolling: () => void
}

let pollAbort: AbortController | null = null

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  fetched: false,
  polledAt: null,
  polling: false,

  fetch: async (type?: string) => {
    set({ loading: true })
    try {
      const { notifications, unread } = await api.listNotifications(type)
      set({ items: notifications, unread, loading: false, fetched: true })
    } catch {
      set({ loading: false })
    }
  },

  markRead: async (id) => {
    try {
      await api.markNotificationRead(id)
      const items = get().items.map((n) => (n.id === id ? { ...n, read: true } : n))
      const unread = items.filter((n) => !n.read).length
      set({ items, unread })
    } catch {
      // 忽略通知操作错误
    }
  },

  markAllRead: async () => {
    try {
      await api.markAllRead()
      const items = get().items.map((n) => ({ ...n, read: true }))
      set({ items, unread: 0 })
    } catch {
      // 忽略通知操作错误
    }
  },

  remove: async (id) => {
    try {
      await api.deleteNotification(id)
      const items = get().items.filter((n) => n.id !== id)
      const unread = items.filter((n) => !n.read).length
      set({ items, unread })
    } catch {
      // 忽略通知操作错误
    }
  },

  reset: () => {
    if (pollAbort) { pollAbort.abort(); pollAbort = null }
    set({ items: [], unread: 0, fetched: false, polledAt: null, polling: false })
  },

  startPolling: () => {
    if (get().polling) return
    set({ polling: true })

    const loop = async () => {
      while (get().polling) {
        try {
          pollAbort = new AbortController()
          const since = get().polledAt
          const { hasNew, unread, polledAt } = await api.pollNotifications(since, 25, pollAbort.signal)
          pollAbort = null
          if (!get().polling) break
          set({ polledAt, unread })
          if (hasNew) {
            await get().fetch()
          }
        } catch (e) {
          const msg = getErrorMessage(e, '')
          const err = e as { name?: string }
          if (msg.includes('AbortError') || err?.name === 'AbortError') break
          if (!get().polling) break
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }

    loop()
  },

  stopPolling: () => {
    if (pollAbort) { pollAbort.abort(); pollAbort = null }
    set({ polling: false })
  },
}))
