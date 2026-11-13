import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject } from './helpers/test-db'
import { auditRepo, mapRequestToAudit } from '../api/repository/audit.ts'

describe('操作审计：请求 → 业务语义映射', () => {
  it('POST 新建：模块按路径首段映射', () => {
    expect(mapRequestToAudit('POST', '/api/op-logs')).toEqual({ module: 'ledger', action: 'create', targetId: null })
    expect(mapRequestToAudit('POST', '/api/projects')).toEqual({ module: 'project', action: 'create', targetId: null })
  })

  it('POST 子资源集合（/:id/tasks）：动作 create 而非子资源名', () => {
    const id = 'a1b2c3d4e5f6a7b8c9d0e1f2'
    expect(mapRequestToAudit('POST', `/api/projects/${id}/tasks`)).toEqual({ module: 'project', action: 'create', targetId: id })
  })

  it('DELETE /:id：动作 delete，对象 id 取末段', () => {
    const id = 'a1b2c3d4e5f6a7b8c9d0e1f2'
    expect(mapRequestToAudit('DELETE', `/api/op-logs/${id}`)).toEqual({ module: 'ledger', action: 'delete', targetId: id })
  })

  it('POST /:id/verb：动词子段作为动作（如任务移入回收站）', () => {
    const id = 'a1b2c3d4e5f6a7b8c9d0e1f2'
    expect(mapRequestToAudit('POST', `/api/tasks/${id}/trash`)).toEqual({ module: 'task', action: 'trash', targetId: id })
  })

  it('PUT/PATCH 更新：动作 update，对象 id 取末段', () => {
    const id = 'a1b2c3d4e5f6a7b8c9d0e1f2'
    expect(mapRequestToAudit('PUT', `/api/projects/${id}`)).toEqual({ module: 'project', action: 'update', targetId: id })
    expect(mapRequestToAudit('PATCH', `/api/team/${id}/cost`)).toEqual({ module: 'user', action: 'update', targetId: id })
  })

  it('auth 模块：第二段即动作（login/register）', () => {
    expect(mapRequestToAudit('POST', '/api/auth/login')).toEqual({ module: 'auth', action: 'login', targetId: null })
    expect(mapRequestToAudit('POST', '/api/auth/register')).toEqual({ module: 'auth', action: 'register', targetId: null })
  })

  it('未知前缀：模块原样保留，不丢失轨迹', () => {
    expect(mapRequestToAudit('POST', '/api/something-new').module).toBe('something-new')
    expect(mapRequestToAudit('POST', '/api/something-new').action).toBe('create')
  })
})

