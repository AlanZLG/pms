import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject } from './helpers/test-db'
import { userRepo } from '../api/repository/repo.ts'
import { assertOpLogRegisterAccess, assertOpLogDeleteAccess } from '../api/routes/opLogs.ts'
import { ApiError } from '../api/lib/utils.ts'

function addMember(projectId: string, userId: string) {
  db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
    .run(genId(), projectId, userId, 'editor')
}

function run(fn: () => void): ApiError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
  throw new Error('期望抛出 ApiError，但未抛出')
}

describe('台账写入权限（v1.9.3：登记须项目负责人/成员，删除仅项目负责人，admin 全权）', () => {
  let adminId: string, ownerId: string, memberId: string, outsiderId: string, guestId: string
  let pA: string // ownerId 负责的项目，memberId 是成员
  let pB: string // 与 memberId/outsiderId 无关的项目

  beforeEach(() => {
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    adminId = seedUser(db, { email: 'ow-a@pm.dev', name: '管理员', role: 'admin' })
    ownerId = seedUser(db, { email: 'ow-o@pm.dev', name: '负责人', role: 'member' })
    memberId = seedUser(db, { email: 'ow-m@pm.dev', name: '成员', role: 'member' })
    outsiderId = seedUser(db, { email: 'ow-x@pm.dev', name: '路人', role: 'member' })
    guestId = seedUser(db, { email: 'ow-g@pm.dev', name: '访客', role: 'guest' })

    pA = seedProject(db, ownerId, { name: '项目A' })
    pB = seedProject(db, adminId, { name: '项目B' })
    addMember(pA, memberId)
  })

  describe('登记守卫 assertOpLogRegisterAccess', () => {
    it('项目负责人：可登记自己负责的项目', () => {
      expect(() => assertOpLogRegisterAccess(userRepo.findById(ownerId), pA)).not.toThrow()
    })

    it('项目成员：可登记所属项目', () => {
      expect(() => assertOpLogRegisterAccess(userRepo.findById(memberId), pA)).not.toThrow()
    })

    it('非项目成员：登记无关项目 → 403', () => {
      const e = run(() => assertOpLogRegisterAccess(userRepo.findById(memberId), pB))
      expect(e.status).toBe(403)
      expect(e.message).toBe('只有该项目的负责人或成员才能登记台账')
    })

    it('路人：登记任何非自己项目 → 403', () => {
      expect(run(() => assertOpLogRegisterAccess(userRepo.findById(outsiderId), pA)).status).toBe(403)
      expect(run(() => assertOpLogRegisterAccess(userRepo.findById(outsiderId), pB)).status).toBe(403)
    })

    it('guest：即使加入了项目也无登记资格 → 403', () => {
      addMember(pA, guestId)
      const e = run(() => assertOpLogRegisterAccess(userRepo.findById(guestId), pA))
      expect(e.status).toBe(403)
      expect(e.message).toBe('访客无权登记台账')
    })

    it('admin：任何项目均可登记（全权例外）', () => {
      expect(() => assertOpLogRegisterAccess(userRepo.findById(adminId), pA)).not.toThrow()
      expect(() => assertOpLogRegisterAccess(userRepo.findById(adminId), pB)).not.toThrow()
    })

    it('无项目归属（历史遗留）：非 admin → 403', () => {
      const e = run(() => assertOpLogRegisterAccess(userRepo.findById(memberId), null))
      expect(e.status).toBe(403)
      expect(e.message).toBe('无项目归属的历史台账仅管理员可操作')
    })

    it('未登录 → 401', () => {
      expect(run(() => assertOpLogRegisterAccess(undefined, pA)).status).toBe(401)
    })
  })

  describe('删除守卫 assertOpLogDeleteAccess', () => {
    it('项目负责人：可删除自己项目的台账', () => {
      expect(() => assertOpLogDeleteAccess(userRepo.findById(ownerId), pA)).not.toThrow()
    })

    it('项目成员：不可删除（即使能登记）→ 403', () => {
      const e = run(() => assertOpLogDeleteAccess(userRepo.findById(memberId), pA))
      expect(e.status).toBe(403)
      expect(e.message).toBe('只有项目负责人才能删除台账')
    })

    it('非成员：删除 → 403', () => {
      expect(run(() => assertOpLogDeleteAccess(userRepo.findById(outsiderId), pA)).status).toBe(403)
    })

    it('admin：任何台账均可删除（全权例外）', () => {
      expect(() => assertOpLogDeleteAccess(userRepo.findById(adminId), pA)).not.toThrow()
    })

    it('无项目归属（历史遗留）：非 admin → 403，admin 放行', () => {
      expect(run(() => assertOpLogDeleteAccess(userRepo.findById(ownerId), null)).status).toBe(403)
      expect(() => assertOpLogDeleteAccess(userRepo.findById(adminId), null)).not.toThrow()
    })

    it('未登录 → 401', () => {
      expect(run(() => assertOpLogDeleteAccess(undefined, pA)).status).toBe(401)
    })
  })
})
