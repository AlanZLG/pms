import { create } from 'zustand'
import type { Notification } from '../../shared/types'
import { api } from '@/lib/api'

interface NotificationState {
  items: Notification[]
  unread: number
  loading: boolean
  fetched: boolean
  fetch: (type?: string) => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (id: string) => Promise<void>
  reset: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  fetched: false,

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
    } catch {}
  },

  markAllRead: async () => {
    try {
      await api.markAllRead()
      const items = get().items.map((n) => ({ ...n, read: true }))
      set({ items, unread: 0 })
    } catch {}
  },

  remove: async (id) => {
    try {
      await api.deleteNotification(id)
      const items = get().items.filter((n) => n.id !== id)
      const unread = items.filter((n) => !n.read).length
      set({ items, unread })
    } catch {}
  },

  reset: () => set({ items: [], unread: 0, fetched: false }),
}))
