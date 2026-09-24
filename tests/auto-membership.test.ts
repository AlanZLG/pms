import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject } from './helpers/test-db'
import { projectRepo } from '../api/repository/repo.ts'
import { ensureAssigneeMembership } from '../api/routes/tasks.ts'

describe('指派自动入会（v1.9.3）：被指派任务即成为项目成员', () => {
  let projectId: string, outsiderId: string, memberId: string, guestId: string

  beforeEach(() => {
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    const ownerId = seedUser(db, { email: 'am-o@pm.dev', name: '负责人', role: 'member' })
    guestId = seedUser(db, { email: 'am-g@pm.dev', name: '访客', role: 'guest' })
    outsiderId = seedUser(db, { email: 'am-x@pm.dev', name: '圈外人', role: 'member' })
    projectId = seedProject(db, ownerId, { name: '自动入会项目' })
    memberId = seedUser(db, { email: 'am-m@pm.dev', name: '老成员', role: 'member' })
    projectRepo.addMember(projectId, memberId, 'editor')
  })

  it('非成员被指派 → 自动加入为 editor，可访问项目', () => {
    expect(projectRepo.members(projectId).some((m) => m.userId === outsiderId)).toBe(false)
    ensureAssigneeMembership(projectId, outsiderId)
    const m = projectRepo.members(projectId).find((x) => x.userId === outsiderId)
    expect(m?.role).toBe('editor')
  })

  it('已是成员 → 重复指派不重复加入、角色不变', () => {
    ensureAssigneeMembership(projectId, memberId)
    const list = projectRepo.members(projectId).filter((m) => m.userId === memberId)
    expect(list.length).toBe(1)
    expect(list[0].role).toBe('editor')
  })

  it('guest 被指派 → 不入会（保持访客只读语义）', () => {
    ensureAssigneeMembership(projectId, guestId)
    expect(projectRepo.members(projectId).some((m) => m.userId === guestId)).toBe(false)
  })

  it('未指派（null/undefined）→ 不做任何事', () => {
    ensureAssigneeMembership(projectId, null)
    ensureAssigneeMembership(projectId, undefined)
    expect(projectRepo.members(projectId).length).toBe(1)
  })

  it('不存在的用户 → 安全跳过', () => {
    expect(() => ensureAssigneeMembership(projectId, 'no-such-user')).not.toThrow()
  })
})
