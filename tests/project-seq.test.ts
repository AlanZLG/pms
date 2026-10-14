// 项目序号（seq）单测：自增生成 / 插入式顺延 / 显式指定 / 软删不复用
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser } from './helpers/test-db'
import { projectRepo } from '../api/repository/repo.ts'

type CreateData = Parameters<typeof projectRepo.create>[0]

function createProject(ownerId: string, name: string, seq?: number) {
  return projectRepo.create({ name, description: '', status: 'active', ownerId, dueDate: null, ...(seq !== undefined ? { seq } : {}) } as CreateData)
}

describe('项目序号 projectRepo.seq', () => {
  beforeEach(() => {
    for (const t of ['project_activity_log', 'task_hours', 'project_budgets', 'task_history', 'saved_filters',
      'notifications', 'comments', 'subtasks', 'op_logs', 'tasks', 'project_members', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
  })

  it('创建项目自动按 1,2,3… 全局自增', () => {
    const ownerId = seedUser(db)
    const a = createProject(ownerId, 'A')
    const b = createProject(ownerId, 'B')
    const c = createProject(ownerId, 'C')
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3])
  })

  it('setSeq 前插顺延：1 号改为 3 号，中间项目整体前移，序号仍连续', () => {
    const ownerId = seedUser(db)
    const a = createProject(ownerId, 'A')
    const b = createProject(ownerId, 'B')
    const c = createProject(ownerId, 'C')
    projectRepo.setSeq(a.id, 3)
    expect(projectRepo.findById(a.id)!.seq).toBe(3)
    expect(projectRepo.findById(b.id)!.seq).toBe(1)
    expect(projectRepo.findById(c.id)!.seq).toBe(2)
  })

  it('setSeq 后移顺延：3 号改为 1 号，其余整体后移', () => {
    const ownerId = seedUser(db)
    const a = createProject(ownerId, 'A')
    const b = createProject(ownerId, 'B')
    const c = createProject(ownerId, 'C')
    projectRepo.setSeq(c.id, 1)
    expect(projectRepo.findById(c.id)!.seq).toBe(1)
    expect(projectRepo.findById(a.id)!.seq).toBe(2)
    expect(projectRepo.findById(b.id)!.seq).toBe(3)
  })

  it('目标序号超过最大值时收敛为最大序号，不产生空洞', () => {
    const ownerId = seedUser(db)
    const a = createProject(ownerId, 'A')
    createProject(ownerId, 'B')
    const seq = projectRepo.setSeq(a.id, 99)
    expect(seq).toBe(2)
    const rows = db.prepare('SELECT seq FROM projects ORDER BY seq').all() as { seq: number }[]
    expect(rows.map((r) => r.seq)).toEqual([1, 2])
  })

  it('创建时显式指定序号（导入场景）优先生效，后续自增接续', () => {
    const ownerId = seedUser(db)
    const p = createProject(ownerId, '导入项目', 7)
    expect(p.seq).toBe(7)
    const q = createProject(ownerId, '后续项目')
    expect(q.seq).toBe(8)
  })

  it('显式指定已被占用的序号报冲突', () => {
    const ownerId = seedUser(db)
    createProject(ownerId, 'A')
    expect(() => createProject(ownerId, 'B', 1)).toThrow(/已被其他项目占用/)
  })

  it('软删项目的序号不复用：删除 2 号后新项目编 4 号', () => {
    const ownerId = seedUser(db)
    createProject(ownerId, 'A')
    const b = createProject(ownerId, 'B')
    createProject(ownerId, 'C')
    projectRepo.softDelete(b.id)
    const d = createProject(ownerId, 'D')
    expect(d.seq).toBe(4)
    // 回收站外仅剩 A/C/D，序号 1/3/4（2 号随软删保留，不复用）
    const live = projectRepo.findAll().map((p) => p.seq)
    expect(live).toContain(1)
    expect(live).toContain(3)
    expect(live).toContain(4)
    expect(live).not.toContain(2)
  })
})
