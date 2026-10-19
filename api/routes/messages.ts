import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { messageRepo, userRepo, taskRepo, projectRepo, notificationRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'

export const router = Router()
router.use(authRequired)

const sendSchema = z.object({
  recipientId: z.string().min(1, '缺少收件人'),
  content: z.string().trim().min(1, '消息内容不能为空').max(2000, '消息内容不能超过 2000 字'),
  taskId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
})

// 发送站内消息：taskId 存在时以任务上下文为准（自动补全所属项目）
router.post('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const senderId = req.userId!
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const { recipientId, content } = parsed.data
    const { taskId } = parsed.data
    let { projectId } = parsed.data

    if (recipientId === senderId) throw new ApiError(400, '不能给自己发消息')
    const recipient = userRepo.findById(recipientId)
    if (!recipient) throw new ApiError(404, '收件人不存在')

    if (taskId) {
      const task = taskRepo.findById(taskId)
      if (!task) throw new ApiError(404, '关联任务不存在')
      projectId = task.projectId
    } else if (projectId) {
      if (!projectRepo.findById(projectId)) throw new ApiError(404, '关联项目不存在')
    }

    const message = messageRepo.create({ senderId, recipientId, projectId, taskId, content })

    // 联动站内通知，让收件人铃铛亮起
    const sender = userRepo.findById(senderId)!
    notificationRepo.create({
      userId: recipientId,
      type: 'system',
      title: `${sender.name} 发来站内消息`,
      body: content.slice(0, 60),
      taskId: taskId || null,
      projectId: projectId || null,
    })

    res.status(201).json({ message })
  } catch (e) { next(e) }
})

// 我的会话列表 + 未读总数
router.get('/', (req: AuthRequest, res) => {
  const userId = req.userId!
  res.json({ threads: messageRepo.threads(userId), unread: messageRepo.unreadCount(userId) })
})

// 会话消息（peerId + 上下文定位）
router.get('/thread', (req: AuthRequest, res) => {
  const userId = req.userId!
  const peerId = req.query.peerId as string
  const taskId = (req.query.taskId as string) || null
  const projectId = (req.query.projectId as string) || null
  if (!peerId) throw new ApiError(400, '缺少对方用户')
  if (!userRepo.findById(peerId)) throw new ApiError(404, '对方用户不存在')
  res.json({ messages: messageRepo.threadMessages(userId, peerId, taskId, projectId) })
})

// 标记整个会话已读（对方发给我的部分）
router.post('/thread/read', (req: AuthRequest, res) => {
  const userId = req.userId!
  const { peerId, taskId, projectId } = req.body as { peerId?: string; taskId?: string | null; projectId?: string | null }
  if (!peerId) throw new ApiError(400, '缺少对方用户')
  messageRepo.markThreadRead(userId, peerId, taskId || null, projectId || null)
  res.json({ ok: true })
})

router.get('/unread', (req: AuthRequest, res) => {
  res.json({ unread: messageRepo.unreadCount(req.userId!) })
})
