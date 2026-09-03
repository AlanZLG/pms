import { Router, type Response, type NextFunction } from 'express'
import { notificationRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import type { Notification } from '../../shared/types.ts'

export const router = Router()
router.use(authRequired)

router.get('/poll', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sinceStr = req.query.since as string | undefined
    const timeoutSec = Math.min(Number(req.query.timeout) || 25, 30)
    const since = sinceStr ? new Date(sinceStr) : null
    const now = new Date()

    const unread = notificationRepo.unreadCount(req.userId!)
    let news: Notification[] = []
    if (since) {
      news = notificationRepo.findNewerThan(req.userId!, since)
    }

    if (news.length > 0 || !since) {
      return res.json({ hasNew: news.length > 0, notifications: news, unread, polledAt: now.toISOString() })
    }

    let waited = 0
    const interval = setInterval(() => {
      waited++
      const u = notificationRepo.unreadCount(req.userId!)
      const latest = notificationRepo.findNewerThan(req.userId!, since)
      if (latest.length > 0 || u !== unread || waited >= timeoutSec) {
        clearInterval(interval)
        if (!res.headersSent) {
          res.json({
            hasNew: latest.length > 0 || u !== unread,
            notifications: latest,
            unread: u,
            polledAt: new Date().toISOString(),
          })
        }
      }
    }, 1000)

    req.on('close', () => clearInterval(interval))
  } catch (e) { next(e) }
})

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
