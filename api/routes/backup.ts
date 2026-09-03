import { Router, type Response, type NextFunction } from 'express'
import fs from 'fs'
import path from 'path'
import { authRequired, financeRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import { dbSizeInfo, checkpoint, vacuum } from '../db.ts'

const router = Router()
router.use(authRequired)

const DB_PATH = path.resolve(process.cwd(), 'data/app.db')
const BACKUP_DIR = path.resolve(process.cwd(), 'data/backups')

router.get('/backup', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new ApiError(401, '未授权')
    if (!fs.existsSync(DB_PATH)) throw new ApiError(404, '数据库文件不存在')
    const stat = fs.statSync(DB_PATH)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="atlas-backup-${timestamp}.db"`)
    res.setHeader('Content-Length', stat.size)
    const stream = fs.createReadStream(DB_PATH)
    stream.pipe(res)
    stream.on('error', next)
  } catch (e) { next(e) }
})

router.post('/backup', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new ApiError(401, '未授权')

    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const tempPath = path.join(BACKUP_DIR, `restore-${timestamp}.db`)

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))

    req.on('end', () => {
      const buffer = Buffer.concat(chunks)
      if (buffer.length === 0) {
        next(new ApiError(400, '上传文件为空'))
        return
      }
      try {
        fs.writeFileSync(tempPath, buffer)
        fs.copyFileSync(tempPath, DB_PATH)
        try { fs.unlinkSync(tempPath) } catch {
          // 临时文件可能不存在，忽略清理错误
        }
        res.json({ ok: true, message: '数据库已恢复,请重启服务以生效' })
      } catch (err) {
        next(new ApiError(500, '恢复失败: ' + (err as Error).message))
      }
    })

    req.on('error', () => {
      try { fs.unlinkSync(tempPath) } catch {
        // 临时文件可能不存在，忽略清理错误
      }
      next(new ApiError(400, '上传失败'))
    })
  } catch (e) { next(e) }
})

router.get('/backup/info', (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!fs.existsSync(DB_PATH)) throw new ApiError(404, '数据库文件不存在')
    const stat = fs.statSync(DB_PATH)
    const sizeKB = Math.round(stat.size / 1024)
    res.json({
      sizeBytes: stat.size,
      sizeKB,
      modifiedAt: stat.mtime.toISOString(),
      exists: true,
    })
  } catch (e) { next(e) }
})

router.get('/db-maintenance/info', (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(dbSizeInfo())
  } catch (e) { next(e) }
})

router.post('/db-maintenance/checkpoint', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.userRole !== 'admin') {
      return next(new ApiError(403, '仅管理员可执行 FULL checkpoint'))
    }
    const ok = checkpoint('FULL')
    res.json({ ok })
  } catch (e) { next(e) }
})

router.post('/db-maintenance/vacuum', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.userRole !== 'admin') {
      return next(new ApiError(403, '仅管理员可执行 VACUUM'))
    }
    const ok = vacuum()
    res.json({ ok })
  } catch (e) { next(e) }
})

export default router
