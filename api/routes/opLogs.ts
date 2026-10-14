import { Router, type Response, type NextFunction } from 'express'
import multer from 'multer'
import ExcelJS from 'exceljs'
import { opLogRepo, projectRepo, userRepo, taskRepo, activityLogRepo, resolveHourlyRate } from '../repository/repo.ts'
import { authRequired, requirePermission, type AuthRequest } from '../lib/auth.ts'
import { ApiError, genId } from '../lib/utils.ts'
import db, { type SqlRow } from '../db.ts'
import { llm } from '../lib/llm.ts'
import { buildAnalyzeMessages, buildChatMessages, type ChatTurn } from '../lib/prompts.ts'
import { recallCases, toAiCase } from '../lib/recallCases.ts'
import { scopedProjectIds } from './stats.ts'
import type { Task, User } from '../../shared/types.ts'
import { OP_LOG_MAX_EXTRA_COLUMNS } from '../../shared/types.ts'

export const router = Router()
router.use(authRequired)

// 内存存储即可（导入后立即解析）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

/** 自定义列（扩展字段）用户列名：剔除 __ 前缀的内部字段（__sourceTaskId 等不占上限名额） */
export function extraUserKeys(extraFields: unknown): string[] {
  if (!extraFields || typeof extraFields !== 'object') return []
  return Object.keys(extraFields as Record<string, unknown>).filter((k) => !k.startsWith('__'))
}

/** 自定义列数量上限校验（新增/修改共用），超限抛 400 */
export function assertExtraColumnsLimit(extraFields: unknown): void {
  const keys = extraUserKeys(extraFields)
  if (keys.length > OP_LOG_MAX_EXTRA_COLUMNS) {
    throw new ApiError(400, `自定义列最多 ${OP_LOG_MAX_EXTRA_COLUMNS} 个，当前 ${keys.length} 个：${keys.slice(OP_LOG_MAX_EXTRA_COLUMNS).join('、')}`)
  }
}

/** 配置模式字段白名单校验：用户自定义列 key 必须在项目定义内（__ 前缀系统字段豁免），防止写入配置外字段导致导出时静默丢失 */
export function assertExtraFieldsMatchConfig(extraFields: unknown, config: { columns: { key: string; label: string }[] }): void {
  if (!extraFields || typeof extraFields !== 'object') return
  const defined = new Set(config.columns.map((c) => c.key))
  const invalid = extraUserKeys(extraFields).filter((k) => !defined.has(k))
  if (invalid.length > 0) {
    throw new ApiError(400, `自定义列不在项目定义中：${invalid.join('、')}。请刷新页面同步最新自定义列配置后重试`)
  }
}

/** 表头重复列名检测：返回出现 2 次及以上的列名（保留首次出现顺序，空名跳过） */
export function findDuplicateHeaders(labels: string[]): string[] {
  const seen = new Set<string>()
  const dups: string[] = []
  for (const label of labels) {
    if (!label) continue
    if (seen.has(label)) {
      if (!dups.includes(label)) dups.push(label)
    } else {
      seen.add(label)
    }
  }
  return dups
}

// 固定列定义（导出/模板/导入共用的列顺序）：序号永远第 1 列
const FIXED_COLUMNS = [
  { key: 'seq', label: '序号' },
  { key: 'category', label: '分类' },
  { key: 'status', label: '状态' },
  { key: 'proposer', label: '提出人' },
  { key: 'system', label: '系统' },
  { key: 'department', label: '部门' },
  { key: 'logDate', label: '日期' },
  { key: 'recorder', label: '记录人' },
  { key: 'problem', label: '问题' },
  { key: 'completionDate', label: '完成日' },
  { key: 'hours', label: '工时' },
  { key: 'detail', label: '详细描述' },
  { key: 'cause', label: '原因' },
  { key: 'solution', label: '解决方案' },
] as const

const VALID_STATUS = ['待处理', '处理中', '暂停', '取消', '已完成', '已关闭']

// 状态为「已完成」时必须填写的经验字段（沉淀排障经验，前端表单/后端接口/导入提示共用口径）
const COMPLETION_REQUIRED = [
  { key: 'detail', label: '详细描述' },
  { key: 'cause', label: '原因' },
  { key: 'solution', label: '解决方案' },
] as const

/** 已完成状态下缺失的经验字段名列表；非已完成返回空（status 缺省按「待处理」） */
export function completionMissing(fields: { status?: string | null; detail?: string | null; cause?: string | null; solution?: string | null }): string[] {
  if ((fields.status || '待处理') !== '已完成') return []
  return COMPLETION_REQUIRED.filter((f) => !String(fields[f.key] ?? '').trim()).map((f) => f.label)
}

// 英文状态 → 中文映射
const STATUS_MAP: Record<string, string> = {
  done: '已完成',
  processing: '处理中',
  pending: '待处理',
  closed: '已关闭',
  open: '待处理',
  inprogress: '处理中',
  resolved: '已完成',
  paused: '暂停',
  pause: '暂停',
  suspended: '暂停',
  hold: '暂停',
  cancelled: '取消',
  canceled: '取消',
  cancel: '取消',
}

function normStatus(v: string): string {
  const s = v.trim()
  if (VALID_STATUS.includes(s)) return s
  const lower = s.toLowerCase()
  if (STATUS_MAP[lower]) return STATUS_MAP[lower]
  // 无法识别的状态回退为「待处理」，避免违反数据库 CHECK 约束导致整批导入失败
  return '待处理'
}

/** 提取单元格纯文本值，跳过 Excel 错误单元格 */
function cellText(v: ExcelJS.CellValue): string | null {
  if (v == null || v === '') return null
  // ExcelJS 错误类型 (type=10): { error: '#VALUE!' }
  if (typeof v === 'object' && 'error' in v) return null
  if (v instanceof Date) return null
  // 公式单元格：取计算结果
  if (typeof v === 'object' && 'formula' in v) {
    return cellText((v as { result?: ExcelJS.CellValue }).result ?? null)
  }
  if (typeof v === 'object' && 'richText' in v) {
    return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('')
  }
  const s = String(v).trim()
  return s || null
}

