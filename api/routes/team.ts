// 团队/用户路由

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { userRepo, taskRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import type { UserRole } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// 用户列表(附带任务数)
router.get('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = userRepo.findAll()
    const list = users.map((u) => ({
      ...u,
      taskCount: taskRepo.findByAssigneeAll(u.id).length,
      activeCount: taskRepo.findByAssignee(u.id).length,
    }))
    res.json({ users: list })
  } catch (e) { next(e) }
})

router.patch('/:userId/role', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = userRepo.findById(req.userId!)
    if (current?.role !== 'admin') throw new ApiError(403, '仅管理员可修改角色')
    const schema = z.object({ role: z.enum(['admin', 'owner', 'member', 'guest']) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    userRepo.updateRole(req.params.userId, parsed.data.role as UserRole)
    res.json({ user: userRepo.findById(req.params.userId)! })
  } catch (e) { next(e) }
})

export default router