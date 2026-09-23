import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject, seedTask } from './helpers/test-db'
import { taskRepo, userRepo, taskPlannedSummary } from '../api/repository/repo.ts'
import { scopedProjectIds, resolveScope } from '../api/routes/stats.ts'
import type { User } from '../shared/types.ts'

function addMember(projectId: string, userId: string) {
  db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
    .run(genId(), projectId, userId, 'editor')
}

function user(id: string): User {
  return userRepo.findById(id)!
}

describe('统计接口权限隔离', () => {
  let adminId: string, memberId: string, outsiderId: string
  let pAdmin: string   // admin 的项目，2 个 todo
  let pMember: string  // member 参与的项目，1 个 done
  let pOther: string   // 与成员/路人无关的项目

  beforeEach(() => {
    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    adminId = seedUser(db, { email: 'scope-admin@pm.dev', name: '管理员', role: 'admin' })
    memberId = seedUser(db, { email: 'scope-member@pm.dev', name: '成员', role: 'member' })
    outsiderId = seedUser(db, { email: 'scope-out@pm.dev', name: '路人', role: 'member' })

    pAdmin = seedProject(db, adminId, { name: '管理员项目' })
    pMember = seedProject(db, adminId, { name: '成员项目' })
    pOther = seedProject(db, adminId, { name: '无关项目' })
    addMember(pMember, memberId)

    seedTask(db, pAdmin, { status: 'todo' })
    seedTask(db, pAdmin, { status: 'todo' })
    seedTask(db, pMember, { status: 'done' })
    seedTask(db, pOther, { status: 'todo' })
  })

  describe('scopedProjectIds', () => {
    it('admin 不限制（undefined）', () => {
      expect(scopedProjectIds(user(adminId))).toBeUndefined()
    })

    it('成员只能看到自己参与的项目', () => {
      expect(scopedProjectIds(user(memberId))).toEqual([pMember])
    })

    it('无任何项目的用户得到空数组（而不是全量）', () => {
      expect(scopedProjectIds(user(outsiderId))).toEqual([])
    })
  })

  describe('resolveScope 越权防护', () => {
    it('成员请求自己参与的项目 → 只统计该项目', () => {
      expect(resolveScope(user(memberId), pMember)).toEqual([pMember])
    })

    it('成员请求未参与的项目 → 空数组（越权拦截）', () => {
      expect(resolveScope(user(memberId), pAdmin)).toEqual([])
    })

    it('admin 请求任意项目 → 该项目', () => {
      expect(resolveScope(user(adminId), pOther)).toEqual([pOther])
    })
  })

  describe('taskRepo 按项目集合统计', () => {
    it('countByStatus(undefined) 统计全部任务', () => {
      const r = taskRepo.countByStatus(undefined)
      expect(r.todo).toBe(3)
      expect(r.done).toBe(1)
    })

    it('countByStatus([项目]) 只统计该项目', () => {
      const r = taskRepo.countByStatus([pAdmin])
      expect(r.todo).toBe(2)
      expect(r.done).toBe(0)
    })

    it('countByStatus([]) 返回全 0，不泄漏全量', () => {
      const r = taskRepo.countByStatus([])
      expect(r).toEqual({ todo: 0, in_progress: 0, review: 0, done: 0 })
    })

    it('trendDaily([]) 返回空趋势', () => {
      expect(taskRepo.trendDaily(14, [])).toEqual([])
    })

    it('burndown([]) 返回空燃尽', () => {
      expect(taskRepo.burndown([])).toEqual({ dates: [], ideal: [], actual: [] })
    })

    it('trendDaily/burndown([项目]) 只统计该项目', () => {
      const trend = taskRepo.trendDaily(14, [pMember])
      const totalCreated = trend.reduce((s, t) => s + t.created, 0)
      expect(totalCreated).toBe(1)

      const bd = taskRepo.burndown([pMember])
      expect(bd.dates.length).toBeGreaterThan(0)
    })
  })

  describe('taskPlannedSummary 工时报表汇总', () => {
    let pHours: string  // 工时任务项目：48h(进行中,member负责) + 24h(待办,未指派) + 10h(done,outsider负责)
    let hoursMember: string

    beforeEach(() => {
      db.prepare('DELETE FROM tasks').run()
      pHours = seedProject(db, adminId, { name: '工时项目' })
      hoursMember = seedTask(db, pHours, { status: 'in_progress', plannedHours: 48, assigneeId: memberId })
      seedTask(db, pHours, { status: 'done', plannedHours: 10, assigneeId: outsiderId })
      seedTask(db, pHours, { status: 'todo', plannedHours: 24 })
    })

    it('不限制 scope 时汇总全部计划工时（48+24+10=82），未指派单独报告（24）', () => {
      expect(taskPlannedSummary(undefined)).toEqual({ total: 82, unassigned: 24 })
    })

    it('数组 scope 只汇总可见项目', () => {
      expect(taskPlannedSummary([pHours])).toEqual({ total: 82, unassigned: 24 })
      expect(taskPlannedSummary([pAdmin])).toEqual({ total: 0, unassigned: 0 })
    })

    it('空数组 scope 返回 0，绝不回退全量', () => {
      expect(taskPlannedSummary([])).toEqual({ total: 0, unassigned: 0 })
    })

    it('按人员过滤：成员负责 48h，另有未指派 24h 提示', () => {
      expect(taskPlannedSummary([pHours], memberId)).toEqual({ total: 48, unassigned: 24 })
    })

    it('按人员过滤：未指派任务不计入任何人的 total', () => {
      expect(taskPlannedSummary([pHours], outsiderId)).toEqual({ total: 10, unassigned: 24 })
    })

    it('软删除任务的计划工时不参与汇总', () => {
      db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), hoursMember)
      expect(taskPlannedSummary([pHours], memberId).total).toBe(0)
      expect(taskPlannedSummary([pHours])).toEqual({ total: 34, unassigned: 24 })
    })
  })
})
