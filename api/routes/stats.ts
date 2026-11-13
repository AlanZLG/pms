// 统计路由

import { Router, type Response, type NextFunction } from 'express'
import db from '../db.ts'
import { projectRepo, taskRepo, userRepo, messageRepo, budgetRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { beijingDaysAgo } from '../lib/utils.ts'
import { llm } from '../lib/llm.ts'
import type { User, WorkloadItem, Project, Task, ProjectHealth } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// 权限作用域（v1.9.2）：仅访客(guest)限制在自己参与的项目；内部成员全局可见概览
// 返回 undefined = 不限制（内部成员）；[] = 无可见项目（统计为 0）；数组 = 可见项目 id 集合
export function scopedProjectIds(user: User | undefined): string[] | undefined {
  if (!user) return []
  if (user.role !== 'guest') return undefined
  const projects = projectRepo.findAll().filter(
    (p) => p.ownerId === user.id || p.members.some((m) => m.userId === user.id),
  )
  return projects.map((p) => p.id)
}

// 解析 projectId 查询参数：必须落在可见范围内，越权访问一律返回空集而不是全量
export function resolveScope(user: User | undefined, rawProjectId: string): string[] | undefined {
  const ids = scopedProjectIds(user)
  if (!rawProjectId) return ids
  if (ids === undefined) return [rawProjectId]
  return ids.includes(rawProjectId) ? [rawProjectId] : []
}

// 总览
router.get('/overview', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    const projectId = (req.query.projectId as string) || ''
    // 显式传 days 才启用窗口口径（Dashboard 不传 days，保持全量）
    const daysProvided = req.query.days !== undefined
    const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 14, 1), 90)
    const since = daysProvided ? new Date(Date.now() - days * 86400000).toISOString() : undefined
    const scope = resolveScope(user, projectId)
    const visibleProjects = projectRepo.findAll().filter((p) => !scope || scope.includes(p.id))
    // 逾期按日级比较：截止日早于今天才算逾期，当天截止不算（与前端 Dashboard 口径一致）
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const overdue = visibleProjects.filter((p) => p.dueDate && new Date(p.dueDate) < today0 && p.status !== 'completed').length
    res.json({
      totalProjects: visibleProjects.length,
      activeProjects: visibleProjects.filter((p) => p.status === 'active').length,
      completedProjects: visibleProjects.filter((p) => p.status === 'completed').length,
      overdueProjects: overdue,
      tasksByStatus: taskRepo.countByStatus(scope, since),
      trend: taskRepo.trendDaily(days, scope),
    })
  } catch (e) { next(e) }
})

// 项目健康度（方案 B）：时间进度(项目周期内插) / 任务完成率偏差 / 逾期任务密度 / 逾期天数 → 0-100 评分
// 评分规则：100 分起扣 —— 进度每落后 1% 扣 1 分；逾期任务密度 ×30；项目逾期 ≤7天扣15、8-30天扣30、>30天扣50；
// 临期预警（未逾期但时间进度 ≥90% 且完成率 <80%）扣 10。≥80 健康 / ≥60 预警 / <60 风险
export function computeProjectHealth(
  p: Project,
  tasks: Task[],
  today0: Date,
  now: number,
): ProjectHealth {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  const active = tasks.filter((t) => t.status !== 'done')
  const done = tasks.length - active.length
  const doneRate = tasks.length ? Math.round((done / tasks.length) * 100) : null

  // 时间进度：按项目自身起止周期内插（起始缺省取创建时间），不再是自然年口径
  const due = p.dueDate ? new Date(p.dueDate) : null
  let timeProgress: number | null = null
  if (due) {
    const start = p.startDate ? new Date(p.startDate) : new Date(p.createdAt)
    const total = due.getTime() - start.getTime()
    timeProgress = total <= 0 ? 100 : Math.round(clamp(((now - start.getTime()) / total) * 100, 0, 100))
  }
  const deviation = doneRate !== null && timeProgress !== null ? doneRate - timeProgress : null

  // 项目逾期：仅未完成项目计天数（口径与 overview 一致）
  const isOverdue = !!p.dueDate && new Date(p.dueDate) < today0 && p.status !== 'completed'
  // 天数按"截止日当天零点"归一：due 可能是带时刻的原始时间戳，直接 floor 会在逾期不足 24h 时算出 0，
  // 导致统计卡显示有逾期项目、明细面板（overdueDays > 0）却为空
  const dueDay0 = new Date(new Date(p.dueDate!).getTime())
  dueDay0.setHours(0, 0, 0, 0)
  const overdueDays = isOverdue ? Math.round((today0.getTime() - dueDay0.getTime()) / 86400000) : 0

  const overdueTasks = active.filter((t) => t.dueDate && new Date(t.dueDate) < today0).length
  const overdueDensity = active.length ? overdueTasks / active.length : 0

  let score = 100
  if (deviation !== null && deviation < 0) score += deviation
  score -= Math.round(overdueDensity * 30)
  if (overdueDays > 30) score -= 50
  else if (overdueDays > 7) score -= 30
  else if (overdueDays > 0) score -= 15
  else if (timeProgress !== null && timeProgress >= 90 && (doneRate ?? 0) < 80) score -= 10

  return {
    projectId: p.id, projectName: p.name, ownerId: p.ownerId, ownerName: p.ownerName, status: p.status,
    timeProgress, doneRate, deviation,
    overdueDays, overdueTasks, activeTasks: active.length, overdueDensity,
    healthScore: clamp(Math.round(score), 0, 100),
    healthLevel: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'danger',
  }
}