function normDate(v: ExcelJS.CellValue): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'object' && 'error' in v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && 'result' in v) {
    // 公式结果
    const r = (v as { result: unknown }).result
    if (r instanceof Date) return r.toISOString().slice(0, 10)
    return normDate(r as ExcelJS.CellValue)
  }
  const s = String(v).trim()
  if (!s) return null
  // 支持 2026/01/02、2026-01-02、2026.01.02
  const m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // Excel 序列号
  const n = Number(s)
  if (!Number.isNaN(n) && n > 20000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    return d.toISOString().slice(0, 10)
  }
  return s.slice(0, 10)
}

function normHours(v: ExcelJS.CellValue): number {
  if (v == null || v === '') return 0
  if (typeof v === 'object' && 'error' in v) return 0
  // 公式单元格：取计算结果
  if (typeof v === 'object' && 'formula' in v) {
    return normHours((v as { result?: ExcelJS.CellValue }).result ?? null)
  }
  if (typeof v === 'object' && 'result' in v) {
    return normHours((v as { result: unknown }).result as ExcelJS.CellValue)
  }
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// ===== 导入查重（v1.8.1）：项目 + 作业日期 + 问题全文（换行/空白归一化）=====
// 库中已存在或本文件内部重复的行一律跳过，防止重复上传成倍产生冗余台账
export function normProblemKey(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim()
}
export function opLogDupKey(pid: string | null | undefined, date: unknown, problem: string): string {
  return `${pid || ''}|${(date as string) || ''}|${normProblemKey(problem)}`
}

// ===== 数据作用域（v1.8）：非管理者只能查看/操作「自己创建或参与的项目」的台账，admin 不限 =====
// v1.8.3 起新建/导入强制关联项目；无项目归属（project_id 为空）仅可能是历史遗留数据，仍仅 admin 可见
// AI 案例召回按约定不隔离（跨项目经验共享）
function scopeOf(req: AuthRequest): string[] | undefined {
  const user = userRepo.findById(req.userId!)
  return scopedProjectIds(user)
}

// 「作用域 + 显式项目筛选」→ 查询条件：admin(undefined) 不限制；显式项目不在范围 → null（空集，防越权枚举）；否则限定集合
export function scopeToProjectIds(scope: string[] | undefined, projectId?: string): string[] | null | undefined {
  if (scope === undefined) return undefined
  if (projectId) return scope.includes(projectId) ? [projectId] : null
  return scope
}

// ===== 写入权限（v1.9.3）：登记/修改/导入须为该项目的负责人或成员；删除仅项目负责人；admin 全权例外 =====
// guest 无写入资格；无项目归属的历史遗留台账仅 admin 可操作
function findProjectOr404(projectId: string | null | undefined) {
  if (!projectId) throw new ApiError(403, '无项目归属的历史台账仅管理员可操作')
  const p = projectRepo.findById(String(projectId))
  if (!p) throw new ApiError(404, '关联项目不存在')
  return p
}

/** 登记/修改/导入守卫：admin 放行；guest 拒绝；其余须为项目负责人或项目成员 */
export function assertOpLogRegisterAccess(user: User | undefined, projectId: string | null | undefined): void {
  if (!user) throw new ApiError(401, '未登录')
  if (user.role === 'admin') return
  if (user.role === 'guest') throw new ApiError(403, '访客无权登记台账')
  const p = findProjectOr404(projectId)
  if (p.ownerId === user.id) return
  if (projectRepo.members(p.id).some((m) => m.userId === user.id)) return
  throw new ApiError(403, '只有该项目的负责人或成员才能登记台账')
}

/** 删除守卫：admin 放行；其余仅项目负责人 */
export function assertOpLogDeleteAccess(user: User | undefined, projectId: string | null | undefined): void {
  if (!user) throw new ApiError(401, '未登录')
  if (user.role === 'admin') return
  const p = findProjectOr404(projectId)
  if (p.ownerId !== user.id) throw new ApiError(403, '只有项目负责人才能删除台账')
}

// ===== 台账工时入账（v1.9.4 方案 A）=====
// 台账是运维工时的唯一录入入口：保存台账后自动把工时落到关联任务的 task_hours（正式成本口径，含时薪快照）。
// 不走 20% 单日上限校验——台账是事后实际记录，单条整天工时是常态。
// task_hours.op_log_id 反向关联：编辑台账同步更新该条记录，删除台账联动清除；周表/快速登记等手动路径一律排除该类记录。

/** 兜底任务标题：未指定关联任务的台账工时统一归集到该项目下这个任务 */
export const OPLOG_FALLBACK_TASK_TITLE = '运维日常工作'

/** 找或建项目的「运维日常工作」兜底任务 */
export function findOrCreateFallbackTask(projectId: string): Task {
  const row = db.prepare(
    'SELECT id FROM tasks WHERE project_id = ? AND title = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
  ).get(projectId, OPLOG_FALLBACK_TASK_TITLE) as { id: string } | undefined
  if (row) {
    const t = taskRepo.findById(row.id)
    if (t) return t
  }
  return taskRepo.create({
    projectId,
    title: OPLOG_FALLBACK_TASK_TITLE,
    description: '运维台账工时自动归集任务（未指定关联任务的台账工时计入此处）',
    status: 'in_progress',
    priority: 'low',
    assigneeId: null,
    labels: [],
    dueDate: null,
  })
}

/** 台账工时与 task_hours 的同步：hours<=0 或无关联任务时清除入账记录，否则 upsert（日期/任务/工时跟随台账） */
export function syncOpLogHours(opLog: { id: string; userId: string; logDate: string | null; hours: number }, taskId: string | null): void {
  const existing = db.prepare('SELECT * FROM task_hours WHERE op_log_id = ?').get(opLog.id) as SqlRow | undefined
  const hours = Number(opLog.hours) || 0
  if (!taskId || hours <= 0) {
    if (existing) db.prepare('DELETE FROM task_hours WHERE id = ?').run(existing.id)
    return
  }
  const date = opLog.logDate || new Date().toISOString().slice(0, 10)
  if (existing) {
    // 计费跟随规则与周表批量一致：用户自定义过计费比例（计费≠实际）的保留，否则跟随新工时
    const curActual = Number(existing.actual_hours) || 0
    const curBilled = Number(existing.billed_hours) || 0
    const newBilled = curBilled === curActual ? hours : curBilled
    db.prepare('UPDATE task_hours SET task_id = ?, user_id = ?, date = ?, actual_hours = ?, billed_hours = ? WHERE id = ?')
      .run(taskId, opLog.userId, date, hours, newBilled, existing.id)
    return
  }
  // 首次入账：冻结时薪快照（与手动登记同口径）
  const { rate, source } = resolveHourlyRate(opLog.userId, taskId)
  db.prepare(
    'INSERT INTO task_hours (id, task_id, user_id, date, planned_hours, actual_hours, billed_hours, description, rate_snapshot, rate_source, op_log_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(genId(), taskId, opLog.userId, date, 0, hours, hours, '运维台账自动入账', rate, source, opLog.id, new Date().toISOString())
}

/** 解析台账的关联任务：显式指定并校验项目归属；未指定且有工时时归集到兜底任务；无效/无工时返回 null */
export function resolveOpLogTaskId(projectId: string | null, hours: number, explicitTaskId: unknown, currentTaskId: string | null | undefined): string | null {
  const explicit = explicitTaskId !== undefined && explicitTaskId !== null && String(explicitTaskId).trim() !== ''
  if (explicit) {
    const t = taskRepo.findById(String(explicitTaskId))
    if (!t || t.deletedAt || t.projectId !== projectId) throw new ApiError(400, '关联任务不存在或不属于该台账所属项目')
    return t.id
  }
  // 未显式指定：有工时则沿用当前关联或落到兜底任务；无工时则不关联
  if ((Number(hours) || 0) <= 0) return null
  if (currentTaskId) {
    const t = taskRepo.findById(currentTaskId)
    if (t && !t.deletedAt && t.projectId === projectId) return t.id
  }
  return findOrCreateFallbackTask(String(projectId)).id
}

// ===== 列表 =====
router.get('/op-logs', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query
    const logs = opLogRepo.find({
      projectId: (q.projectId as string) || undefined,
      projectIds: scopeToProjectIds(scopeOf(req), (q.projectId as string) || undefined),
      category: (q.category as string) || undefined,
      status: (q.status as string) || undefined,
      system: (q.system as string) || undefined,
      department: (q.department as string) || undefined,
      keyword: (q.keyword as string) || undefined,
      dateFrom: (q.dateFrom as string) || undefined,
      dateTo: (q.dateTo as string) || undefined,
      sortBy: (q.sortBy as string) || undefined,
      sortDir: q.sortDir === 'asc' ? 'asc' : q.sortDir === 'desc' ? 'desc' : undefined,
    })
    res.json({ logs })
  } catch (e) { next(e) }
})

