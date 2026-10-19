// 统计路由

import { Router, type Response, type NextFunction } from 'express'
import { projectRepo, taskRepo, userRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
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

// 成员工作量
router.get('/workload', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    const projectId = (req.query.projectId as string) || ''
    // 时间窗口（天）：缺省/0 = 不过滤（全量）；1-90 有效
    const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 0, 0), 90)
    const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : ''
    const scope = resolveScope(user, projectId)
    // 越权访问指定项目 → 空结果
    if (scope && scope.length === 0) return res.json({ workload: [] })

    let users = userRepo.findAll()
    // 非管理员只展示自己 + 自己可见项目里的成员
    if (scope) {
      const memberIds = new Set<string>([user!.id])
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

    const items: WorkloadItem[] = users.map((u) => {
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
      }
    })
    res.json({ workload: items })
  } catch (e) { next(e) }
})

export default router