router.get('/health', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    const projectId = (req.query.projectId as string) || ''
    const scope = resolveScope(user, projectId)
    const projects = projectRepo.findAll().filter((p) => !scope || scope.includes(p.id))
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const now = Date.now()
    res.json({ health: projects.map((p) => computeProjectHealth(p, taskRepo.findByProject(p.id), today0, now)) })
  } catch (e) { next(e) }
})

// 燃尽图
router.get('/burndown', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    const projectId = (req.query.projectId as string) || ''
    // 时间窗口（天）：0/缺省 = 全量时间轴；1-90 = 只返回最近 N+1 天（含今天）
    const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 0, 0), 90)
    res.json(taskRepo.burndown(resolveScope(user, projectId), days))
  } catch (e) { next(e) }
})

// 成员工作量（双口径：任务数 + 工时）
export function computeWorkload(user: User, projectId: string, days: number): WorkloadItem[] {
  // since 为 UTC 时刻，与任务 updated_at（时刻）比较用；
  // 工时口径的窗口下界必须用北京日期（th.date 是北京日期列），UTC 日期在凌晨 0-8 点会多算一天
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : ''
  const sinceDate = days > 0 ? beijingDaysAgo(days) : ''
  const scope = resolveScope(user, projectId)
  // 越权访问指定项目 → 空结果
  if (scope && scope.length === 0) return []

  let users = userRepo.findAll()
  // 非管理员只展示自己 + 自己可见项目里的成员
  if (scope) {
    const memberIds = new Set<string>([user.id])
    projectRepo.findAll().forEach((p) => {
      if (scope.includes(p.id)) p.members.forEach((m) => memberIds.add(m.userId))
    })
    users = users.filter((u) => memberIds.has(u.id))
  }

  const getSortOrder = (u: User) => {
    if (u.role === 'admin') return 0
    if (u.role === 'finance') return 1
    if (!u.isOutsourced) return 3
    return 4
  }

  users.sort((a, b) => {
    const orderA = getSortOrder(a)
    const orderB = getSortOrder(b)
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })

  // 实绩工时合计：按任务归属（assignee）汇总 task_hours.actual_hours（含台账自动入账），
  // 与 Excel「项目进度报告」成员工作量同口径；限定可见项目，时间窗口按工时日期（date 为 YYYY-MM-DD）
  const actualHoursOf = (userId: string): number => {
    const clauses = ['t.assignee_id = ?']
    const params: unknown[] = [userId]
    if (scope) {
      clauses.push(`t.project_id IN (${scope.map(() => '?').join(',')})`)
      params.push(...scope)
    }
    if (sinceDate) {
      clauses.push('th.date >= ?')
      params.push(sinceDate)
    }
    const row = db.prepare(
      `SELECT COALESCE(SUM(th.actual_hours), 0) AS h FROM task_hours th JOIN tasks t ON t.id = th.task_id WHERE ${clauses.join(' AND ')}`,
    ).get(...params) as { h: number | string } | undefined
    return Math.round((Number(row?.h) || 0) * 100) / 100
  }

  const round2 = (n: number) => Math.round(n * 100) / 100

  return users.map((u) => {
    let all = taskRepo.findByAssigneeAll(u.id, projectId || undefined)
      // 任务必须属于请求者可见的项目
      .filter((t) => !scope || scope.includes(t.projectId))
    // 时间窗口：只统计窗口内有动态的任务（新建或有过更新，保持 已完成/进行中 ⊆ 总任务 的口径）
    if (since) all = all.filter((t) => t.updatedAt >= since)
    return {
      userId: u.id, userName: u.name, avatarColor: u.avatarColor,
      total: all.length,
      done: all.filter((t) => t.status === 'done').length,
      inProgress: all.filter((t) => t.status === 'in_progress').length,
      // 计划工时：同一任务集的 planned_hours 合计（未填计划工时的任务计 0）
      plannedHours: round2(all.reduce((s, t) => s + (t.plannedHours ?? 0), 0)),
      actualHours: actualHoursOf(u.id),
    }
  })
}