// ===== 统计：按月+分类分组的条数与工时合计 =====
router.get('/op-logs/stats', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query
    const rows = opLogRepo.stats({
      projectId: (q.projectId as string) || undefined,
      projectIds: scopeToProjectIds(scopeOf(req), (q.projectId as string) || undefined),
      category: (q.category as string) || undefined,
      status: (q.status as string) || undefined,
      system: (q.system as string) || undefined,
      department: (q.department as string) || undefined,
      keyword: (q.keyword as string) || undefined,
      dateFrom: (q.dateFrom as string) || undefined,
      dateTo: (q.dateTo as string) || undefined,
    })
    res.json({ stats: rows })
  } catch (e) { next(e) }
})

// ===== 筛选选项（分类/系统/部门去重列表，可按项目隔离）=====
router.get('/op-logs/options', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = (req.query.projectId as string) || undefined
    const projectIds = scopeToProjectIds(scopeOf(req), projectId)
    res.json({
      categories: opLogRepo.distinct('category', projectId, projectIds),
      systems: opLogRepo.distinct('system', projectId, projectIds),
      departments: opLogRepo.distinct('department', projectId, projectIds),
      statuses: VALID_STATUS,
    })
  } catch (e) { next(e) }
})

// ===== 新增 =====
router.post('/op-logs', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body || {}
    if (!b.problem || !String(b.problem).trim()) throw new ApiError(400, '问题描述必填')
    if (b.status && !VALID_STATUS.includes(b.status)) throw new ApiError(400, '无效的状态')
    // 状态为「已完成」时，经验三字段必须填写（沉淀排障经验）
    const missing = completionMissing(b)
    if (missing.length > 0) throw new ApiError(400, `状态为已完成时必须填写：${missing.join('、')}`)
    // 台账必须关联项目：所有运维作业（含内部作业）统一归集到项目名下，admin 也不例外
    if (!b.projectId) throw new ApiError(400, '台账必须关联项目，请选择所属项目')
    // 写入权限（v1.9.3）：仅该项目的负责人或成员可登记（admin 例外）
    assertOpLogRegisterAccess(userRepo.findById(req.userId!), String(b.projectId))
    // 关联任务解析（v1.9.4）：显式指定须属于该项目；未指定且有工时 → 归集到项目「运维日常工作」任务
    const taskId = resolveOpLogTaskId(String(b.projectId), Number(b.hours) || 0, b.taskId, undefined)
    // 自定义列数量上限（__ 前缀内部字段除外）
    assertExtraColumnsLimit(b.extraFields)
    // 项目启用自定义列配置时，字段键必须在定义内（导出按配置取值，配置外字段会静默丢失）
    const postExtraConfig = projectRepo.findById(String(b.projectId))?.oplogExtraColumns
    if (postExtraConfig?.enabled) assertExtraFieldsMatchConfig(b.extraFields, postExtraConfig)
    const log = opLogRepo.create(req.userId!, {
      projectId: String(b.projectId),
      category: b.category,
      status: b.status,
      proposer: b.proposer,
      system: b.system,
      department: b.department,
      logDate: b.logDate,
      recorder: b.recorder,
      problem: String(b.problem).trim(),
      completionDate: b.completionDate || null,
      hours: Number(b.hours) || 0,
      detail: b.detail,
      cause: b.cause,
      solution: b.solution,
      extraFields: b.extraFields,
      taskId,
    })
    // 工时自动入账到关联任务的 task_hours（豁免 20% 上限，事后实际记录）
    syncOpLogHours(log, taskId)
    // 入账后回读，保证响应里 hoursSynced 状态准确
    res.status(201).json({ log: opLogRepo.findById(log.id) ?? log })
  } catch (e) { next(e) }
})

