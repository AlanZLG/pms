// 项目路由

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { projectRepo, userRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import type { ProjectStatus, MemberRole } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

const createSchema = z.object({
  name: z.string().min(1, '项目名称必填').max(60),
  description: z.string().max(500).optional().default(''),
  status: z.enum(['planning', 'active', 'completed', 'archived']).optional().default('planning'),
  dueDate: z.string().nullable().optional().default(null),
})

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['planning', 'active', 'completed', 'archived']).optional(),
  dueDate: z.string().nullable().optional(),
})

// 列表
router.get('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user) throw new ApiError(404, '用户不存在')
    let list = projectRepo.findAll()
    // 非管理员仅可看见自己参与的项目
    if (user.role !== 'admin') {
      list = list.filter((p) => p.members.some((m) => m.userId === user.id) || p.ownerId === user.id)
    }
    res.json({ projects: list })
  } catch (e) { next(e) }
})

// 详情
router.get('/:projectId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    res.json({ project })
  } catch (e) { next(e) }
})

// 创建
router.post('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const project = projectRepo.create({
      name: parsed.data.name,
      description: parsed.data.description,
      status: parsed.data.status as ProjectStatus,
      ownerId: req.userId!,
      dueDate: parsed.data.dueDate,
    })
    res.status(201).json({ project })
  } catch (e) { next(e) }
})

// 更新
router.patch('/:projectId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权修改项目')
    }
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    projectRepo.update(project.id, parsed.data as any)
    res.json({ project: projectRepo.findById(project.id)! })
  } catch (e) { next(e) }
})

// 添加成员
router.post('/:projectId/members', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理成员')
    }
    const schema = z.object({ userId: z.string(), role: z.enum(['owner', 'editor', 'viewer']).optional().default('editor') })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    if (!userRepo.findById(parsed.data.userId)) throw new ApiError(404, '用户不存在')
    projectRepo.addMember(project.id, parsed.data.userId, parsed.data.role as MemberRole)
    res.json({ members: projectRepo.members(project.id) })
  } catch (e) { next(e) }
})

// 修改成员角色
router.patch('/:projectId/members/:userId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理成员')
    }
    const schema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    projectRepo.updateMemberRole(project.id, req.params.userId, parsed.data.role as MemberRole)
    res.json({ members: projectRepo.members(project.id) })
  } catch (e) { next(e) }
})

// 移除成员
router.delete('/:projectId/members/:userId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理成员')
    }
    projectRepo.removeMember(project.id, req.params.userId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default router