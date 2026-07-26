// 全局认证与 UI 状态

import { create } from 'zustand'
import type { User } from '../../shared/types'
import { api, getToken, setToken, clearToken } from '@/lib/api'

interface AppState {
  user: User | null
  loading: boolean
  initialized: boolean
  toast: { id: number; type: 'success' | 'error' | 'info'; message: string } | null
  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
  setUser: (u: User | null) => void
  notify: (type: 'success' | 'error' | 'info', message: string) => void
  dismissToast: () => void
}

let toastSeq = 1

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,
  toast: null,

  init: async () => {
    if (!getToken()) {
      set({ initialized: true })
      return
    }
    try {
      const { user } = await api.me()
      set({ user, initialized: true })
    } catch {
      clearToken()
      set({ user: null, initialized: true })
    }
  },

  register: async (name, email, password) => {
    set({ loading: true })
    try {
      const { token, user } = await api.register({ name, email, password })
      setToken(token)
      set({ user, loading: false })
      get().notify('success', `欢迎,${user.name}`)
    } catch (e) {
      set({ loading: false })
      throw e
    }
  },

  login: async (email, password) => {
    set({ loading: true })
    try {
      const { token, user } = await api.login({ email, password })
      setToken(token)
      set({ user, loading: false })
      get().notify('success', `已登录,${user.name}`)
    } catch (e) {
      set({ loading: false })
      throw e
    }
  },

  logout: () => {
    clearToken()
    set({ user: null })
    get().notify('info', '已退出登录')
  },

  setUser: (u) => set({ user: u }),

  notify: (type, message) => {
    set({ toast: { id: toastSeq++, type, message } })
    setTimeout(() => {
      if (get().toast?.id === toastSeq - 1) set({ toast: null })
    }, 3000)
  },
  dismissToast: () => set({ toast: null }),
}))