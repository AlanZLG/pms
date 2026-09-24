import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject, seedOpLog } from './helpers/test-db'
import { opLogRepo, userRepo } from '../api/repository/repo.ts'
import { scopedProjectIds } from '../api/routes/stats.ts'
import { scopeToProjectIds } from '../api/routes/opLogs.ts'

function addMember(projectId: string, userId: string) {
  db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
    .run(genId(), projectId, userId, 'editor')
}

describe('台账数据作用域（v1.9.2：内部成员全局可见，仅 guest 受限）', () => {
  let adminId: string, memberId: string, outsiderId: string, guestId: string
  let pMember: string   // member 参与的项目
  let pOther: string    // 与 member/outsider 无关的项目
  let logMember: string, logOther: string, logNoProject: string

  beforeEach(() => {
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    adminId = seedUser(db, { email: 'olog-admin@pm.dev', name: '管理员', role: 'admin' })
    memberId = seedUser(db, { email: 'olog-member@pm.dev', name: '成员', role: 'member' })
    outsiderId = seedUser(db, { email: 'olog-out@pm.dev', name: '路人', role: 'member' })
    guestId = seedUser(db, { email: 'olog-guest@pm.dev', name: '访客', role: 'guest' })

    pMember = seedProject(db, adminId, { name: '成员项目' })
    pOther = seedProject(db, adminId, { name: '无关项目' })
    addMember(pMember, memberId)

    logMember = seedOpLog(db, adminId, { projectId: pMember, problem: '成员项目里的故障', status: '已完成' })
    logOther = seedOpLog(db, adminId, { projectId: pOther, problem: '无关项目里的故障', status: '已完成' })
    logNoProject = seedOpLog(db, adminId, { problem: '无项目归属的故障', status: '已完成' })
  })

  describe('scopeToProjectIds（作用域换算）', () => {
    it('admin（scope undefined）不限制', () => {
      expect(scopeToProjectIds(undefined)).toBeUndefined()
      expect(scopeToProjectIds(undefined, pOther)).toBeUndefined()
    })

    it('显式项目在范围内 → 限定单项目；不在范围 → null（空集，防越权枚举）', () => {
      const scope = [pMember]
      expect(scopeToProjectIds(scope, pMember)).toEqual([pMember])
      expect(scopeToProjectIds(scope, pOther)).toBeNull()
    })

    it('未显式筛选 → 返回可见项目集合本身', () => {
      expect(scopeToProjectIds([pMember])).toEqual([pMember])
      expect(scopeToProjectIds([])).toEqual([])
    })
  })

  describe('repo 层 projectIds 过滤', () => {
    it('find：非空集合只返回集合内项目的台账', () => {
      const ids = opLogRepo.find({ projectIds: [pMember] }).map((l) => l.id)
      expect(ids).toEqual([logMember])
    })

    it('find：空集合与 null 都返回空（无可见项目/越权显式查询）', () => {
      expect(opLogRepo.find({ projectIds: [] })).toEqual([])
      expect(opLogRepo.find({ projectIds: null })).toEqual([])
    })

    it('find：undefined 不限制（admin 全量）', () => {
      expect(opLogRepo.find({ projectIds: undefined }).length).toBe(3)
    })

    it('find：显式 projectId 与 projectIds 叠加生效（admin 限定 + 筛选）', () => {
      const ids = opLogRepo.find({ projectId: pOther, projectIds: [pMember, pOther] }).map((l) => l.id)
      expect(ids).toEqual([logOther])
    })

    it('stats：集合外台账不计入统计，空集合返回空数组', () => {
      const rows = opLogRepo.stats({ projectIds: [pMember] })
      expect(rows.length).toBe(1)
      expect(rows[0].count).toBe(1)
      expect(opLogRepo.stats({ projectIds: null })).toEqual([])
    })

    it('distinct：筛选选项只来自可见项目', () => {
      db.prepare('UPDATE op_logs SET system = ? WHERE id = ?').run('成员系统', logMember)
      db.prepare('UPDATE op_logs SET system = ? WHERE id = ?').run('无关系统', logOther)
      db.prepare('UPDATE op_logs SET system = ? WHERE id = ?').run('无项目系统', logNoProject)
      expect(opLogRepo.distinct('system', undefined, [pMember])).toEqual(['成员系统'])
      expect(opLogRepo.distinct('system', undefined, [])).toEqual([])
      expect(opLogRepo.distinct('system', undefined, undefined).length).toBe(3)
    })
  })

  describe('与 scopedProjectIds 的组合（模拟路由行为）', () => {
    it('内部成员（member）：不限制，可见全部台账（含无项目归属）', () => {
      const scope = scopedProjectIds(userRepo.findById(memberId))
      expect(scope).toBeUndefined()
      expect(opLogRepo.find({ projectIds: scopeToProjectIds(scope) }).length).toBe(3)
    })

    it('内部成员：显式查询任意项目 → 限定该项目', () => {
      const scope = scopedProjectIds(userRepo.findById(memberId))
      // 与路由一致：显式项目筛选由独立 projectId 参数承载
      const ids = opLogRepo.find({ projectId: pOther, projectIds: scopeToProjectIds(scope, pOther) }).map((l) => l.id)
      expect(ids).toEqual([logOther])
    })

    it('admin：不限制，含无项目归属台账', () => {
      const scope = scopedProjectIds(userRepo.findById(adminId))
      expect(opLogRepo.find({ projectIds: scopeToProjectIds(scope) }).length).toBe(3)
    })

    it('无任何项目的内部成员：列表为全量而不是空', () => {
      const scope = scopedProjectIds(userRepo.findById(outsiderId))
      expect(scope).toBeUndefined()
      expect(opLogRepo.find({ projectIds: scopeToProjectIds(scope) }).length).toBe(3)
    })

    it('guest（未参与项目）：列表为空而不是全量', () => {
      const scope = scopedProjectIds(userRepo.findById(guestId))
      expect(scope).toEqual([])
      expect(opLogRepo.find({ projectIds: scopeToProjectIds(scope) })).toEqual([])
    })

    it('guest（参与项目）：只见参与项目的台账', () => {
      addMember(pMember, guestId)
      const scope = scopedProjectIds(userRepo.findById(guestId))
      const ids = opLogRepo.find({ projectIds: scopeToProjectIds(scope) }).map((l) => l.id)
      expect(ids).toEqual([logMember])
    })

    it('guest：显式查询未参与的项目 → 空集（防越权枚举）', () => {
      addMember(pMember, guestId)
      const scope = scopedProjectIds(userRepo.findById(guestId))
      expect(opLogRepo.find({ projectIds: scopeToProjectIds(scope, pOther) })).toEqual([])
    })
  })
})
