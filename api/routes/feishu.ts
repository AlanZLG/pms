import { Router } from 'express'
import { authRequired, type AuthRequest } from '../lib/auth.js'
import { userRepo } from '../repository/repo.js'
import { getAuthUrl, exchangeCodeForUser, getConfig } from '../lib/feishu.js'

const router = Router()

router.get('/bind', authRequired, (req: AuthRequest, res) => {
  const cfg = getConfig()
  if (!cfg.configured) {
    return res.status(400).json({ error: '飞书未配置' })
  }
  const authUrl = getAuthUrl(String(req.userId))
  res.json({ authUrl })
})

router.get('/callback', authRequired, async (req: AuthRequest, res) => {
  const { code, state } = req.query
  const userId = req.userId

  if (state && state !== userId) {
    return res.status(400).json({ error: '状态校验失败' })
  }
  if (!code) {
    return res.status(400).json({ error: '缺少授权码' })
  }

  const feishuUser = await exchangeCodeForUser(String(code))
  if (!feishuUser) {
    return res.status(500).json({ error: '飞书授权失败' })
  }

  userRepo.bindFeishu(userId, feishuUser.openId, feishuUser.unionId)
  res.json({ success: true, openId: feishuUser.openId, name: feishuUser.name })
})

router.post('/unbind', authRequired, (req: AuthRequest, res) => {
  userRepo.unbindFeishu(req.userId)
  res.json({ success: true })
})

router.get('/status', authRequired, (req: AuthRequest, res) => {
  const user = userRepo.findById(req.userId)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  res.json({
    bound: !!(user.feishuOpenId),
    feishuName: user.name,
    openId: user.feishuOpenId,
    boundAt: user.feishuBoundAt,
    configured: getConfig().configured,
  })
})

export default router