// ===== 修改 =====
router.patch('/op-logs/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = req.body || {}
    if (b.status && !VALID_STATUS.includes(b.status)) throw new ApiError(400, '无效的状态')
    if (b.problem !== undefined && !String(b.problem).trim()) throw new ApiError(400, '问题描述必填')
    // 修改越权：不可见项目的台账视同不存在；修改/移动按登记权限校验（v1.9.3）
    const scope = scopeOf(req)
    const cur = opLogRepo.findById(String(req.params.id))
    if (!cur) throw new ApiError(404, '台账记录不存在')
    if (scope !== undefined) {
      if (!cur.projectId || !scope.includes(String(cur.projectId))) throw new ApiError(404, '台账记录不存在')
    }
    assertOpLogRegisterAccess(userRepo.findById(req.userId!), cur.projectId)
    if (b.projectId !== undefined && b.projectId !== cur.projectId) {
      if (!b.projectId) throw new ApiError(400, '台账必须关联项目，请选择所属项目')
      assertOpLogRegisterAccess(userRepo.findById(req.userId!), String(b.projectId))
    }
    // 已完成状态必须填写经验三字段（合并现有值与本次更新后校验，防止清空已完成记录的经验字段）
    const merged = { ...cur, ...b } as Record<string, unknown>
    const missing = completionMissing(merged as never)
    if (missing.length > 0) throw new ApiError(400, `状态为已完成时必须填写：${missing.join('、')}`)
    // 自定义列数量上限（__ 前缀内部字段除外；未传 extraFields 不校验，存量数据原样保留）
    if (b.extraFields !== undefined) {
      assertExtraColumnsLimit(b.extraFields)
      // 按目标项目（可能切换归属）的自定义列配置做字段白名单校验
      const patchExtraConfig = projectRepo.findById(b.projectId !== undefined ? (b.projectId ? String(b.projectId) : cur.projectId) : cur.projectId)?.oplogExtraColumns
      if (patchExtraConfig?.enabled) assertExtraFieldsMatchConfig(b.extraFields, patchExtraConfig)
    }
    // 关联任务重解析（v1.9.4）：显式传 taskId 优先（空串=自动归集）；未传沿用现有关联，有工时无关联则落到兜底任务
    const nextProjectId = b.projectId !== undefined ? (b.projectId ? String(b.projectId) : cur.projectId) : cur.projectId
    const mergedHours = Number(merged.hours) || 0
    const taskId = resolveOpLogTaskId(nextProjectId, mergedHours, b.taskId, cur.taskId)
    const log = opLogRepo.update(req.params.id, { ...b, taskId })
    if (!log) throw new ApiError(404, '台账记录不存在')
    // 同步入账记录（日期/任务/工时跟随台账；工时清零或无关联时自动清除）
    syncOpLogHours(log, taskId)
    // 入账后回读，保证响应里 hoursSynced 状态准确
    res.json({ log: opLogRepo.findById(log.id) ?? log })
  } catch (e) { next(e) }
})

// ===== 删除（软删除）=====
router.delete('/op-logs/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // 删除越权：guest 不可见项目的台账视同不存在；删除仅项目负责人（admin 例外，v1.9.3）
    const cur = opLogRepo.findById(String(req.params.id))
    if (!cur) throw new ApiError(404, '台账记录不存在')
    const scope = scopeOf(req)
    if (scope !== undefined && (!cur.projectId || !scope.includes(String(cur.projectId)))) {
      throw new ApiError(404, '台账记录不存在')
    }
    assertOpLogDeleteAccess(userRepo.findById(req.userId!), cur.projectId)
    const ok = opLogRepo.softDelete(req.params.id, req.userId)
    if (!ok) throw new ApiError(404, '台账记录不存在')
    // 联动清除该台账自动入账的工时记录（手动登记的不受影响）
    db.prepare('DELETE FROM task_hours WHERE op_log_id = ?').run(cur.id)
    // 审计：项目活动日志留痕（v1.10.0），配合 op_logs.deleted_by 双通道追责
    if (cur.projectId) {
      activityLogRepo.create(cur.projectId, req.userId!, 'oplog_delete',
        `删除台账「${String(cur.problem || '').slice(0, 30)}」(${cur.logDate})`)
    }
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ===== Excel 模板下载 =====
router.get('/op-logs/template.xlsx', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // 指定项目且启用自定义列配置时，按项目定义生成自定义列区（列名与顺序一致，保证模板→导入闭环）
    const tplProject = req.query.projectId ? projectRepo.findById(String(req.query.projectId)) : undefined
    const tplConfig = tplProject?.oplogExtraColumns?.enabled ? tplProject.oplogExtraColumns : null
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('运维台账')
    const header = ws.addRow(FIXED_COLUMNS.map((c) => c.label))
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    ws.getRow(1).height = 25
    FIXED_COLUMNS.forEach((_, i) => ws.getColumn(i + 1).width = 18)
    // 示例行（序号列在最前）
    ws.addRow([1, '系统故障', '已完成', '张三', 'OA系统', '技术部', '2026-09-01', '李四', '登录页面报错', '2026-09-02', 2, '用户反馈无法登录，报500错误', '缓存服务异常', '重启缓存服务并清理过期key'])
    // 第二行起为扩展列区：配置模式按项目定义生成表头；通用模式给 1 列演示
    const extraStartCol = FIXED_COLUMNS.length + 1
    if (tplConfig) {
      tplConfig.columns.forEach((c, i) => {
        const cell = ws.getCell(1, extraStartCol + i)
        cell.value = c.label
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        ws.getColumn(extraStartCol + i).width = 22
      })
      // 单元格批注（ExcelJS 的 comment 类型未暴露在 Cell 上，走断言）
      ;(ws.getCell(1, extraStartCol) as unknown as { comment: { texts: { text: string }[] } }).comment = {
        texts: [{ text: `自定义列由项目配置定义（共 ${tplConfig.columns.length} 个，按定义顺序排列）：导入/导出均按这些列名与顺序执行，导入按列名匹配（与列顺序无关），请勿修改这些表头。` }],
      }
    } else {
      ws.getCell(1, extraStartCol).value = '自定义列示例'
      ws.getCell(1, extraStartCol).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      ws.getCell(1, extraStartCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } }
      ;(ws.getCell(1, extraStartCol) as unknown as { comment: { texts: { text: string }[] } }).comment = {
        texts: [{ text: `自定义列最多 ${OP_LOG_MAX_EXTRA_COLUMNS} 个：在本列右侧继续插入新列并填写列名，导入时将自动识别为扩展字段（本演示列本身不会被导入）。` }],
      }
      ws.getCell(2, extraStartCol).value = '扩展字段值写在这里'
      ws.getColumn(extraStartCol).width = 22
    }

    const filename = encodeURIComponent('运维台账导入模板.xlsx')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    void workbook.xlsx.write(res).then(() => res.end())
  } catch (e) { next(e) }
})

