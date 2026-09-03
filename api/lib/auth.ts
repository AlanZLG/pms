// 鉴权中间件

import jwt from 'jsonwebtoken'
import { type Request, type Response, type NextFunction } from 'express'
import { ApiError } from './utils.ts'
import { userRepo, rolePermissionRepo } from '../repository/repo.ts'

const JWT_SECRET = process.env.JWT_SECRET || 'pm-dev-secret-change-me'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
}

export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: '7d' })
}

export function authRequired(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return next(new ApiError(401, '未登录或登录已过期'))
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string }
    req.userId = payload.sub
    req.userRole = payload.role
    next()
  } catch {
    next(new ApiError(401, '登录凭证无效'))
  }
}

export function authOptional(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return next()
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string }
    req.userId = payload.sub
    req.userRole = payload.role
  } catch {
    // 忽略
  }
  next()
}

export function financeRequired(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return next(new ApiError(401, '未登录或登录已过期'))
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string }
    req.userId = payload.sub
    req.userRole = payload.role
    if (payload.role !== 'admin' && payload.role !== 'finance') {
      return next(new ApiError(403, '仅管理员或财务人员可访问'))
    }
    next()
  } catch {
    next(new ApiError(401, '登录凭证无效'))
  }
}

// 检查用户是否有特定权限
export function requirePermission(permissionKey: string) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.userId) {
      return next(new ApiError(401, '未登录'))
    }

    const user = userRepo.findById(req.userId)
    if (!user) {
      return next(new ApiError(401, '用户不存在'))
    }

    // 管理员拥有所有权限
    if (user.role === 'admin') {
      return next()
    }

    // 检查权限
    const hasPermission = rolePermissionRepo.userHasPermission(req.userId, permissionKey)
    if (hasPermission) {
      return next()
    }

    return next(new ApiError(403, '权限不足'))
  }
}
