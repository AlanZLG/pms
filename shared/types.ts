// 前后端共享的类型定义

export type UserRole = 'admin' | 'finance' | 'owner' | 'member' | 'guest'
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

// 项目类型：v1.8.5 起新建项目时必选，v1.8.7 扩为五类（产品迭代升格为正式类型）
// 运维项目登记运维台账，其余类型记录课题表
export const PROJECT_TYPES = ['运维项目', '开发项目', '咨询项目', '实施项目', '产品迭代', '运维增强'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

/** 台账入口名称：运维项目/运维增强登记运维台账，其余类型记录课题表（v1.9.0 加入运维增强） */
export const LEDGER_TYPES: readonly ProjectType[] = ['运维项目', '运维增强']
export function projectLedgerLabel(type?: ProjectType | null): '运维台账' | '课题表' {
  return type && (LEDGER_TYPES as readonly string[]).includes(type) ? '运维台账' : '课题表'
}

/** 项目类型归一化：合法返回原名（去首尾空白），非法/空返回 null */
export function normalizeProjectType(v: unknown): ProjectType | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return (PROJECT_TYPES as readonly string[]).includes(t) ? (t as ProjectType) : null
}

// 模板分类（v1.8.6）：与项目类型同名（v1.8.7 起完全一致）；创建项目选择模板后预填同名项目类型
export const TEMPLATE_CATEGORIES = ['运维项目', '开发项目', '咨询项目', '实施项目', '产品迭代', '运维增强'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** 模板分类 → 默认项目类型（v1.8.7 起同名一一对应） */
export const TEMPLATE_CATEGORY_DEFAULT_TYPE: Record<TemplateCategory, ProjectType> = {
  运维项目: '运维项目',
  开发项目: '开发项目',
  咨询项目: '咨询项目',
  实施项目: '实施项目',
  产品迭代: '产品迭代',
  运维增强: '运维增强',
}

/** 模板分类归一化：合法返回原名（去首尾空白），非法/空返回 null */
export function normalizeTemplateCategory(v: unknown): TemplateCategory | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(t) ? (t as TemplateCategory) : null
}

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
  /** 名下（作为负责人）未删除项目名列表，团队页展示用 */
  ownedProjectNames?: string[]
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  projectType?: ProjectType | null
  ownerId: string
  /** 项目负责人姓名与头像色（列表/详情 JOIN users 带出） */
  ownerName?: string
  ownerAvatar?: string
  members: ProjectMember[]
  progress: number
  startDate: string | null
  dueDate: string | null
  createdAt: string
  /** v1.9.0 结项合并：非空表示本项目已合并到目标运维项目（台账/课题记录已转绑） */
  mergedIntoProjectId?: string | null
  deletedAt?: string | null
  deleteRequestedBy?: string | null
  deleteRequestedAt?: string | null
  deleteRejectComment?: string | null
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
  /** 实际开始日期（甘特图计划/实际对比，选填） */
  actualStartDate?: string | null
  /** 实际截止日期（甘特图计划/实际对比，选填） */
  actualEndDate?: string | null
  createdAt: string
  updatedAt: string
  plannedHours?: number
  dependencies?: TaskDependency[]
  milestone?: boolean
  progress?: number
  deletedAt?: string | null
  customStatus?: string | null
  /** 看板列内手动排序值（小的在前） */
  sortOrder?: number
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
  /** 子任务负责人（可空=未指派） */
  assigneeId?: string | null
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
  /** 实际投入工时（内部成本口径） */
  actualHours: number
  /** 计费工数（向客户结算口径） */
  billedHours: number
  description: string
  createdAt: string
  /** 以下字段仅在工时报表（/stats/hours）返回时填充 */
  projectId?: string | null
  projectName?: string | null
  taskTitle?: string | null
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
    billedHours: number
  }[]
  totalPlanned: number
  totalActual: number
  totalBilled: number
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
  category?: TemplateCategory | null
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

// ===== 运维台账 =====

export type OpLogStatus = '待处理' | '处理中' | '已完成' | '已关闭'

export interface OpLog {
  id: string
  projectId: string | null
  userId: string
  category: string | null
  status: string
  proposer: string | null
  system: string | null
  department: string | null
  logDate: string | null
  recorder: string | null
  problem: string
  completionDate: string | null
  hours: number
  detail: string | null
  cause: string | null
  solution: string | null
  /** 扩展字段（列名 -> 值） */
  extraFields: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface OpLogInput {
  projectId?: string | null
  category?: string
  status?: string
  proposer?: string
  system?: string
  department?: string
  logDate?: string
  recorder?: string
  problem: string
  completionDate?: string | null
  hours?: number
  detail?: string
  cause?: string
  solution?: string
  extraFields?: Record<string, string>
}

export interface OpLogFilter {
  projectId?: string
  category?: string
  status?: string
  system?: string
  department?: string
  keyword?: string
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface OpLogOptions {
  categories: string[]
  systems: string[]
  departments: string[]
  statuses: string[]
}

/** 按月+分类分组的统计数据 */
export interface OpLogStat {
  month: string
  category: string
  count: number
  hours: number
}

// ===== 运维台账 · AI 经验分析 =====

/** AI 分析请求 */
export interface OpLogAiAnalyzeRequest {
  problem: string
  detail?: string
  system?: string
  category?: string
  /** 用于召回加权（同项目经验优先） */
  projectId?: string
  topK?: number
}

/** 相似历史案例（溯源展示用） */
export interface OpLogAiCase {
  opLogId: string
  problem: string
  cause: string
  solution: string
  system: string
  category: string
  projectId: string | null
  /** 0~1 匹配度 */
  score: number
}

/** AI 分析结论（结构化） */
export interface OpLogAiAnalysis {
  summary: string
  possibleCauses: Array<{ cause: string; confidence: string; basedOn: string[] }>
  suggestedSteps: string[]
  risks: string[]
}

export interface OpLogAiAnalyzeResponse {
  analysis: OpLogAiAnalysis
  cases: OpLogAiCase[]
  model: string
}

export interface OpLogAiStatus {
  enabled: boolean
  model: string
}

// ===== AI 对话式排障（P2） =====

/** 对话轮次（前端持有完整历史，随请求发送，服务端无状态） */
export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  messages: AiChatMessage[]
  /** 召回加权（同项目经验优先）；全局视图可不传 */
  projectId?: string
}