// 成员工作量
router.get('/workload', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    const projectId = (req.query.projectId as string) || ''
    // 时间窗口（天）：缺省/0 = 不过滤（全量）；1-90 有效
    const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 0, 0), 90)
    res.json({ workload: computeWorkload(user!, projectId, days) })
  } catch (e) { next(e) }
})

// ---------- 仪表盘 AI 今日建议 ----------
// 当日缓存 + 数据指纹：待办/逾期/审批/未读数任一变化即重新生成；LLM 未配置或失败时降级为规则文案
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 规则文案兜底：零成本，随数据实时变化 */
function ruleBrief(snap: BriefSnap): { summary: string; suggestions: string[] } {
  const parts: string[] = []
  if (snap.overdueTasks > 0) parts.push(`${snap.overdueTasks} 个任务已逾期`)
  if (snap.pendingApprovals > 0) parts.push(`${snap.pendingApprovals} 项审批待处理`)
  if (snap.unread > 0) parts.push(`${snap.unread} 条未读消息`)
  const summary = parts.length
    ? `${snap.mineCount} 个任务待推进：${parts.join('，')}。`
    : snap.mineCount > 0
      ? `今天有 ${snap.mineCount} 个任务待推进，没有逾期和待审批事项，节奏良好。`
      : '今天暂无待办任务，可以安排项目复盘或规划下周工作。'

  const suggestions: string[] = []
  if (snap.overdueTasks > 0 && snap.topOverdue.length > 0) {
    suggestions.push(`优先处理逾期任务「${snap.topOverdue[0]}」${snap.overdueTasks > 1 ? `等 ${snap.overdueTasks} 项` : ''}`)
  }
  if (snap.pendingApprovals > 0) suggestions.push(`处理 ${snap.pendingApprovals} 项待审批，避免阻塞他人`)
  if (snap.mineCount > 0 && snap.topMine.length > 0) suggestions.push(`聚焦「${snap.topMine[0]}」${snap.mineCount > 1 ? `等 ${snap.mineCount} 项待办` : ''}，先难后易`)
  if (snap.overdueProjects > 0) suggestions.push(`${snap.overdueProjects} 个负责的项目已逾期，建议查看进度并同步风险`)
  if (suggestions.length === 0) suggestions.push('暂无紧急事项，适合推进长期任务或整理工作台账')
  return { summary, suggestions: suggestions.slice(0, 3) }
}

interface BriefSnap {
  mineCount: number
  topMine: string[]
  overdueTasks: number
  topOverdue: string[]
  pendingApprovals: number
  unread: number
  overdueProjects: number
}

