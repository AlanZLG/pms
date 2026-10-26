import { Router, type Response, type NextFunction } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { attachmentRepo, taskRepo, userRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'

export const router = Router()
router.use(authRequired)

/**
 * 修复 multer/busboy 按 latin1 解码 multipart filename 导致的中文乱码。
 * 浏览器以 UTF-8 发送文件名，busboy（defParamCharset 默认 latin1）把每个 UTF-8 字节
 * 当成 latin1 字符，如「文本」→「ææ¬」。修复：若文件名全部落在 latin1 可表示范围，
 * 先按 latin1 还原原始字节再按 UTF-8 解码；转换结果含 U+FFFD 替换符则视为非 UTF-8
 * 字节流（本就是 ASCII/latin1 文件名），保留原值；已含非 latin1 字符（解码已正确）不动。
 */
export function fixMojibake(name: string): string {
  // 含 latin1（U+0100）之上的字符说明解码已正确（真正的中文等），无需处理
  if (/[\u0100-\u{10FFFF}]/u.test(name)) return name
  const fixed = Buffer.from(name, 'latin1').toString('utf8')
  if (fixed !== name && !fixed.includes('\uFFFD')) return fixed
  return name
}

const UPLOAD_DIR = path.resolve(process.cwd(), 'data/uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    const id = crypto.randomUUID()
    cb(null, `${id}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
})

router.post('/tasks/:taskId', upload.single('file'), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file
    if (!file) throw new ApiError(400, '请选择文件')

    const attachment = attachmentRepo.create({
      taskId: task.id,
      userId: req.userId!,
      filename: file.filename,
      originalName: fixMojibake(file.originalname),
      size: file.size,
      mimeType: file.mimetype,
    })
    res.status(201).json({ attachment })
  } catch (e) { next(e) }
})

router.get('/tasks/:taskId', (req: AuthRequest, res: Response) => {
  const attachments = attachmentRepo.findByTask(req.params.taskId)
  // 读取兜底：历史数据中已入库的 latin1 乱码名在展示/下载时自动还原
  res.json({ attachments: attachments.map((a) => ({ ...a, originalName: fixMojibake(a.originalName) })) })
})

router.get('/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const att = attachmentRepo.findById(req.params.id)
    if (!att) throw new ApiError(404, '附件不存在')
    const filePath = path.join(UPLOAD_DIR, att.filename)
    if (!fs.existsSync(filePath)) throw new ApiError(404, '文件已丢失')
    res.download(filePath, fixMojibake(att.originalName))
  } catch (e) { next(e) }
})

router.delete('/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const att = attachmentRepo.findById(req.params.id)
    if (!att) throw new ApiError(404, '附件不存在')
    if (att.userId !== req.userId) {
      const user = userRepo.findById(req.userId!)
      if (user?.role !== 'admin' && user?.role !== 'owner') {
        throw new ApiError(403, '无权删除该附件')
      }
    }
    const filePath = path.join(UPLOAD_DIR, att.filename)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    attachmentRepo.delete(att.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})