// ===== Excel 导入 =====
router.post('/op-logs/import', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file
    if (!file) throw new ApiError(400, '请选择文件')
    // 台账必须关联项目：导入必须指定目标项目（前端全局模式下需先点选项目 Tab）
    const projectId = (req.body.projectId as string) || (req.query.projectId as string)
    if (!projectId) throw new ApiError(400, '导入台账必须关联项目，请先选择目标项目')
    // 导入权限（v1.9.3）：仅该项目的负责人或成员可导入（admin 例外）
    assertOpLogRegisterAccess(userRepo.findById(req.userId!), projectId)
    // 项目级自定义列配置：启用时表头按「列名→字段键」映射（顺序由配置决定）；未定义列不再入库，仅提示
    const extraConfig = projectRepo.findById(projectId)?.oplogExtraColumns
    const extraLabelMap = extraConfig?.enabled
      ? new Map(extraConfig.columns.map((c) => [c.label, c.key]))
      : null

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file.buffer)
    const ws = workbook.worksheets[0]
    if (!ws) throw new ApiError(400, 'Excel 中没有工作表')

    // ===== 智能查找表头行 =====
    // 扫描前 10 行，找到包含最多固定列名的行作为表头
    let headerRowNum = 0
    let bestMatch = 0
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      let matchCount = 0
      const row = ws.getRow(r)
      for (let c = 1; c <= Math.min(30, ws.columnCount); c++) {
        const label = cellText(row.getCell(c).value)
        if (label && FIXED_COLUMNS.some((col) => col.label === label)) {
          matchCount++
        }
      }
      if (matchCount > bestMatch) {
        bestMatch = matchCount
        headerRowNum = r
      }
    }
    if (bestMatch === 0) throw new ApiError(400, '无法识别表头，请确保包含「分类/状态/问题」等列名')

    // 构建列映射
    const headerRow = ws.getRow(headerRowNum)
    const colMap = new Map<number, string>() // col index -> field key
    const unknownColumns: string[] = [] // 未能识别为标准列的列名（归入自定义扩展字段），预检时提示防拼错
    let createdAtCol = 0 // 「登记日期」列号（0 = 文件中没有该列，导入时默认当天）
    const headerLabels: string[] = [] // 全部非空表头（重复列名校验用）
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const label = cellText(cell.value)
      if (!label) return
      headerLabels.push(label)
      if (label === '登记日期') { createdAtCol = colNumber; return }
      const fixed = FIXED_COLUMNS.find((c) => c.label === label)
      if (fixed) {
        colMap.set(colNumber, fixed.key)
      } else {
        // 序号列（№, No, 序号, 编号）映射为序号字段；跳过模板自带的自定义列示例
        const lowerLabel = label.toLowerCase()
        if (['自定义列示例'].includes(lowerLabel)) return
        if (['№', 'no', 'no.', '序号', '编号'].includes(lowerLabel)) {
          colMap.set(colNumber, 'seq')
          return
        }
        // 项目已启用自定义列配置：仅映射配置中定义的列名（与列位置无关），未定义列提示后丢弃
        if (extraLabelMap) {
          const key = extraLabelMap.get(label)
          if (key) colMap.set(colNumber, `extra:${key}`)
          else if (!unknownColumns.includes(label)) unknownColumns.push(label)
          return
        }
        if (!unknownColumns.includes(label)) unknownColumns.push(label)
        colMap.set(colNumber, `extra:${label}`)
      }
    })
    // 表头重复列名校验：重复列会导致后列覆盖前列（数据静默丢失），直接阻断
    const dupHeaders = findDuplicateHeaders(headerLabels)
    if (dupHeaders.length > 0) {
      throw new ApiError(400, `表头存在重复列名：${dupHeaders.join('、')}，请去除重复列后重新导入`)
    }
    // 配置模式：文件缺少的已定义自定义列（提示非阻断，未填写的列按空值导入）
    const missingColumns = extraConfig && extraLabelMap
      ? extraConfig.columns.map((c) => c.label).filter((l) => !headerLabels.includes(l))
      : []
    // 自定义列数量上限：仅在自由列模式（项目未启用配置）下生效；配置模式由项目定义约束
    if (!extraLabelMap && unknownColumns.length > OP_LOG_MAX_EXTRA_COLUMNS) {
      throw new ApiError(400, `自定义列最多 ${OP_LOG_MAX_EXTRA_COLUMNS} 个，文件中识别到 ${unknownColumns.length} 个：${unknownColumns.slice(OP_LOG_MAX_EXTRA_COLUMNS).join('、')}。请删减自定义列后重试`)
    }

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const duplicates: string[] = []
    // 经验字段完整性提醒（放行不拦截）：已完成但缺详细描述/原因/解决方案的行
    const fieldWarnings: string[] = []

    // 导入查重：库中已存在或本文件内部重复的行
    const existingKeys = new Set(
      opLogRepo.find(projectId ? { projectId } : {}).map((l) => opLogDupKey(l.projectId, l.logDate, l.problem))
    )
    const seenInFile = new Set<string>()

    // ===== 第一阶段：仅解析 + 标记重复（预检与正式导入共用），不写库 =====
    const parsed: { row: number; data: Record<string, unknown>; extra: Record<string, string>; createdAtVal: string; isDup: boolean; head: string }[] = []

    for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const data: Record<string, unknown> = {}
      const extra: Record<string, string> = {}
      let hasContent = false

      // 登记日期：文件有该列则按导入值，否则默认导入当天
      let createdAtVal = ''
      if (createdAtCol) {
        const d = normDate(row.getCell(createdAtCol).value)
        if (d) createdAtVal = d + 'T00:00:00'
      }

      colMap.forEach((key, colNumber) => {
        const raw = row.getCell(colNumber).value
        // 使用 cellText 提取文本（跳过错误单元格）
        if (key === 'logDate' || key === 'completionDate') {
          const d = normDate(raw)
          if (d) { data[key] = d; hasContent = true }
        } else if (key === 'hours') {
          const h = normHours(raw)
          if (h > 0) { data[key] = h; hasContent = true }
        } else if (key === 'seq') {
          // 序号：取整数，不计入 hasContent（仅有序号的空行仍按缺问题跳过）
          const t = cellText(raw)
          const n = t ? parseInt(t, 10) : NaN
          if (Number.isFinite(n)) data.seq = n
        } else if (key.startsWith('extra:')) {
          const t = cellText(raw)
          if (t) { extra[key.slice(6)] = t; hasContent = true }
        } else {
          const t = cellText(raw)
          if (t) { data[key] = t; hasContent = true }
        }
      })

      if (!hasContent) { skipped++; continue }
      if (!data.problem) {
        skipped++
        errors.push(`第 ${r} 行：缺少「问题」列内容，已跳过`)
        continue
      }
      // 状态映射（英文→中文，无法识别时回退为「待处理」）
      if (data.status) {
        data.status = normStatus(String(data.status))
      }
      // 查重标记：与库中已有台账或本文件前面的行重复（项目+作业日期+问题相同）
      const key = opLogDupKey(projectId, data.logDate, String(data.problem))
      const isDup = existingKeys.has(key) || seenInFile.has(key)
      seenInFile.add(key)
      const head = normProblemKey(String(data.problem)).replace(/\n/g, ' ').slice(0, 40)
      // 经验字段完整性提醒（放行不拦截）：状态为已完成但缺三字段任一，提示导入后补填
      const missing = completionMissing({
        status: data.status as string,
        detail: data.detail as string,
        cause: data.cause as string,
        solution: data.solution as string,
      })
      if (missing.length > 0) {
        fieldWarnings.push(`第 ${r} 行：「${head}」已完成但缺少：${missing.join('、')}`)
      }
      parsed.push({ row: r, data, extra, createdAtVal, isDup, head })
    }

    // ===== 预检模式：只统计重复，不写库（前端弹窗确认用）=====
    if ((req.body?.mode as string) === 'preview') {
      return res.json({
        mode: 'preview',
        total: parsed.length,
        newCount: parsed.length - parsed.filter((p) => p.isDup).length,
        duplicateCount: parsed.filter((p) => p.isDup).length,
        dupRows: parsed.filter((p) => p.isDup).map((p) => ({ row: p.row, problem: p.head, logDate: (p.data.logDate as string) || '' })),
        fieldWarningCount: fieldWarnings.length,
        unknownColumns: unknownColumns.slice(0, 10),
        missingColumns: missingColumns.slice(0, 10),
        skipped,
        errors: errors.slice(0, 20),
      })
    }

    // ===== 第二阶段：正式写入（skipDuplicates=false 时重复行照导）=====
    const skipDuplicates = (req.body?.skipDuplicates as string) !== 'false'
    for (const p of parsed) {
      if (p.isDup && skipDuplicates) {
        skipped++
        duplicates.push(`第 ${p.row} 行：「${p.head}${p.data.logDate ? `（${p.data.logDate}）` : ''}」与已有台账重复`)
        continue
      }

      try {
        opLogRepo.create(req.userId!, {
          projectId,
          seq: Number.isFinite(p.data.seq as number) ? (p.data.seq as number) : undefined,
          category: p.data.category as string,
          status: p.data.status as string,
          proposer: p.data.proposer as string,
          system: p.data.system as string,
          department: p.data.department as string,
          logDate: p.data.logDate as string,
          recorder: p.data.recorder as string,
          problem: String(p.data.problem),
          completionDate: (p.data.completionDate as string) || null,
          hours: Number(p.data.hours) || 0,
          detail: p.data.detail as string,
          cause: p.data.cause as string,
          solution: p.data.solution as string,
          extraFields: p.extra,
          createdAt: p.createdAtVal || undefined,
        })
        imported++
      } catch (rowErr) {
        // 单行失败不影响其他行
        skipped++
        errors.push(`第 ${p.row} 行：写入失败（${rowErr instanceof Error ? rowErr.message.slice(0, 50) : '未知错误'}），已跳过`)
      }
    }

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      duplicates: duplicates.slice(0, 20),
      duplicateCount: duplicates.length,
      fieldWarnings: fieldWarnings.slice(0, 20),
      fieldWarningCount: fieldWarnings.length,
      unknownColumns: unknownColumns.slice(0, 10),
      missingColumns: missingColumns.slice(0, 10),
    })
  } catch (e) { next(e) }
})

