// 统计路由

import { Router, type Response, type NextFunction } from 'express'
import { projectRepo, taskRepo, userRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import type { User, WorkloadItem } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// 权限作用域：非管理员只能看到自己创建/参与的项目
// 返回 undefined = 不限制（仅 admin）；[] = 无可见项目（统计为 0）；数组 = 可见项目 id 集合
export function scopedProjectIds(user: User | undefined): string[] | undefined {
  if (!user) return []
  if (user.role === 'admin') return undefined
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
    const now = new Date()
    const overdue = visibleProjects.filter((p) => p.dueDate && new Date(p.dueDate) < now && p.status !== 'completed').length
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
