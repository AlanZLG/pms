import { Router } from 'express'
import { notificationRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'

export const router = Router()
router.use(authRequired)

// 获取当前用户通知
router.get('/', (req: AuthRequest, res) => {
  const userId = req.userId!
  const notifications = notificationRepo.findByUser(userId, 100)
  const unread = notificationRepo.unreadCount(userId)
  res.json({ notifications, unread })
})

// 未读数量
router.get('/unread', (req: AuthRequest, res) => {
  const userId = req.userId!
  const unread = notificationRepo.unreadCount(userId)
  res.json({ unread })
})

// 标记单条已读
router.post('/:id/read', (req: AuthRequest, res) => {
  notificationRepo.markRead(req.params.id)
  res.json({ ok: true })
})

// 全部已读
router.post('/read-all', (req: AuthRequest, res) => {
  const userId = req.userId!
  notificationRepo.markAllRead(userId)
  res.json({ ok: true })
})
