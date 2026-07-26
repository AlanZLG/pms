// API 请求客户端

import type {
  User, Project, Task, Comment, AuthResponse,
  StatsOverview, BurndownData, WorkloadItem,
} from '../../shared/types'

const TOKEN_KEY = 'pm_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })

  if (!res.ok) {
    let message = `请求失败(${res.status})`
    try {
      const body = await res.json()
      message = body.error || body.message || message
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export const api = {
  // auth
  register: (data: { email: string; password: string; name: string }) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<{ user: User }>('/api/auth/me'),

  // projects
  listProjects: () => request<{ projects: Project[] }>('/api/projects'),
  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),
  createProject: (data: Partial<Project>) =>
    request<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: Partial<Project>) =>
    request<{ project: Project }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addMember: (projectId: string, userId: string, role?: string) =>
    request<{ members: Project['members'] }>(`/api/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    }),
  updateMemberRole: (projectId: string, userId: string, role: string) =>
    request<{ members: Project['members'] }>(`/api/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeMember: (projectId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),

  // tasks
  listTasks: (projectId: string) =>
    request<{ project: Project; tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
  getTask: (taskId: string) =>
    request<{ task: Task; comments: Comment[] }>(`/api/tasks/${taskId}`),
  createTask: (projectId: string, data: Partial<Task>) =>
    request<{ task: Task }>(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (taskId: string, data: Partial<Task>) =>
    request<{ task: Task }>(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateTaskStatus: (taskId: string, status: Task['status']) =>
    request<{ task: Task }>(`/api/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/tasks/${taskId}`, { method: 'DELETE' }),
  addComment: (taskId: string, content: string) =>
    request<{ comment: Comment }>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // stats
  overview: () => request<StatsOverview>('/api/stats/overview'),
  burndown: (projectId?: string) =>
    request<BurndownData>(`/api/stats/burndown${projectId ? `?projectId=${projectId}` : ''}`),
  workload: () => request<{ workload: WorkloadItem[] }>('/api/stats/workload'),

  // team
  listUsers: () => request<{ users: (User & { taskCount: number; activeCount: number })[] }>('/api/team'),
  updateRole: (userId: string, role: string) =>
    request<{ user: User }>(`/api/team/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
}