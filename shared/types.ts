// 前后端共享的类型定义

export type UserRole = 'admin' | 'finance' | 'owner' | 'member' | 'guest'
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

// 项目类型：v1.8.5 起新建项目时必选，v1.8.7 扩为五类（产品迭代升格为正式类型）
// 运维项目登记运维台账，其余类型记录课题表
export const PROJECT_TYPES = ['运维项目', '开发项目', '咨询项目', '实施项目', '产品迭代', '运维增强', '知识产权'] as const
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
export const TEMPLATE_CATEGORIES = ['运维项目', '开发项目', '咨询项目', '实施项目', '产品迭代', '运维增强', '知识产权'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** 模板分类 → 默认项目类型（v1.8.7 起同名一一对应） */
export const TEMPLATE_CATEGORY_DEFAULT_TYPE: Record<TemplateCategory, ProjectType> = {
  运维项目: '运维项目',
  开发项目: '开发项目',
  咨询项目: '咨询项目',
  实施项目: '实施项目',
  产品迭代: '产品迭代',
  运维增强: '运维增强',
  知识产权: '知识产权',
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
  mustChangePassword?: boolean
  /** 台账列表列顺序（用户级持久化）：如 ["logDate","extra:客户名称",...]；登录恢复，导出同序 */
  oplogColumnOrder?: string[] | null
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
  /** v1.9.4 项目总预算：非空时明细分配受硬拦截约束（null = 未启用总额控制） */
  totalBudget?: number | null
  /** 项目序号：全局唯一、软删不复用；可手动指定（插入式顺延），导入时可显式提供 */
  seq?: number | null
  /** 项目台账自定义列配置（null = 未配置，走动态扩展列；enabled 时展示/表单/导入导出按定义执行） */
  oplogExtraColumns?: OpLogExtraConfig | null
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

// 站内消息：围绕项目/任务上下文在两人之间收发，回复即在同一上下文内继续发新消息
export interface Message {
  id: string
  senderId: string
  senderName: string
  recipientId: string
  recipientName: string
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  content: string
  read: boolean
  createdAt: string
}

// 会话 = (上下文: 任务或项目或直聊) × (对方用户)
export interface MessageThread {
  peerId: string
  peerName: string
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskTitle: string | null
  lastContent: string
  lastAt: string
  unread: number
  total: number
}

// 全量操作审计（v1.10.0）：每个账号的写操作轨迹，按模块/动作分类管理
export interface AuditLog {
  id: string
  userId: string | null
  userName: string
  method: string
  path: string
  module: string
  action: string
  targetId: string | null
  statusCode: number
  detail: string | null
  ip: string | null
  createdAt: string
}

export interface AuditQuery {
  userId?: string
  module?: string
  action?: string
  keyword?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
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

// 方案 B 项目健康度（0-100 分，越高越健康；healthy ≥80 / warning ≥60 / danger <60）
export type ProjectHealthLevel = 'healthy' | 'warning' | 'danger'
export interface ProjectHealth {
  projectId: string
  projectName: string
  ownerId: string
  ownerName: string
  status: ProjectStatus
  // 时间进度：按 startDate(缺省取创建时间) ~ dueDate 周期内插；无截止日为 null
  timeProgress: number | null
  // 任务完成率；无任务为 null
  doneRate: number | null
  // 完成率 - 时间进度（负 = 落后于计划）；任一缺省为 null
  deviation: number | null
  // 项目逾期天数（已完成项目恒为 0）
  overdueDays: number
  overdueTasks: number
  activeTasks: number
  overdueDensity: number
  healthScore: number
  healthLevel: ProjectHealthLevel
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

export interface BudgetWithProject extends ProjectBudget {
  projectName: string
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
  /** 登记时冻结的单价快照（个人价 > 类别价 > 角色默认价；改价不追溯历史，空为旧数据回填前） */
  rateSnapshot?: number | null
  /** 快照来源：user / category / role_owner / role_member / role_outsourced */
  rateSource?: string | null
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
            /** 实际加权均价（有工时时 = 总成本/总工时，混合快照价也精确） */
            hourlyRate: number | null
            /** 当前生效价（个人价 > 类别价 > 角色默认价），改价后新工时按此价 */
            liveRate?: number
            /** 单价来源：user / category / role_owner / role_member / role_outsourced / mixed / live */
            rateSource?: string
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

export type OpLogStatus = '待处理' | '处理中' | '暂停' | '取消' | '已完成' | '已关闭'

export interface OpLog {
  id: string
  projectId: string | null
  userId: string
  /** 序号：项目内自增（软删不回收），列表/导出固定第 1 列 */
  seq?: number | null
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
  /** 关联任务（台账工时自动入账的载体；null = 未指定，有工时时后端自动归集到项目「运维日常工作」任务） */
  taskId?: string | null
  /** 工时是否已入账到任务工时（task_hours 存在 op_log_id 反指记录） */
  hoursSynced?: boolean
  createdAt: string
  updatedAt: string
}

/** 台账自定义列（扩展字段）数量上限：__ 前缀的内部字段（如 __sourceTaskId）不占名额 */
export const OP_LOG_MAX_EXTRA_COLUMNS = 10

/**
 * 台账固定列的默认显示顺序（列设置的默认序，前端表格与后端导出共用，保证两端补齐语义一致）
 * - 'project' 仅全局视图展示（嵌入/具体项目视图过滤）
 * - 'seq'（序号）固定第 1 列、'操作' 固定最后，不参与排序，不在其中
 */
export const OP_LOG_DEFAULT_COLUMN_ORDER = [
  'logDate', 'category', 'status', 'project', 'system', 'department',
  'proposer', 'recorder', 'problem', 'detail', 'cause', 'solution', 'completionDate', 'hours', 'createdAt',
] as const

/** 台账自定义列定义（项目级配置）：key 为数据存储键（稳定），label 为显示名/Excel 表头 */
export interface OpLogExtraColumn {
  key: string
  label: string
}

/** 项目台账自定义列配置：启用后列表展示、表单填写、Excel 导入导出均按定义的字段与顺序执行 */
export interface OpLogExtraConfig {
  enabled: boolean
  /** 自定义列定义（数组顺序即展示与导入导出顺序），最多 OP_LOG_MAX_EXTRA_COLUMNS 个；columns 引用全局自定义项库的字段键，label 由服务端按库回填 */
  columns: OpLogExtraColumn[]
}

/** 台账自定义项类型：决定表单控件与 Excel 导入导出的处理方式 */
export type OpLogCustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'url'

/** 台账自定义项（字段库）：事先统一定义，各项目从中勾选启用；key 为数据存储键（创建后不变），type 决定表单控件与导入导出处理，options 仅 select 类型使用 */
export interface OpLogCustomField {
  key: string
  label: string
  /** text=普通文本；textarea=多行文本；number=数字（统一保留 2 位小数，导出数值单元格）；date=日期（表单日期选择器，导入自动归一化 Excel 序列数/日期串，导出写真日期格式）；select=下拉单选（options 为可选项）；url=链接（导出为可点击超链接） */
  type: OpLogCustomFieldType
  /** select 类型的可选项（仅 type=select 时有效） */
  options?: string[]
  sort: number
}

export interface OpLogInput {
  projectId?: string | null
  /** 序号：导入文件含「序号」列时按文件值；缺省由后端按项目自增分配 */
  seq?: number
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
  /** 关联任务 id；空串/null 表示自动归集（有工时时落到项目「运维日常工作」任务） */
  taskId?: string | null
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