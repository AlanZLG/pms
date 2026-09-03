// 统计路由

import { Router, type Response, type NextFunction } from 'express'
import { projectRepo, taskRepo, userRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import type { User, WorkloadItem } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// 总览
router.get('/overview', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    let projects = projectRepo.findAll()
    if (user?.role !== 'admin') {
      projects = projects.filter((p) => p.ownerId === user?.id || p.members.some((m) => m.userId === user?.id))
    }
    const now = new Date()
    const overdue = projects.filter((p) => p.dueDate && new Date(p.dueDate) < now && p.status !== 'completed').length
    res.json({
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'active').length,
      completedProjects: projects.filter((p) => p.status === 'completed').length,
      overdueProjects: overdue,
      tasksByStatus: taskRepo.countByStatus(),
      trend: taskRepo.trendDaily(14),
    })
  } catch (e) { next(e) }
})

// 燃尽图
router.get('/burndown', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = (req.query.projectId as string) || ''
    if (!projectId) {
      res.json({ dates: [], ideal: [], actual: [] })
      return
    }
    res.json(taskRepo.burndown(projectId))
  } catch (e) { next(e) }
})

// 成员工作量
router.get('/workload', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = userRepo.findAll()
    
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
      const all = taskRepo.findByAssigneeAll(u.id)
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