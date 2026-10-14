import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject } from './helpers/test-db'
import { opLogRepo } from '../api/repository/repo.ts'
import { completionMissing } from '../api/routes/opLogs.ts'

describe('台账状态扩展：暂停/取消（v1.11）', () => {
  let userId: string, pid: string

  beforeEach(() => {
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    userId = seedUser(db, { email: 'seq@pm.dev', name: '序号测试' })
    pid = seedProject(db, userId, { name: '序号项目' })
  })

  it('新状态「暂停」「取消」可通过 CHECK 约束落库', () => {
    const a = opLogRepo.create(userId, { projectId: pid, status: '暂停', problem: '缓存抖动' })
    const b = opLogRepo.create(userId, { projectId: pid, status: '取消', problem: '重复工单' })
    expect(a.status).toBe('暂停')
    expect(b.status).toBe('取消')
  })

  it('暂停/取消不要求经验三字段（仅已完成要求）', () => {
    expect(completionMissing({ status: '暂停' })).toEqual([])
    expect(completionMissing({ status: '取消' })).toEqual([])
    expect(completionMissing({ status: '已完成' })).toEqual(['详细描述', '原因', '解决方案'])
  })
})

describe('台账序号 seq（项目内自增，第 1 列）', () => {
  let userId: string, pidA: string, pidB: string

  beforeEach(() => {
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    userId = seedUser(db, { email: 'seq@pm.dev', name: '序号测试' })
    pidA = seedProject(db, userId, { name: '项目A' })
    pidB = seedProject(db, userId, { name: '项目B' })
  })

  it('同一项目内自增：1,2,3', () => {
    const l1 = opLogRepo.create(userId, { projectId: pidA, problem: '第一条' })
    const l2 = opLogRepo.create(userId, { projectId: pidA, problem: '第二条' })
    const l3 = opLogRepo.create(userId, { projectId: pidA, problem: '第三条' })
    expect([l1.seq, l2.seq, l3.seq]).toEqual([1, 2, 3])
  })

  it('不同项目序号独立', () => {
    const a = opLogRepo.create(userId, { projectId: pidA, problem: 'A1' })
    const b = opLogRepo.create(userId, { projectId: pidB, problem: 'B1' })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(1)
  })

  it('软删后序号不复用（含软删行取 MAX）', () => {
    const l1 = opLogRepo.create(userId, { projectId: pidA, problem: '被删的' })
    opLogRepo.softDelete(l1.id)
    const l2 = opLogRepo.create(userId, { projectId: pidA, problem: '新的' })
    expect(l1.seq).toBe(1)
    expect(l2.seq).toBe(2)
  })

  it('导入指定序号：按文件值落库', () => {
    const l = opLogRepo.create(userId, { projectId: pidA, seq: 42, problem: '导入行' })
    expect(l.seq).toBe(42)
  })

  it('未指定序号时在指定序号基础上继续自增', () => {
    opLogRepo.create(userId, { projectId: pidA, seq: 10, problem: '指定10' })
    const next = opLogRepo.create(userId, { projectId: pidA, problem: '自动11' })
    expect(next.seq).toBe(11)
  })
})
