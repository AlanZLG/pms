// 角色管理路由

import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { customRoleRepo, permissionRepo, rolePermissionRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'

const router = Router()
router.use(authRequired)

// 获取所有角色（系统+自定义）
router.get('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roles = customRoleRepo.findAll()
    res.json({ roles })
  } catch (e) {
    next(e)
  }
})

// 获取角色详情（含权限列表）
router.get('/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = customRoleRepo.findByIdWithPermissions(req.params.id)
    if (!role) {
      throw new ApiError(404, '角色不存在')
    }
    res.json({ role })
  } catch (e) {
    next(e)
  }
})

// 创建自定义角色（仅管理员）
router.post('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = req.userRole
    if (current !== 'admin') {
      throw new ApiError(403, '仅管理员可创建角色')
    }

    const schema = z.object({
      name: z.string().min(1).max(50),
      description: z.string().optional(),
      permissionIds: z.array(z.string()).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0].message)
    }

    // 检查名称是否已存在
    const existing = customRoleRepo.findByName(parsed.data.name)
    if (existing) {
      throw new ApiError(400, '角色名称已存在')
    }

    // 创建角色
    const role = customRoleRepo.create({
      name: parsed.data.name,
      description: parsed.data.description,
      createdBy: req.userId,
    })

    // 设置权限
    if (parsed.data.permissionIds && parsed.data.permissionIds.length > 0) {
      rolePermissionRepo.setPermissions(role.id, parsed.data.permissionIds)
    }

    // 返回带权限的角色
    const roleWithPerms = customRoleRepo.findByIdWithPermissions(role.id)
    res.status(201).json({ role: roleWithPerms })
  } catch (e) {
    next(e)
  }
})

// 更新自定义角色（仅管理员）
router.patch('/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = req.userRole
    if (current !== 'admin') {
      throw new ApiError(403, '仅管理员可修改角色')
    }

    const role = customRoleRepo.findById(req.params.id)
    if (!role) {
      throw new ApiError(404, '角色不存在')
    }

    const schema = z.object({
      name: z.string().min(1).max(50).optional(),
      description: z.string().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0].message)
    }

    // 检查名称是否与其他角色冲突
    if (parsed.data.name) {
      const existing = customRoleRepo.findByName(parsed.data.name)
      if (existing && existing.id !== req.params.id) {
        throw new ApiError(400, '角色名称已存在')
      }
    }

    customRoleRepo.update(req.params.id, parsed.data)
    const updated = customRoleRepo.findByIdWithPermissions(req.params.id)
    res.json({ role: updated })
  } catch (e) {
    next(e)
  }
})

// 删除自定义角色（仅管理员，系统角色不可删）
router.delete('/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = req.userRole
    if (current !== 'admin') {
      throw new ApiError(403, '仅管理员可删除角色')
    }

    const role = customRoleRepo.findById(req.params.id)
    if (!role) {
      throw new ApiError(404, '角色不存在')
    }

    if (role.isSystem) {
      throw new ApiError(400, '系统角色不可删除')
    }

    customRoleRepo.delete(req.params.id)
    res.json({ success: true })
  } catch (e) {
    next(e)
  }
})

// 获取所有权限定义（按分类分组）
router.get('/permissions/list', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const categories = permissionRepo.findByCategory()
    res.json({ categories })
  } catch (e) {
    next(e)
  }
})

// 更新角色权限（仅管理员，批量设置权限）
router.post('/:id/permissions', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = req.userRole
    if (current !== 'admin') {
      throw new ApiError(403, '仅管理员可修改权限')
    }

    const role = customRoleRepo.findById(req.params.id)
    if (!role) {
      throw new ApiError(404, '角色不存在')
    }

    const schema = z.object({
      permissionIds: z.array(z.string()),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0].message)
    }

    rolePermissionRepo.setPermissions(req.params.id, parsed.data.permissionIds)
    const updated = customRoleRepo.findByIdWithPermissions(req.params.id)
    res.json({ role: updated })
  } catch (e) {
    next(e)
  }
})

export default router