// ===== Excel 导出 =====
router.get('/op-logs/export.xlsx', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query
    const logs = opLogRepo.find({
      projectId: (q.projectId as string) || undefined,
      projectIds: scopeToProjectIds(scopeOf(req), (q.projectId as string) || undefined),
      category: (q.category as string) || undefined,
      status: (q.status as string) || undefined,
      system: (q.system as string) || undefined,
      department: (q.department as string) || undefined,
      keyword: (q.keyword as string) || undefined,
      dateFrom: (q.dateFrom as string) || undefined,
      dateTo: (q.dateTo as string) || undefined,
      sortBy: (q.sortBy as string) || undefined,
      sortDir: q.sortDir === 'asc' ? 'asc' : q.sortDir === 'desc' ? 'desc' : undefined,
    })

    // 自定义列导出口径：
    // - 目标项目启用自定义列配置 → 按配置的名称与顺序导出（数据按字段键取值）
    // - 跨项目导出或未配置 → 保持旧行为（数据中实际出现的扩展字段，按首次出现顺序）
    const exportProject = q.projectId ? projectRepo.findById(String(q.projectId)) : undefined
    const exportConfig = exportProject?.oplogExtraColumns?.enabled ? exportProject.oplogExtraColumns : null
    const extraKeys: string[] = exportConfig ? exportConfig.columns.map((c) => c.key) : []
    const extraHeaders: string[] = exportConfig ? exportConfig.columns.map((c) => c.label) : []
    if (!exportConfig) {
      for (const log of logs) {
        for (const k of Object.keys(log.extraFields || {})) {
          if (k.startsWith('__')) continue
          if (!extraKeys.includes(k)) extraKeys.push(k)
        }
      }
      extraHeaders.push(...extraKeys)
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = '项目管理系统'
    const ws = workbook.addWorksheet('运维台账')

    // 跨项目导出（未按项目筛选）时附加「项目」列，便于区分归属；序号永远第 1 列
    const includeProject = !q.projectId
    const projName = new Map<string, string>()
    if (includeProject) {
      for (const p of projectRepo.findAll()) projName.set(p.id, p.name)
    }

    const headers = [
      '序号',
      ...(includeProject ? ['项目'] : []),
      ...FIXED_COLUMNS.filter((c) => c.key !== 'seq').map((c) => c.label),
      ...extraHeaders,
      '登记日期',
    ]
    const headerRow = ws.addRow(headers)
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })
    ws.getRow(1).height = 25

    const statusColors: Record<string, string> = {
      待处理: 'FFFFF2F2',
      处理中: 'FFFFF2CC',
      暂停: 'FFFCE4D6',
      取消: 'FFE7E6E6',
      已完成: 'FFE2EFDA',
      已关闭: 'FFF2F2F2',
    }

    logs.forEach((log) => {
      const values: (string | number | null)[] = [
        log.seq ?? '',
        ...(includeProject ? [log.projectId ? projName.get(log.projectId) || '未知项目' : '未关联'] : []),
        log.category, log.status, log.proposer, log.system, log.department,
        log.logDate, log.recorder, log.problem, log.completionDate || '',
        log.hours, log.detail, log.cause, log.solution,
      ]
      for (const k of extraKeys) values.push(log.extraFields[k] || '')
      // 登记日期：记录录入系统的时间（取日期部分）
      values.push(log.createdAt ? log.createdAt.slice(0, 10) : '')
      const row = ws.addRow(values)
      // 状态着色（状态列：序号1 + 项目列(0/1) + 分类之后 = 跨项目时第4列，否则第3列）
      const statusCell = row.getCell(includeProject ? 4 : 3)
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColors[log.status] || 'FFFFFFFF' } }
    })

    // 边框
    if (logs.length > 0) {
      for (let r = 2; r <= 1 + logs.length; r++) {
        for (let c = 1; c <= headers.length; c++) {
          const cell = ws.getCell(r, c)
          cell.border = {
            top: { style: 'hair', color: { argb: 'FFD9D9D9' } },
            left: { style: 'hair', color: { argb: 'FFD9D9D9' } },
            bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } },
            right: { style: 'hair', color: { argb: 'FFD9D9D9' } },
          }
          cell.alignment = { vertical: 'middle' }
        }
      }
    }

    // 列宽：序号8 + 13 个业务固定列；跨项目导出时项目列插在序号之后
    const widths = [8, 12, 10, 10, 14, 12, 12, 10, 30, 12, 8, 36, 24, 36]
    if (includeProject) widths.splice(1, 0, 14)
    widths.forEach((w, i) => ws.getColumn(i + 1).width = w)
    // 扩展列与登记日期列的起始列号（1-based）：序号(1) + 项目列(0/1) + 13 个业务固定列之后
    const extraStartCol = (includeProject ? 1 : 0) + FIXED_COLUMNS.length + 1
    extraKeys.forEach((_, i) => ws.getColumn(extraStartCol + i).width = 18)
    ws.getColumn(extraStartCol + extraKeys.length).width = 12
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    const filename = encodeURIComponent(`运维台账_${new Date().toISOString().slice(0, 10)}.xlsx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    void workbook.xlsx.write(res).then(() => res.end())
  } catch (e) { next(e) }
})

// ===== AI 经验分析（基于历史台账相似案例）=====

// 探测 AI 服务是否已配置（前端据此显隐「AI 分析」入口）
router.get('/op-logs/ai/status', (_req: AuthRequest, res: Response) => {
  res.json({ enabled: llm.enabled(), model: llm.chatModel() })
})

// ===== AI 分析输入校验 / 结果解析 / 案例序列化（analyze 与 analyze-stream 共用） =====
function parseAnalyzeInput(b: Record<string, unknown>) {
  const problem = String(b.problem || '').trim()
  if (problem.length < 2) throw new ApiError(400, '问题描述过短，无法分析')
  if (problem.length > 2000) throw new ApiError(400, '问题描述不能超过 2000 字')
  return {
    problem,
    topK: Math.min(Math.max(parseInt(String(b.topK), 10) || 5, 1), 8),
    projectId: b.projectId ? String(b.projectId) : undefined,
    detail: b.detail ? String(b.detail).slice(0, 2000) : undefined,
    system: b.system ? String(b.system).slice(0, 100) : undefined,
    category: b.category ? String(b.category).slice(0, 100) : undefined,
  }
}

function parseAnalysis(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const causes = Array.isArray(parsed.possibleCauses) ? parsed.possibleCauses : []
    return {
      summary: String(parsed.summary || ''),
      possibleCauses: causes
        .slice(0, 5)
        .map((c) => {
          const o = c as Record<string, unknown>
          return {
            cause: String(o.cause || ''),
            confidence: ['高', '中', '低'].includes(String(o.confidence)) ? String(o.confidence) : '中',
            basedOn: Array.isArray(o.basedOn) ? o.basedOn.map(String).slice(0, 3) : [],
          }
        })
        .filter((c) => c.cause),
      suggestedSteps: Array.isArray(parsed.suggestedSteps) ? parsed.suggestedSteps.map(String).slice(0, 8) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 5) : [],
    }
  } catch {
    // JSON 解析失败时整段作为 summary 展示，前端按纯文本渲染
    return { summary: raw, possibleCauses: [], suggestedSteps: [], risks: [] }
  }
}

const EMPTY_ANALYSIS = {
  summary: '台账中没有检索到相似的历史案例，无法基于过往经验给出判断，建议按常规排查流程处理。',
  possibleCauses: [] as Array<{ cause: string; confidence: string; basedOn: string[] }>,
  suggestedSteps: [] as string[],
  risks: [] as string[],
}

// 响应/SSE meta 共用的案例序列化（toAiCase 见 lib/recallCases.ts）

router.post(
  '/op-logs/ai/analyze',
  requirePermission('oplog.view'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = parseAnalyzeInput(req.body || {})
      const cases = await recallCases(input)

      // 无相似案例：不调用 LLM，直接返回降级结论（省 token，也避免模型凭空发挥）
      if (cases.length === 0) {
        return res.json({ analysis: EMPTY_ANALYSIS, cases: [], model: llm.chatModel() })
      }

      const raw = await llm.chat(
        buildAnalyzeMessages({ problem: input.problem, detail: input.detail, system: input.system, category: input.category }, cases),
        { jsonMode: true, maxTokens: 1200 },
      )

      res.json({ analysis: parseAnalysis(raw), model: llm.chatModel(), cases: cases.map(toAiCase) })
    } catch (e) { next(e) }
  },
)

// 流式分析（SSE）：事件序列 meta（召回案例）→ delta（正文增量，JSON 原文逐段）→ done（解析后的完整 analysis）；异常时发 error 事件
router.post(
  '/op-logs/ai/analyze-stream',
  requirePermission('oplog.view'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    let input
    try {
      input = parseAnalyzeInput(req.body || {})
    } catch (e) {
      return next(e)
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    // 客户端断开时中止上游 LLM 请求（同 chat-stream：须监听 res，req 的 close 会在请求体读完后误触发）
    const upstream = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) upstream.abort()
    })

    try {
      const cases = await recallCases(input)

      send('meta', { cases: cases.map(toAiCase), model: llm.chatModel() })

      if (cases.length === 0) {
        send('done', { analysis: EMPTY_ANALYSIS, model: llm.chatModel() })
        return res.end()
      }

      const raw = await llm.chatStream(
        buildAnalyzeMessages({ problem: input.problem, detail: input.detail, system: input.system, category: input.category }, cases),
        { jsonMode: true, maxTokens: 1200, signal: upstream.signal, onDelta: (text) => send('delta', { text }) },
      )

      send('done', { analysis: parseAnalysis(raw), model: llm.chatModel() })
      res.end()
    } catch (e) {
      // SSE 已建立，改用 error 事件告知前端（前端可降级非流式或提示重试）
      send('error', { message: e instanceof ApiError ? e.message : 'AI 分析失败' })
      res.end()
    }
  },
)

// ===== AI 对话式排障（P2）：无状态多轮问答，前端随请求携带历史 =====

/** 对话历史校验：仅保留 user/assistant、单条 ≤2000 字、最多 12 轮、末条必须是用户输入 */
function parseChatHistory(b: Record<string, unknown>): ChatTurn[] {
  const raw = Array.isArray(b.messages) ? b.messages : []
  const turns: ChatTurn[] = []
  for (const m of raw) {
    const o = m as Record<string, unknown>
    const content = String(o.content || '').trim().slice(0, 2000)
    if (!content) continue
    turns.push({ role: o.role === 'assistant' ? 'assistant' : 'user', content })
    if (turns.length >= 12) break
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    throw new ApiError(400, '对话内容无效')
  }
  return turns
}

// 事件协议与 analyze-stream 一致：meta（召回案例）→ delta（正文增量）→ done；异常发 error。
// 召回为空时不跳过 LLM：system 提示词会要求模型先声明台账无相关记录，再给通用建议。
router.post(
  '/op-logs/ai/chat-stream',
  requirePermission('oplog.view'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    let history: ChatTurn[]
    try {
      history = parseChatHistory(req.body || {})
    } catch (e) {
      return next(e)
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    const upstream = new AbortController()
    // 客户端断开检测：res 上 close 才代表连接关闭（req 的 close 在请求体读取完毕后就会触发，
    // 会导致 upstream 在正常请求中被误杀）；writableEnded 排除正常结束的场景
    res.on('close', () => {
      if (!res.writableEnded) upstream.abort()
    })

    try {
      // 关键词取最近两轮用户输入拼接，缓解多轮对话的语义漂移
      const userTurns = history.filter((t) => t.role === 'user')
      const lastUser = userTurns[userTurns.length - 1]
      const prevUser = userTurns[userTurns.length - 2]
      const projectId = req.body?.projectId ? String(req.body.projectId) : undefined

      const cases = await recallCases({
        problem: lastUser.content,
        topK: 8,
        projectId,
        detail: prevUser?.content,
      })

      send('meta', { cases: cases.map(toAiCase), model: llm.chatModel() })

      await llm.chatStream(
        buildChatMessages(history, cases),
        { maxTokens: 1500, signal: upstream.signal, onDelta: (text) => send('delta', { text }) },
      )

      send('done', { model: llm.chatModel() })
      res.end()
    } catch (e) {
      send('error', { message: e instanceof ApiError ? e.message : 'AI 助手回复失败' })
      res.end()
    }
  },
)

// 单条台账详情（须注册在 /op-logs/ai/status 等字面量 GET 路由之后，避免被 :id 抢匹配）
router.get('/op-logs/:id', requirePermission('oplog.view'), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const log = opLogRepo.findById(String(req.params.id))
    if (!log) throw new ApiError(404, '台账记录不存在')
    // 读取越权：不可见项目的台账视同不存在（AI 案例卡片可跨项目出现，点击后走此兜底）
    const scope = scopeOf(req)
    if (scope !== undefined && (!log.projectId || !scope.includes(String(log.projectId)))) {
      throw new ApiError(404, '台账记录不存在')
    }
    res.json({ log })
  } catch (e) { next(e) }
})
