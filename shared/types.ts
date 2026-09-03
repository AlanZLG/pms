// 前后端共享的类型定义

export type UserRole = 'admin' | 'finance' | 'owner' | 'member' | 'guest'
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface UserCategory {
  id: string
  name: string
  description: string
  hourlyRate: number
  isOutsourced: boolean
  createdAt: string
}

export interface User {
  id: string
  email: string
  name: string
  avatarColor: string
  role: UserRole
  createdAt: string
  feishuOpenId?: string | null
  feishuUnionId?: string | null
  feishuBoundAt?: string | null
  isOutsourced?: boolean
  hourlyRate?: number | null
  costCenter?: string | null
  categoryId?: string | null
  category?: UserCategory | null
  customRoleId?: string | null
  customRole?: CustomRole | null
  taskCount?: number
  activeCount?: number
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  ownerId: string
  members: ProjectMember[]
  progress: number
  startDate: string | null
  dueDate: string | null
  createdAt: string
}

export interface ProjectMember {
  userId: string
  role: MemberRole
  joinedAt: string
  user?: { name: string; avatarColor: string; email: string }
}

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  labels: string[]
  dueDate: string | null
  startDate?: string | null
  createdAt: string
  updatedAt: string
  plannedHours?: number
  dependencies?: TaskDependency[]
  milestone?: boolean
  progress?: number
  deletedAt?: string | null
  customStatus?: string | null
}

export interface TaskDependency {
  id: string
  taskId: string
  dependsOnTaskId: string
  type: 'fs' | 'ss' | 'ff' | 'sf'
  lagDays: number
  createdAt: string
}

export interface Comment {
  id: string
  taskId: string
  userId: string
  userName: string
  avatarColor: string
  content: string
  createdAt: string
}

export interface Subtask {
  id: string
  taskId: string
  title: string
  done: boolean
  createdAt: string
}

export interface TaskHistory {
  id: string
  taskId: string
  userId: string
  userName?: string
  action: string
  detail?: string
  createdAt: string
}

export interface Notification {
  id: string
  userId: string
  type: 'assign' | 'status' | 'comment' | 'system'
  title: string
  body: string
  taskId: string | null
  projectId: string | null
  read: boolean
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface StatsOverview {
  totalProjects: number
  activeProjects: number
  completedProjects: number
  overdueProjects: number
  tasksByStatus: { todo: number; in_progress: number; review: number; done: number }
  trend: { date: string; completed: number; created: number }[]
}

export interface BurndownData {
  dates: string[]
  ideal: number[]
  actual: number[]
}

export interface WorkloadItem {
  userId: string
  userName: string
  avatarColor: string
  total: number
  done: number
  inProgress: number
}

export interface Template {
  id: string
  name: string
  title: string
  description: string
  priority: TaskPriority
  labels: string[]
  createdAt: string
}

export interface Attachment {
  id: string
  taskId: string
  userId: string
  userName: string
  filename: string
  originalName: string
  size: number
  mimeType: string
  createdAt: string
}

export type BudgetCategory = 'labor' | 'outsource' | 'hardware' | 'software' | 'other'
export type BudgetApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ProjectBudget {
  id: string
  projectId: string
  category: BudgetCategory
  amount: number
  currency: string
  description: string
  createdBy: string
  createdAt: string
  approvalStatus: BudgetApprovalStatus
  approvedBy?: string | null
  approvedAt?: string | null
  approvalComment?: string | null
}

export interface BudgetApproval {
  id: string
  budgetId: string
  approverId: string
  status: BudgetApprovalStatus
  comment: string
  createdAt: string
}

export interface ProjectExpense {
  id: string
  projectId: string
  budgetId: string | null
  category: BudgetCategory
  amount: number
  description: string
  date: string
  createdBy: string
  createdAt: string
}

export interface TaskHours {
  id: string
  taskId: string
  userId: string
  date: string
  plannedHours: number
  actualHours: number
  description: string
  createdAt: string
}

export interface HoursByUserProject {
  userId: string
  userName: string
  avatarColor: string
  userRole?: string
  isOutsourced?: boolean
  isProjectOwner?: boolean
  projects: {
    projectId: string
    projectName: string
    plannedHours: number
    actualHours: number
  }[]
  totalPlanned: number
  totalActual: number
}

export interface ProjectCostSummary {
  projectId: string
  projectName: string
  totalBudget: number
  totalExpense: number
  remainingBudget: number
  costByCategory: {
    category: BudgetCategory
    budget: number
    expense: number
    hours: number
    cost: number
  }[]
  memberCosts: {
            userId: string
            userName: string
            isOutsourced: boolean
            hourlyRate: number | null
            totalHours: number
            totalCost: number
            categoryName: string | null
          }[]
}

export interface TaskFilter {
  status?: TaskStatus[]
  assigneeId?: string | null
  priority?: TaskPriority[]
  labels?: string[]
  startDateFrom?: string
  startDateTo?: string
  dueDateFrom?: string
  dueDateTo?: string
  keyword?: string
}

export interface SavedFilter {
  id: string
  userId: string
  projectId: string | null
  name: string
  filterConfig: TaskFilter
  createdAt: string
}

export interface SearchResult {
  tasks: Task[]
  projects: Project[]
  keyword: string
}

export interface KanbanColumn {
  id: string
  projectId: string
  statusKey: string
  label: string
  color: string
  sortOrder: number
  createdAt: string
}

export interface KanbanColumnInput {
  statusKey: string
  label: string
  color?: string
  sortOrder?: number
}

// 项目模板相关类型
export interface ProjectTemplate {
  id: string
  name: string
  description: string
  isSystem: boolean
  createdBy?: string | null
  createdAt: string
  tasks?: TemplateTask[]
  budgets?: TemplateBudget[]
  kanbanColumns?: TemplateKanbanColumn[]
}

export interface TemplateTask {
  id: string
  templateId: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  labels: string[]
  sortOrder: number
  plannedHours?: number | null
  createdAt: string
}

export interface TemplateBudget {
  id: string
  templateId: string
  category: BudgetCategory
  description: string
  createdAt: string
}

export interface TemplateKanbanColumn {
  id: string
  templateId: string
  statusKey: string
  label: string
  color: string
  sortOrder: number
  createdAt: string
}

// 自定义角色相关类型
export interface CustomRole {
  id: string
  name: string
  description: string
  isSystem: boolean
  createdBy?: string | null
  createdAt: string
  permissions?: Permission[]
  permissionCount?: number
}

export interface Permission {
  id: string
  key: string
  name: string
  category: string
  description: string
  createdAt: string
}

export interface RolePermission {
  roleId: string
  permissionId: string
}

export interface PermissionCategory {
  category: string
  permissions: Permission[]
}