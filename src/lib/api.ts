// API 请求客户端

import type {
  User, Project, Task, Comment, Subtask, AuthResponse, Notification,
  StatsOverview, BurndownData, WorkloadItem, Template, Attachment,
  TaskHours, ProjectBudget, ProjectExpense, BudgetCategory,
  HoursByUserProject, ProjectCostSummary, UserCategory, TaskDependency, TaskHistory,
  SavedFilter, TaskFilter, SearchResult, KanbanColumn, KanbanColumnInput,
  ProjectTemplate, TemplateTask, TemplateBudget, TemplateKanbanColumn,
  CustomRole, PermissionCategory,
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

  const isGet = !options.method || options.method === 'GET'
  const maxRetries = isGet ? 1 : 0

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(path, { ...options, headers })
      if (res.ok) return res.json() as Promise<T>
      if (res.status >= 400 && res.status < 500) {
        let message = `请求失败(${res.status})`
        try {
          const body = await res.json()
          message = body.error || body.message || message
        } catch {
          // 响应体解析失败，使用默认错误信息
        }
        const err = new Error(message) as Error & { status?: number }
        err.status = res.status
        throw err
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        continue
      }
      let message = `请求失败(${res.status})`
      try {
        const body = await res.json()
        message = body.error || body.message || message
      } catch {
        // 响应体解析失败，使用默认错误信息
      }
      const err = new Error(message) as Error & { status?: number }
      err.status = res.status
      throw err
    } catch (e) {
      lastError = e as Error
      if ((e as Error).name === 'AbortError') throw e
      if (attempt >= maxRetries) throw e
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  throw lastError
}

