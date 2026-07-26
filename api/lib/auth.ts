// 鉴权中间件

import jwt from 'jsonwebtoken'
import { type Request, type Response, type NextFunction } from 'express'
import { ApiError } from './utils.ts'

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

// 可选鉴权:存在 token 则解析,不存在不报错
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