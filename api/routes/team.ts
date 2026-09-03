// 团队/用户路由

import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { userRepo, taskRepo, categoryRepo, customRoleRepo } from '../repository/repo.ts'
import { authRequired, financeRequired, type AuthRequest } from '../lib/auth.ts'
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
    const schema = z.object({ role: z.enum(['admin', 'finance', 'owner', 'member', 'guest']) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    userRepo.updateRole(req.params.userId, parsed.data.role as UserRole)
    res.json({ user: userRepo.findById(req.params.userId)! })
  } catch (e) { next(e) }
})

// 设置用户自定义角色
router.patch('/:userId/custom-role', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = userRepo.findById(req.userId!)
    if (current?.role !== 'admin') throw new ApiError(403, '仅管理员可修改角色')

    const schema = z.object({ customRoleId: z.string().nullable() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    // 如果提供了自定义角色ID，检查角色是否存在
    if (parsed.data.customRoleId) {
      const role = customRoleRepo.findById(parsed.data.customRoleId)
      if (!role) throw new ApiError(404, '角色不存在')
    }

    userRepo.updateCustomRole(req.params.userId, parsed.data.customRoleId)
    res.json({ user: userRepo.findById(req.params.userId)! })
  } catch (e) { next(e) }
})

// 获取所有自定义角色（用于下拉选择）
router.get('/custom-roles', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roles = customRoleRepo.findAll()
    res.json({ roles })
  } catch (e) { next(e) }
})

router.patch('/:userId/cost', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      isOutsourced: z.boolean().optional(),
      hourlyRate: z.number().optional().nullable(),
      costCenter: z.string().optional().nullable(),
      categoryId: z.string().optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const user = userRepo.updateCost(req.params.userId, parsed.data)
    if (!user) throw new ApiError(404, '用户不存在')
    res.json({ user })
  } catch (e) { next(e) }
})

router.get('/:userId/cost', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.params.userId)
    if (!user) throw new ApiError(404, '用户不存在')
    res.json({
      isOutsourced: user.isOutsourced,
      hourlyRate: user.hourlyRate,
      costCenter: user.costCenter,
      categoryId: user.categoryId,
    })
  } catch (e) { next(e) }
})

router.get('/categories', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const categories = categoryRepo.findAll()
    res.json({ categories })
  } catch (e) { next(e) }
})

router.post('/categories', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      hourlyRate: z.number().min(0),
      isOutsourced: z.boolean(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const category = categoryRepo.create({
      name: parsed.data.name,
      description: parsed.data.description,
      hourlyRate: parsed.data.hourlyRate,
      isOutsourced: parsed.data.isOutsourced,
    })
    res.status(201).json({ category })
  } catch (e) { next(e) }
})

router.put('/categories/:categoryId', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      hourlyRate: z.number().min(0).optional(),
      isOutsourced: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    categoryRepo.update(req.params.categoryId, parsed.data)
    res.json({ category: categoryRepo.findById(req.params.categoryId) })
  } catch (e) { next(e) }
})

router.delete('/categories/:categoryId', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    categoryRepo.delete(req.params.categoryId)
    res.json({ success: true })
  } catch (e) { next(e) }
})

export default router