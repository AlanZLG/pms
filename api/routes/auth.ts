// 认证路由

import { Router, type Request, type Response, type NextFunction } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { userRepo } from '../repository/repo.ts'
import { signToken, authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError, genId } from '../lib/utils.ts'

const router = Router()

const palette = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899']

const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少 6 位'),
  name: z.string().min(1, '昵称不能为空').max(40),
})

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const { email, password, name } = parsed.data
    if (userRepo.findByEmail(email)) throw new ApiError(409, '该邮箱已被注册')
    // 首位用户自动为管理员
    const isFirst = userRepo.findAll().length === 0
    const hash = bcrypt.hashSync(password, 10)
    const color = palette[Math.floor(Math.random() * palette.length)]
    const user = userRepo.create({
      email, passwordHash: hash, name, avatarColor: color,
      role: isFirst ? 'admin' : 'member',
    })
    const token = signToken(user.id, user.role)
    res.status(201).json({ token, user })
  } catch (e) { next(e) }
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, '邮箱或密码错误')
    const { email, password } = parsed.data
    const userRow = userRepo.findByEmail(email)
    if (!userRow) throw new ApiError(401, '邮箱或密码错误')
    const { default: db } = await import('../db.ts')
    const raw = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userRow.id) as { password_hash: string }
    if (!bcrypt.compareSync(password, raw.password_hash)) throw new ApiError(401, '邮箱或密码错误')
    const token = signToken(userRow.id, userRow.role)
    res.json({ token, user: userRow })
  } catch (e) { next(e) }
})

router.get('/me', authRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user) throw new ApiError(404, '用户不存在')
    res.json({ user })
  } catch (e) { next(e) }
})

export default router