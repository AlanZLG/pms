/**
 * API server entry
 */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { rateLimit } from './lib/rateLimit.ts'

import authRoutes from './routes/auth.ts'
import projectRoutes from './routes/projects.ts'
import taskRoutes from './routes/tasks.ts'
import hoursRoutes from './routes/hours.ts'
import budgetsRoutes from './routes/budgets.ts'
import expensesRoutes from './routes/expenses.ts'
import statsRoutes from './routes/stats.ts'
import teamRoutes from './routes/team.ts'
import rolesRoutes from './routes/roles.ts'
import { router as notificationRoutes } from './routes/notifications.ts'
import templateRoutes from './routes/templates.ts'
import { router as attachmentRoutes } from './routes/attachments.ts'
import { router as exportRoutes } from './routes/export.ts'
import feishuRoutes from './routes/feishu.ts'
import backupRoutes from './routes/backup.ts'
import { router as opLogRoutes } from './routes/opLogs.ts'

dotenv.config()

const app: express.Application = express()

app.set('trust proxy', true)

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 通知长轮询单独限流（不计入全局配额，避免 429 后死循环）
app.use('/api/notifications/poll', rateLimit(60_000, 60, 'poll'))
// 全局限流（排除 poll 路径，由上面的专用限流处理）
app.use((req, res, next) => {
  if (req.path === '/api/notifications/poll') return next()
  next()
}, rateLimit(60_000, 300, 'api'))

// 触发数据库初始化
import './db.ts'

/**
 * health(无需鉴权)
 */
app.use('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'ok' })
})

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api', taskRoutes)
app.use('/api', hoursRoutes)
app.use('/api', budgetsRoutes)
app.use('/api', expensesRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/team', teamRoutes)
app.use('/api/roles', rolesRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/templates', templateRoutes)
app.use('/api/attachments', attachmentRoutes)
app.use('/api/export', exportRoutes)
app.use('/api/feishu', feishuRoutes)
app.use('/api', backupRoutes)
app.use('/api', opLogRoutes)

/**
 * 统一错误处理
 */
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status || 500
  res.status(status).json({
    success: false,
    error: err?.message || '服务器内部错误',
  })
})

/**
 * 404 handler
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: '接口不存在' })
})

export default app