router.get('/daily-brief', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user) return res.status(401).json({ error: '用户不存在' })
    const date = todayStr()

    // 数据快照（与仪表盘各卡片同口径）
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const mineAll = taskRepo.findByAssigneeAll(user.id)
      .filter((t) => t.status !== 'done')
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || ''))
    const overdueTasks = mineAll.filter((t) => t.dueDate && new Date(t.dueDate) < today0)
    // 审批口径与 /api/approvals 一致
    const canApproveBudgets = req.userRole === 'admin' || req.userRole === 'finance'
    const pendingApprovals = (canApproveBudgets ? budgetRepo.findPending().length : 0)
      + (req.userRole === 'admin' ? projectRepo.findPendingDeletions().length : 0)
    const overdueProjects = projectRepo.findAll().filter(
      (p) => p.ownerId === user.id && p.dueDate && new Date(p.dueDate) < today0 && p.status !== 'completed',
    ).length
    const snap: BriefSnap = {
      mineCount: mineAll.length,
      topMine: mineAll.slice(0, 3).map((t) => t.title),
      overdueTasks: overdueTasks.length,
      topOverdue: overdueTasks.slice(0, 3).map((t) => t.title),
      pendingApprovals,
      unread: messageRepo.unreadCount(user.id),
      overdueProjects,
    }
    const fingerprint = `${snap.mineCount}:${snap.overdueTasks}:${snap.pendingApprovals}:${snap.unread}:${snap.overdueProjects}`

    // 命中当日缓存且数据指纹未变 → 直接返回
    const cached = db.prepare('SELECT * FROM daily_briefs WHERE user_id = ? AND brief_date = ?').get(user.id, date) as
      | { summary: string; suggestions: string; source: string; model: string | null; fingerprint: string } | undefined
    if (cached && cached.fingerprint === fingerprint) {
      return res.json({ summary: cached.summary, suggestions: JSON.parse(cached.suggestions), source: cached.source, model: cached.model })
    }

    // LLM 可用 → 生成；失败/未启用 → 规则兜底
    if (llm.enabled()) {
      const weekday = `星期${WEEKDAY_CN[new Date().getDay()]}`
      const system = '你是项目管理系统仪表盘的「今日建议」助手。根据用户当天的工作数据，输出友好的中文简报。要求：summary 为一句话总览（不超过 50 字）；suggestions 为 2-3 条具体可执行的建议（每条不超过 40 字，引用任务名，不要空话套话）。只输出 JSON：{"summary":"...","suggestions":["..."]}'
      const dataText = [
        `今天是${date}（${weekday}）。`,
        `指派给我的未完成任务 ${snap.mineCount} 个${snap.topMine.length ? `，最近截止：${snap.topMine.join('、')}` : ''}。`,
        `其中已逾期 ${snap.overdueTasks} 个${snap.topOverdue.length ? `，如：${snap.topOverdue.join('、')}` : ''}。`,
        snap.pendingApprovals > 0 ? `等待我审批的事项 ${snap.pendingApprovals} 项。` : '无待审批事项。',
        snap.unread > 0 ? `未读站内消息 ${snap.unread} 条。` : '站内消息已读清。',
        snap.overdueProjects > 0 ? `我负责的项目中 ${snap.overdueProjects} 个已逾期。` : '我负责的项目无逾期。',
      ].join('\n')
      try {
        const raw = await llm.chat(
          [{ role: 'system', content: system }, { role: 'user', content: dataText }],
          // 思维链模型（Qwen3.8）思考消耗大量 token，300 会在 reasoning 阶段截断导致 content 为空；与 opLogs AI 分析同口径 1200
          { jsonMode: true, maxTokens: 1200 },
        )
        const parsed = JSON.parse(raw) as { summary?: string; suggestions?: string[] }
        const summary = (parsed.summary || '').trim().slice(0, 120)
        const suggestions = (parsed.suggestions || []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 60)).slice(0, 3)
        if (!summary || suggestions.length === 0) throw new Error('AI 返回格式不完整')
        db.prepare(
          `INSERT INTO daily_briefs(user_id, brief_date, fingerprint, summary, suggestions, source, model)
           VALUES (?, ?, ?, ?, ?, 'llm', ?)
           ON CONFLICT(user_id) DO UPDATE SET brief_date = excluded.brief_date, fingerprint = excluded.fingerprint,
             summary = excluded.summary, suggestions = excluded.suggestions, source = 'llm', model = excluded.model, created_at = CURRENT_TIMESTAMP`,
        ).run(user.id, date, fingerprint, summary, JSON.stringify(suggestions), llm.chatModel())
        return res.json({ summary, suggestions, source: 'llm', model: llm.chatModel() })
      } catch {
        // LLM 失败不阻塞仪表盘，落到规则文案（不入缓存，下次数据不变时仍先尝试 AI）
      }
    }

    const rule = ruleBrief(snap)
    return res.json({ summary: rule.summary, suggestions: rule.suggestions, source: 'rule', model: null })
  } catch (e) { next(e) }
})

export default router
