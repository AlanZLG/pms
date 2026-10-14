// 操作审计查询（仅管理员）：按账号/模块/动作/时间/关键词检索全量操作轨迹

import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import { auditRepo } from '../repository/audit.ts'

export const router = Router()

router.use(authRequired)

// 管理员专属
router.use((req: AuthRequest, _res: Response, next: NextFunction) => {
  if (req.userRole !== 'admin') return next(new ApiError(403, '仅管理员可查看操作日志'))
  next()
})

const querySchema = z.object({
  userId: z.string().trim().optional(),
  module: z.string().trim().max(30).optional(),
  action: z.string().trim().max(30).optional(),
  keyword: z.string().trim().max(100).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

router.get('/', (req: AuthRequest, res: Response) => {
  const q = querySchema.parse(req.query)
  res.json(auditRepo.query({
    userId: q.userId,
    module: q.module,
    action: q.action,
    keyword: q.keyword,
    dateFrom: q.dateFrom ? `${q.dateFrom}T00:00:00.000Z` : undefined,
    dateTo: q.dateTo ? `${q.dateTo}T23:59:59.999Z` : undefined,
    page: q.page,
    pageSize: q.pageSize,
  }))
})

// 近 30 天按模块聚合（分类概览）
router.get('/stats', (_req: AuthRequest, res: Response) => {
  res.json({ rows: auditRepo.stats(30) })
})
