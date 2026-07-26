import { create } from 'zustand'
import type { Notification } from '../../shared/types'
import { api } from '@/lib/api'

interface NotificationState {
  items: Notification[]
  unread: number
  loading: boolean
  fetched: boolean
  fetch: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  reset: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  fetched: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const { notifications, unread } = await api.listNotifications()
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
    } catch {}
  },

  markAllRead: async () => {
    try {
      await api.markAllRead()
      const items = get().items.map((n) => ({ ...n, read: true }))
      set({ items, unread: 0 })
    } catch {}
  },

  reset: () => set({ items: [], unread: 0, fetched: false }),
}))
