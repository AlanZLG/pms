// 内存限流中间件（简单滑动窗口）
import { type Request, type Response, type NextFunction } from 'express'

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function rateLimit(windowMs: number, max: number, prefix = 'global') {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${prefix}:${req.ip || req.socket.remoteAddress || 'anon'}`
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || b.resetAt < now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b) }
    const remaining = Math.max(0, max - b.count)
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(remaining))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)))
    if (b.count >= max) {
      res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)))
      return res.status(429).json({ success: false, error: '请求过于频繁,请稍后再试' })
    }
    b.count++
    next()
  }
}

// 定期清理过期 bucket（防止内存泄漏）
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k)
}, 60_000).unref?.()
