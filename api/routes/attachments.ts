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
    const file = (req as any).file
    if (!file) throw new ApiError(400, '请选择文件')

    const attachment = attachmentRepo.create({
      taskId: task.id,
      userId: req.userId!,
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    })
    res.status(201).json({ attachment })
  } catch (e) { next(e) }
})

router.get('/tasks/:taskId', (req: AuthRequest, res: Response) => {
  const attachments = attachmentRepo.findByTask(req.params.taskId)
  res.json({ attachments })
})

router.get('/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const att = attachmentRepo.findById(req.params.id)
    if (!att) throw new ApiError(404, '附件不存在')
    const filePath = path.join(UPLOAD_DIR, att.filename)
    if (!fs.existsSync(filePath)) throw new ApiError(404, '文件已丢失')
    res.download(filePath, att.originalName)
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