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

import authRoutes from './routes/auth.ts'
import projectRoutes from './routes/projects.ts'
import taskRoutes from './routes/tasks.ts'
import statsRoutes from './routes/stats.ts'
import teamRoutes from './routes/team.ts'

dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

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
app.use('/api/stats', statsRoutes)
app.use('/api/team', teamRoutes)

/**
 * 统一错误处理
 */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
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