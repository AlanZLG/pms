import { describe, it, expect, beforeEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import type { Response, NextFunction } from 'express'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  const db = createTestDb()
  return { default: db }
})

import db from '../api/db.ts'
import { signToken, authRequired, authOptional, financeRequired, type AuthRequest } from '../api/lib/auth.ts'
import { userRepo } from '../api/repository/repo.ts'
import { seedUser } from './helpers/test-db'

const JWT_SECRET = process.env.JWT_SECRET || 'pm-dev-secret-change-me'

describe('改密吊销 token', () => {
  let userId: string

  beforeEach(() => {
    // 清空 users 表
    db.prepare('DELETE FROM users').run()
    userId = seedUser(db, { email: 'auth-test@pm.dev', name: '测试用户', role: 'admin' })
  })

  describe('signToken', () => {
    it('生成的 JWT 应包含 tv (token_version) 字段', () => {
      const token = signToken(userId, 'admin')
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string; tv: number }
      expect(payload.sub).toBe(userId)
      expect(payload.role).toBe('admin')
      expect(payload.tv).toBe(0)
    })

    it('改密后 signToken 生成的 token tv 应为递增后的版本号', () => {
      // 初始版本 0
      expect(userRepo.getTokenVersion(userId)).toBe(0)

      // 改密 → 版本号 +1
      userRepo.updatePassword(userId, 'newhash_placeholder')
      expect(userRepo.getTokenVersion(userId)).toBe(1)

      const token = signToken(userId, 'admin')
      const payload = jwt.verify(token, JWT_SECRET) as { tv: number }
      expect(payload.tv).toBe(1)
    })
  })

  describe('userRepo.updatePassword', () => {
    it('改密后 token_version 应自增', () => {
      const v0 = userRepo.getTokenVersion(userId)
      userRepo.updatePassword(userId, 'hash_v1')
      const v1 = userRepo.getTokenVersion(userId)
      expect(v1).toBe(v0 + 1)

      userRepo.updatePassword(userId, 'hash_v2')
      const v2 = userRepo.getTokenVersion(userId)
      expect(v2).toBe(v1 + 1)
    })

    it('未改密时 token_version 保持不变', () => {
      const v0 = userRepo.getTokenVersion(userId)
      // 更新其他字段不调用 updatePassword，版本号不变
      userRepo.updateProfile(userId, { name: '改名后' })
      const v1 = userRepo.getTokenVersion(userId)
      expect(v1).toBe(v0)
    })
  })

  describe('authRequired 中间件', () => {
    function makeReq(token?: string): AuthRequest {
      return { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as AuthRequest
    }
    function makeRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    }
    function makeNext(): NextFunction {
      return vi.fn() as unknown as NextFunction
    }

    it('无 Authorization 头应返回 401', () => {
      const req = makeReq()
      const res = makeRes()
      const next = makeNext()
      authRequired(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
    })

    it('改密前的旧 token 改密后应被拒绝 (401)', () => {
      // 1. 生成旧 token (tv=0)
      const oldToken = signToken(userId, 'admin')
      const payload = jwt.verify(oldToken, JWT_SECRET) as { tv: number }
      expect(payload.tv).toBe(0)

      // 2. 改密 → token_version 变为 1
      userRepo.updatePassword(userId, 'newhash_placeholder')
      expect(userRepo.getTokenVersion(userId)).toBe(1)

      // 3. 用旧 token 访问 → 应被拒绝
      const req = makeReq(oldToken)
      const res = makeRes()
      const next = makeNext()
      authRequired(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
    })

    it('改密后用新 signToken 生成的 token 应通过校验', () => {
      // 改密
      userRepo.updatePassword(userId, 'newhash_placeholder')

      // 用新 token 访问
      const newToken = signToken(userId, 'admin')
      const req = makeReq(newToken)
      const res = makeRes()
      const next = makeNext()
      authRequired(req, res, next)

      // 不应有错误
      expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
      expect(req.userId).toBe(userId)
    })

    it('未改密时 token 应正常通过', () => {
      const token = signToken(userId, 'admin')
      const req = makeReq(token)
      const res = makeRes()
      const next = makeNext()
      authRequired(req, res, next)
      expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
      expect(req.userId).toBe(userId)
    })

    it('篡改的 token 应被拒绝', () => {
      // 生成一个不携带 tv 的旧式 token
      const fakeToken = jwt.sign({ sub: userId, role: 'admin' }, JWT_SECRET)
      const req = makeReq(fakeToken)
      const res = makeRes()
      const next = makeNext()
      authRequired(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
    })
  })

  describe('authOptional 中间件', () => {
    function makeReq(token?: string): AuthRequest {
      return { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as AuthRequest
    }
    function makeRes() {
      return {} as Response
    }
    function makeNext(): NextFunction {
      return vi.fn() as unknown as NextFunction
    }

    it('改密后旧 token 在 authOptional 中不设置 userId', () => {
      const oldToken = signToken(userId, 'admin')
      userRepo.updatePassword(userId, 'newhash_placeholder')

      const req = makeReq(oldToken)
      const res = makeRes()
      const next = makeNext()
      authOptional(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(req.userId).toBeUndefined()
    })

    it('有效 token 在 authOptional 中设置 userId', () => {
      const token = signToken(userId, 'admin')
      const req = makeReq(token)
      const res = makeRes()
      const next = makeNext()
      authOptional(req, res, next)

      expect(req.userId).toBe(userId)
    })
  })

  describe('financeRequired 中间件', () => {
    function makeReq(token?: string): AuthRequest {
      return { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as AuthRequest
    }
    function makeRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    }
    function makeNext(): NextFunction {
      return vi.fn() as unknown as NextFunction
    }

    it('改密后旧 token 应被拒绝 (401)', () => {
      const oldToken = signToken(userId, 'admin')
      userRepo.updatePassword(userId, 'newhash_placeholder')

      const req = makeReq(oldToken)
      const res = makeRes()
      const next = makeNext()
      financeRequired(req, res, next)
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
    })

    it('有效 admin token 应通过 financeRequired', () => {
      const token = signToken(userId, 'admin')
      const req = makeReq(token)
      const res = makeRes()
      const next = makeNext()
      financeRequired(req, res, next)
      expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.any(Number) }))
      expect(req.userId).toBe(userId)
    })
  })
})
