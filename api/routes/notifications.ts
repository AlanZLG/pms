import { Router } from 'express'
import { notificationRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'

export const router = Router()
router.use(authRequired)

router.get('/', (req: AuthRequest, res) => {
  const userId = req.userId!
  const type = req.query.type as string | undefined
  const limit = parseInt(req.query.limit as string) || 50
  const notifications = notificationRepo.findByUser(userId, limit, type)
  const unread = notificationRepo.unreadCount(userId, type)
  res.json({ notifications, unread })
})

router.get('/unread', (req: AuthRequest, res) => {
  const userId = req.userId!
  const unread = notificationRepo.unreadCount(userId)
  res.json({ unread })
})

router.post('/:id/read', (req: AuthRequest, res) => {
  notificationRepo.markRead(req.params.id)
  res.json({ ok: true })
})

router.post('/read-all', (req: AuthRequest, res) => {
  const userId = req.userId!
  notificationRepo.markAllRead(userId)
  res.json({ ok: true })
})

router.delete('/:id', (req: AuthRequest, res) => {
  notificationRepo.delete(req.params.id)
  res.json({ ok: true })
})