export const api = {
  // auth
  register: (data: { email: string; password: string; name: string }) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<{ user: User }>('/api/auth/me'),
  updateProfile: (data: { name: string }) =>
    request<{ user: User }>('/api/auth/me', { method: 'PUT', body: JSON.stringify(data) }),

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

  // 批量导入项目成员
  importMembers: async (projectId: string, file: File): Promise<{
    results: {
      success: { email: string; name: string; role: string }[]
      skipped: { email: string; reason: string }[]
      errors: { row: number; email?: string; error: string }[]
    }
  }> => {
    const formData = new FormData()
    formData.append('file', file)
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`/api/projects/${projectId}/members/import`, {
      method: 'POST',
      headers,
      body: formData
    })

    if (!res.ok) {
      let message = `导入失败(${res.status})`
      try {
        const body = await res.json()
        message = body.error || message
      } catch {
        // 响应体解析失败，使用默认错误信息
      }
      throw new Error(message)
    }

    return res.json()
  },

  // 下载成员导入模板
  downloadMemberImportTemplate: async (projectId: string): Promise<void> => {
    const token = getToken()
    const url = `/api/projects/${projectId}/members/import/template`
    if (!token) throw new Error('未登录')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`下载失败(${res.status})`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'member_import_template.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  },

  // tasks
  globalSearch: (keyword: string): Promise<SearchResult> =>
    request(`/api/search?q=${encodeURIComponent(keyword)}`),
  listTasks: (projectId: string, filter?: TaskFilter) => {
    const params = new URLSearchParams()
    if (filter) {
      if (filter.status && filter.status.length > 0) params.set('status', filter.status.join(','))
      if (filter.assigneeId !== undefined) params.set('assigneeId', filter.assigneeId || '')
      if (filter.priority && filter.priority.length > 0) params.set('priority', filter.priority.join(','))
      if (filter.labels && filter.labels.length > 0) params.set('labels', filter.labels.join(','))
      if (filter.startDateFrom) params.set('startDateFrom', filter.startDateFrom)
      if (filter.startDateTo) params.set('startDateTo', filter.startDateTo)
      if (filter.dueDateFrom) params.set('dueDateFrom', filter.dueDateFrom)
      if (filter.dueDateTo) params.set('dueDateTo', filter.dueDateTo)
      if (filter.keyword) params.set('keyword', filter.keyword)
    }
    const query = params.toString()
    return request<{ project: Project; tasks: Task[] }>(`/api/projects/${projectId}/tasks${query ? `?${query}` : ''}`)
  },
  getTask: (taskId: string) =>
    request<{ task: Task; comments: Comment[]; subtasks: Subtask[]; attachments: Attachment[]; history: TaskHistory[] }>(`/api/tasks/${taskId}`),
  createTask: (projectId: string, data: Partial<Task>) =>
    request<{ task: Task }>(`/api/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (taskId: string, data: Partial<Task>) =>
    request<{ task: Task }>(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateTaskStatus: (taskId: string, status: Task['status']) =>
    request<{ task: Task }>(`/api/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/tasks/${taskId}`, { method: 'DELETE' }),
  restoreTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/tasks/${taskId}/restore`, { method: 'POST' }),
  physicalDeleteTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/tasks/${taskId}/physical`, { method: 'DELETE' }),
  listTrash: (projectId?: string) =>
    request<{ tasks: Task[] }>(`/api/trash${projectId ? `?projectId=${projectId}` : ''}`),
  addComment: (taskId: string, content: string) =>
    request<{ comment: Comment }>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // subtasks
  createSubtask: (taskId: string, title: string) =>
    request<{ subtask: Subtask }>(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  updateSubtask: (subtaskId: string, data: { title?: string; done?: boolean }) =>
    request<{ ok: boolean }>(`/api/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteSubtask: (subtaskId: string) =>
    request<{ ok: boolean }>(`/api/subtasks/${subtaskId}`, { method: 'DELETE' }),

  // task dependencies
  getTaskDependencies: (taskId: string) =>
    request<{ dependencies: TaskDependency[] }>(`/api/tasks/${taskId}/dependencies`),
  getProjectDependencies: (projectId: string) =>
    request<{ dependencies: TaskDependency[] }>(`/api/projects/${projectId}/dependencies`),
  addDependency: (taskId: string, dependsOnTaskId: string, type: 'fs' | 'ss' | 'ff' | 'sf' = 'fs', lagDays = 0) =>
    request<{ dependency: TaskDependency }>(`/api/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnTaskId, type, lagDays }),
    }),
  updateDependency: (depId: string, type: 'fs' | 'ss' | 'ff' | 'sf', lagDays: number) =>
    request<{ dependency: TaskDependency }>(`/api/dependencies/${depId}`, {
      method: 'PATCH',
      body: JSON.stringify({ type, lagDays }),
    }),
  removeDependency: (depId: string) =>
    request<{ ok: boolean }>(`/api/dependencies/${depId}`, { method: 'DELETE' }),

  // stats
  overview: () => request<StatsOverview>('/api/stats/overview'),
  burndown: (projectId?: string) =>
    request<BurndownData>(`/api/stats/burndown${projectId ? `?projectId=${projectId}` : ''}`),
  workload: () => request<{ workload: WorkloadItem[] }>('/api/stats/workload'),

  // team
  listUsers: () => request<{ users: (User & { taskCount: number; activeCount: number })[] }>('/api/team'),
  updateRole: (userId: string, role: string) =>
    request<{ user: User }>(`/api/team/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  updateUserCost: (userId: string, data: { isOutsourced?: boolean; hourlyRate?: number | null; costCenter?: string | null; categoryId?: string | null }) =>
    request<{ user: User }>(`/api/team/${userId}/cost`, { method: 'PATCH', body: JSON.stringify(data) }),
  getUserCost: (userId: string) =>
    request<{ isOutsourced: boolean; hourlyRate: number | null; costCenter: string | null; categoryId: string | null }>(`/api/team/${userId}/cost`),
  listCategories: () =>
    request<{ categories: UserCategory[] }>('/api/team/categories'),
  createCategory: (data: { name: string; description?: string; hourlyRate: number; isOutsourced: boolean }) =>
    request<{ category: UserCategory }>('/api/team/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (categoryId: string, data: Partial<{ name: string; description: string; hourlyRate: number; isOutsourced: boolean }>) =>
    request<{ category: UserCategory }>(`/api/team/categories/${categoryId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCategory: (categoryId: string) =>
    request<{ success: boolean }>(`/api/team/categories/${categoryId}`, { method: 'DELETE' }),

  // hours
  listTaskHours: (taskId: string) =>
    request<{ hours: TaskHours[] }>(`/api/tasks/${taskId}/hours`),
  createTaskHours: (taskId: string, data: { date: string; plannedHours?: number; actualHours?: number; description?: string }) =>
    request<{ record: TaskHours }>(`/api/tasks/${taskId}/hours`, { method: 'POST', body: JSON.stringify(data) }),
  updateTaskHours: (recordId: string, data: { plannedHours?: number; actualHours?: number; description?: string }) =>
    request<{ record: TaskHours }>(`/api/hours/${recordId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTaskHours: (recordId: string) =>
    request<{ ok: boolean }>(`/api/hours/${recordId}`, { method: 'DELETE' }),
  listMyHours: () =>
    request<{ hours: TaskHours[] }>('/api/hours/me'),
  listHoursByUser: (startDate?: string, endDate?: string) => {
    let url = '/api/stats/hours-by-user'
    const params: string[] = []
    if (startDate) params.push(`startDate=${startDate}`)
    if (endDate) params.push(`endDate=${endDate}`)
    if (params.length) url += '?' + params.join('&')
    return request<{ data: HoursByUserProject[] }>(url)
  },
  listProjectCost: (projectId?: string) => {
    let url = '/api/stats/project-cost'
    if (projectId) url += `?projectId=${projectId}`
    return request<{ data: ProjectCostSummary[] }>(url)
  },

  // budgets
  listBudgets: (projectId: string) =>
    request<{ budgets: ProjectBudget[] }>(`/api/projects/${projectId}/budgets`),
  createBudget: (projectId: string, data: { category: BudgetCategory; amount: number; currency?: string; description?: string }) =>
    request<{ budget: ProjectBudget }>(`/api/projects/${projectId}/budgets`, { method: 'POST', body: JSON.stringify(data) }),
  updateBudget: (budgetId: string, data: Partial<{ category: BudgetCategory; amount: number; currency: string; description: string }>) =>
    request<{ budget: ProjectBudget }>(`/api/budgets/${budgetId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBudget: (budgetId: string) =>
    request<{ ok: boolean }>(`/api/budgets/${budgetId}`, { method: 'DELETE' }),
  getBudgetSummary: (projectId: string) =>
    request<{ totalBudget: number; budgets: { id: string; category: BudgetCategory; amount: number; description: string; approvalStatus: string }[] }>(`/api/projects/${projectId}/budget-summary`),
  approveBudget: (budgetId: string, data: { comment?: string }) =>
    request<{ budget: ProjectBudget }>(`/api/budgets/${budgetId}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  rejectBudget: (budgetId: string, data: { comment?: string }) =>
    request<{ budget: ProjectBudget }>(`/api/budgets/${budgetId}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  listPendingBudgets: () =>
    request<{ budgets: ProjectBudget[] }>('/api/budgets/pending'),

  // expenses
  listExpenses: (projectId: string) =>
    request<{ expenses: ProjectExpense[] }>(`/api/projects/${projectId}/expenses`),
  createExpense: (projectId: string, data: { budgetId?: string | null; category: BudgetCategory; amount: number; description?: string; date: string }) =>
    request<{ expense: ProjectExpense }>(`/api/projects/${projectId}/expenses`, { method: 'POST', body: JSON.stringify(data) }),
  updateExpense: (expenseId: string, data: Partial<{ budgetId: string | null; category: BudgetCategory; amount: number; description: string; date: string }>) =>
    request<{ expense: ProjectExpense }>(`/api/expenses/${expenseId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteExpense: (expenseId: string) =>
    request<{ ok: boolean }>(`/api/expenses/${expenseId}`, { method: 'DELETE' }),
  getExpenseSummary: (projectId: string) =>
    request<{ totalExpense: number; byCategory: Record<string, number>; count: number }>(`/api/projects/${projectId}/expense-summary`),

  // export
  exportTasksCsv: async (projectId: string): Promise<void> => {
    const token = getToken()
    const url = `/api/export/projects/${projectId}/tasks.csv`
    if (!token) throw new Error('未登录')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`导出失败(${res.status})`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tasks_${projectId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  },
  exportProjectsCsv: async (): Promise<void> => {
    const token = getToken()
    const url = '/api/export/projects.csv'
    if (!token) throw new Error('未登录')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`导出失败(${res.status})`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'projects.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  },
  exportProgressXlsx: async (projectId: string): Promise<void> => {
    const token = getToken()
    const url = `/api/export/projects/${projectId}/progress.xlsx`
    if (!token) throw new Error('未登录')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`导出失败(${res.status})`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `progress_${projectId}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
  },

  // attachments
  uploadAttachment: (taskId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(`/api/attachments/tasks/${taskId}`, {
      method: 'POST',
      body: formData,
      headers,
    }).then(async (res) => {
      if (!res.ok) {
        let message = `上传失败(${res.status})`
        try {
          const body = await res.json()
          message = body.error || message
        } catch {
          // 响应体解析失败，使用默认错误信息
        }
        throw new Error(message)
      }
      return res.json() as Promise<{ attachment: Attachment }>
    })
  },
  listAttachments: (taskId: string) =>
    request<{ attachments: Attachment[] }>(`/api/attachments/tasks/${taskId}`),
  deleteAttachment: (id: string) =>
    request<{ ok: boolean }>(`/api/attachments/${id}`, { method: 'DELETE' }),
  getAttachmentUrl: (id: string) => `/api/attachments/${id}`,

  // templates
  listTemplates: () => request<{ templates: Template[] }>('/api/templates'),
  createTemplate: (data: Omit<Template, 'id' | 'createdAt'>) =>
    request<{ template: Template }>('/api/templates', { method: 'POST', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) =>
    request<{ ok: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),

  // notifications
  listNotifications: (type?: string) =>
    request<{ notifications: Notification[]; unread: number }>(
      `/api/notifications${type ? `?type=${type}` : ''}`,
    ),
  pollNotifications: (since: string | null, timeout = 25, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (since) params.set('since', since)
    params.set('timeout', String(timeout))
    return request<{ hasNew: boolean; notifications: Notification[]; unread: number; polledAt: string }>(
      `/api/notifications/poll?${params.toString()}`,
      { signal },
    )
  },
  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) =>
    request<{ ok: boolean }>(`/api/notifications/${id}`, { method: 'DELETE' }),

  // feishu
  getFeishuBindUrl: () =>
    request<{ authUrl: string }>('/api/feishu/bind'),
  getFeishuStatus: () =>
    request<{ bound: boolean; feishuName?: string; openId?: string; boundAt?: string; configured: boolean }>('/api/feishu/status'),
  unbindFeishu: () =>
    request<{ success: boolean }>('/api/feishu/unbind', { method: 'POST' }),

  // backup
  getBackupInfo: () =>
    request<{ sizeBytes: number; sizeKB: number; modifiedAt: string; exists: boolean }>('/api/backup/info'),
  downloadBackup: () => {
    const token = getToken()
    return fetch('/api/backup', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((res) => {
      if (!res.ok) throw new Error(`下载失败(${res.status})`)
      return res.blob()
    })
  },
  restoreBackup: (file: File) => {
    const token = getToken()
    return fetch('/api/backup', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/octet-stream',
      },
      body: file,
    }).then(async (res) => {
      if (!res.ok) {
        let message = `恢复失败(${res.status})`
        try {
          const body = await res.json()
          message = body.error || body.message || message
        } catch {
          // 响应体解析失败，使用默认错误信息
        }
        throw new Error(message)
      }
      return res.json()
    })
  },

  // saved filters
  listFilters: (projectId: string) =>
    request<{ filters: SavedFilter[] }>(`/api/projects/${projectId}/filters`),
  createFilter: (projectId: string, data: { name: string; filterConfig: TaskFilter }) =>
    request<{ filter: SavedFilter }>(`/api/projects/${projectId}/filters`, { method: 'POST', body: JSON.stringify(data) }),
  deleteFilter: (id: string) =>
    request<{ ok: boolean }>(`/api/filters/${id}`, { method: 'DELETE' }),

  // kanban columns
  getKanbanColumns: (projectId: string) =>
    request<{ columns: KanbanColumn[] }>(`/api/projects/${projectId}/kanban-columns`),
  createKanbanColumn: (projectId: string, data: KanbanColumnInput) =>
    request<{ column: KanbanColumn }>(`/api/projects/${projectId}/kanban-columns`, { method: 'POST', body: JSON.stringify(data) }),
  updateKanbanColumn: (columnId: string, data: Partial<{ label: string; color: string; sortOrder: number }>) =>
    request<{ column: KanbanColumn }>(`/api/kanban-columns/${columnId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteKanbanColumn: (columnId: string) =>
    request<{ ok: boolean }>(`/api/kanban-columns/${columnId}`, { method: 'DELETE' }),
  reorderKanbanColumns: (projectId: string, columnIds: string[]) =>
    request<{ columns: KanbanColumn[] }>(`/api/projects/${projectId}/kanban-columns/reorder`, { method: 'POST', body: JSON.stringify({ columnIds }) }),

  // project templates
  listProjectTemplates: () =>
    request<{ templates: (ProjectTemplate & { taskCount: number; budgetCount: number; kanbanColumnCount: number })[] }>('/api/templates/project-templates'),
  getProjectTemplate: (id: string) =>
    request<{ template: ProjectTemplate }>(`/api/templates/project-templates/${id}`),
  createProjectTemplate: (data: { name: string; description?: string }) =>
    request<{ template: ProjectTemplate }>('/api/templates/project-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateProjectTemplate: (id: string, data: Partial<{ name: string; description: string }>) =>
    request<{ template: ProjectTemplate }>(`/api/templates/project-templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProjectTemplate: (id: string) =>
    request<{ ok: boolean }>(`/api/templates/project-templates/${id}`, { method: 'DELETE' }),
  saveProjectAsTemplate: (projectId: string, data: { templateName: string; templateDescription?: string }) =>
    request<{ template: ProjectTemplate }>(`/api/templates/projects/${projectId}/save-as-template`, { method: 'POST', body: JSON.stringify(data) }),

  // template tasks
  createTemplateTask: (templateId: string, data: Partial<TemplateTask>) =>
    request<{ task: TemplateTask }>(`/api/templates/project-templates/${templateId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTemplateTask: (taskId: string, data: Partial<TemplateTask>) =>
    request<{ task: TemplateTask }>(`/api/templates/template-tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTemplateTask: (taskId: string) =>
    request<{ ok: boolean }>(`/api/templates/template-tasks/${taskId}`, { method: 'DELETE' }),

  // template budgets
  createTemplateBudget: (templateId: string, data: { category: BudgetCategory; description?: string }) =>
    request<{ budget: TemplateBudget }>(`/api/templates/project-templates/${templateId}/budgets`, { method: 'POST', body: JSON.stringify(data) }),
  deleteTemplateBudget: (budgetId: string) =>
    request<{ ok: boolean }>(`/api/templates/template-budgets/${budgetId}`, { method: 'DELETE' }),

  // template kanban columns
  createTemplateKanbanColumn: (templateId: string, data: { statusKey: string; label: string; color?: string; sortOrder?: number }) =>
    request<{ column: TemplateKanbanColumn }>(`/api/templates/project-templates/${templateId}/kanban-columns`, { method: 'POST', body: JSON.stringify(data) }),
  updateTemplateKanbanColumn: (columnId: string, data: Partial<{ label: string; color: string; sortOrder: number }>) =>
    request<{ column: TemplateKanbanColumn }>(`/api/templates/template-kanban-columns/${columnId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTemplateKanbanColumn: (columnId: string) =>
    request<{ ok: boolean }>(`/api/templates/template-kanban-columns/${columnId}`, { method: 'DELETE' }),

  // custom roles
  listRoles: () =>
    request<{ roles: CustomRole[] }>('/api/roles'),
  getRole: (id: string) =>
    request<{ role: CustomRole }>(`/api/roles/${id}`),
  createRole: (data: { name: string; description?: string; permissionIds?: string[] }) =>
    request<{ role: CustomRole }>('/api/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomRole: (id: string, data: Partial<{ name: string; description: string }>) =>
    request<{ role: CustomRole }>(`/api/roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRole: (id: string) =>
    request<{ success: boolean }>(`/api/roles/${id}`, { method: 'DELETE' }),
  listPermissions: () =>
    request<{ categories: PermissionCategory[] }>('/api/roles/permissions/list'),
  updateRolePermissions: (roleId: string, permissionIds: string[]) =>
    request<{ role: CustomRole }>(`/api/roles/${roleId}/permissions`, { method: 'POST', body: JSON.stringify({ permissionIds }) }),
  updateUserCustomRole: (userId: string, customRoleId: string | null) =>
    request<{ user: User }>(`/api/team/${userId}/custom-role`, { method: 'PATCH', body: JSON.stringify({ customRoleId }) }),
  listCustomRoles: () =>
    request<{ roles: CustomRole[] }>('/api/team/custom-roles'),
}