describe('操作审计：落库与查询', () => {
  let uid: string

  beforeEach(() => {
    db.exec('DELETE FROM audit_logs')
    db.prepare('DELETE FROM project_activity_log').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    uid = seedUser(db, { email: 'aud@pm.dev', name: '审计员' })
    seedProject(db, uid, { name: '审计项目' })
  })

  it('record 落库 + query 全量取回（按时间倒序）', () => {
    auditRepo.record({ userId: uid, userName: '审计员', method: 'POST', path: '/api/op-logs', module: 'ledger', action: 'create', statusCode: 201, ip: '127.0.0.1' })
    auditRepo.record({ userId: uid, userName: '审计员', method: 'DELETE', path: '/api/tasks/x/trash', module: 'task', action: 'trash', statusCode: 200, ip: '127.0.0.1' })
    const { rows, total } = auditRepo.query({})
    expect(total).toBe(2)
    expect(rows[0].method).toBe('DELETE')
    expect(rows[0].userName).toBe('审计员')
    expect(rows[1].module).toBe('ledger')
    expect(rows[1].statusCode).toBe(201)
  })

  it('按账号 / 模块 / 动作 / 关键词过滤', () => {
    const otherId = seedUser(db, { email: 'other@pm.dev', name: '别人' })
    auditRepo.record({ userId: uid, userName: '审计员', method: 'POST', path: '/api/op-logs', module: 'ledger', action: 'create', statusCode: 201 })
    auditRepo.record({ userId: otherId, userName: '别人', method: 'DELETE', path: '/api/projects/p1', module: 'project', action: 'delete', statusCode: 200 })
    expect(auditRepo.query({ userId: uid }).total).toBe(1)
    expect(auditRepo.query({ module: 'ledger' }).total).toBe(1)
    expect(auditRepo.query({ action: 'delete' }).total).toBe(1)
    expect(auditRepo.query({ keyword: '别人' }).total).toBe(1)
    expect(auditRepo.query({ keyword: 'op-logs' }).total).toBe(1)
    expect(auditRepo.query({ keyword: '查不到' }).total).toBe(0)
  })

  it('分页：total 全量、rows 截取当前页', () => {
    for (let i = 0; i < 5; i++) {
      auditRepo.record({ userId: uid, userName: '审计员', method: 'POST', path: `/api/tasks/t${i}`, module: 'task', action: 'create', statusCode: 201 })
    }
    const page1 = auditRepo.query({ page: 1, pageSize: 2 })
    const page3 = auditRepo.query({ page: 3, pageSize: 2 })
    expect(page1.total).toBe(5)
    expect(page1.rows).toHaveLength(2)
    expect(page3.rows).toHaveLength(1)
  })

  it('stats：近 30 天按模块聚合', () => {
    auditRepo.record({ userId: uid, userName: '审计员', method: 'POST', path: '/api/op-logs', module: 'ledger', action: 'create', statusCode: 201 })
    auditRepo.record({ userId: uid, userName: '审计员', method: 'POST', path: '/api/op-logs', module: 'ledger', action: 'create', statusCode: 201 })
    auditRepo.record({ userId: uid, userName: '审计员', method: 'POST', path: '/api/tasks', module: 'task', action: 'create', statusCode: 201 })
    const stats = auditRepo.stats(30)
    const ledger = stats.find((s) => s.module === 'ledger')
    expect(ledger?.count).toBe(2)
    expect(stats.find((s) => s.module === 'task')?.count).toBe(1)
  })

  it('未登录的异常尝试也留痕（userName=未登录）', () => {
    auditRepo.record({ method: 'POST', path: '/api/projects', module: 'project', action: 'create', statusCode: 401, ip: '10.0.0.8' })
    const { rows } = auditRepo.query({ action: 'create' })
    expect(rows).toHaveLength(1)
    expect(rows[0].userName).toBe('未登录')
    expect(rows[0].statusCode).toBe(401)
    expect(rows[0].ip).toBe('10.0.0.8')
  })
})

// 日期筛选按北京日界回归：created_at 存 UTC ISO，筛选值是北京日期，
// 必须换算成 UTC 边界再比较（东八区 0-8 点的记录归入北京当天而非 UTC 前一天）
describe('操作审计：日期筛选按北京日界', () => {
  beforeEach(() => {
    db.exec('DELETE FROM audit_logs')
    // 直插固定 created_at 的审计行：
    // b = 北京 11-11 23:59:59；d = 北京 11-12 18:00；c = 北京 11-13 00:00；a = 北京 11-13 01:30
    const ins = db.prepare(
      'INSERT INTO audit_logs (id, user_name, method, path, module, action, status_code, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    ins.run('aud-b', 'x', 'POST', '/api/p', 'task', 'create', 201, '2026-11-11T15:59:59.999Z')
    ins.run('aud-d', 'x', 'POST', '/api/p', 'task', 'create', 201, '2026-11-12T10:00:00.000Z')
    ins.run('aud-c', 'x', 'POST', '/api/p', 'task', 'create', 201, '2026-11-12T16:00:00.000Z')
    ins.run('aud-a', 'x', 'POST', '/api/p', 'task', 'create', 201, '2026-11-12T17:30:00.000Z')
  })

  const idsOf = (filter: Parameters<typeof auditRepo.query>[0]) =>
    auditRepo.query(filter).rows.map((r) => r.id).sort()

  it('单日筛选（11-12）→ 只含北京当天记录（修复前字符串比较为 0 条）', () => {
    expect(idsOf({ dateFrom: '2026-11-12', dateTo: '2026-11-12' })).toEqual(['aud-d'])
  })

  it('单日筛选（11-13）→ 凌晨 0-8 点的记录（UTC 日期是 11-12）也归入当天', () => {
    expect(idsOf({ dateFrom: '2026-11-13', dateTo: '2026-11-13' })).toEqual(['aud-a', 'aud-c'])
  })

  it('仅 dateFrom（11-11 起）→ 含边界日全部 4 条', () => {
    expect(idsOf({ dateFrom: '2026-11-11' })).toEqual(['aud-a', 'aud-b', 'aud-c', 'aud-d'])
  })

  it('仅 dateTo（至 11-11）→ 含 11-11 全天（北京 23:59:59 在内）', () => {
    expect(idsOf({ dateTo: '2026-11-11' })).toEqual(['aud-b'])
  })
})
