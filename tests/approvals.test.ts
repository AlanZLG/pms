// 统一审批（我的待办）：聚合与批量审批 API 单测
// 覆盖：权限过滤（admin/finance/自定义角色/普通成员）、批量通过与驳回（预算 + 项目删除申请）、逐条容错
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { AddressInfo } from 'node:net'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import app from '../api/app.ts'
import db from '../api/db.ts'
import { seedUser, seedProject } from './helpers/test-db'

let server: ReturnType<typeof app.listen>
let base = ''

type Json = Record<string, unknown>
async function req(method: string, path: string, { token, body }: { token?: string; body?: Json } = {}) {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as Json }
}

let adminEmail: string, financeEmail: string, memberEmail: string, approverEmail: string
let projectId: string

beforeAll(async () => {
  server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// 登录限流：固定用户 ID + 缓存 token（重建同 ID 用户后 token 仍有效）
const tokenCache = new Map<string, string>()
async function loginAs(email: string): Promise<string> {
  let token = tokenCache.get(email)
  if (!token) {
    const r = await req('POST', '/api/auth/login', { body: { email, password: '12345' } })
    token = (r.json as { token: string }).token
    if (token) tokenCache.set(email, token)
  }
  return token
}

/** 插入待审批预算，返回预算 ID */
function seedBudget(projectId: string, createdBy: string, opts: { amount?: number; status?: string; category?: string; description?: string } = {}) {
  const id = crypto.randomUUID()
  db.prepare(
    'INSERT INTO project_budgets (id, project_id, category, amount, description, created_by, created_at, approval_status) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, projectId, opts.category || 'labor', opts.amount ?? 5000, opts.description || '', createdBy, new Date().toISOString(), opts.status || 'pending')
  return id
}

/** 把项目置为「删除申请待审批」 */
function requestDeletion(projectId: string, userId: string) {
  db.prepare('UPDATE projects SET delete_requested_by = ?, delete_requested_at = ? WHERE id = ?').run(userId, new Date().toISOString(), projectId)
}

beforeEach(() => {
  for (const t of ['audit_logs', 'notifications', 'project_budgets', 'role_permissions', 'permissions', 'roles', 'projects', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
  // 固定 ID 保证缓存 token 跨用例有效
  adminEmail = 'ap-admin@pm.dev'
  financeEmail = 'ap-finance@pm.dev'
  memberEmail = 'ap-member@pm.dev'
  approverEmail = 'ap-approver@pm.dev'
  seedUser(db, { id: 'u-admin', email: adminEmail, name: '管理员', role: 'admin' })
  seedUser(db, { id: 'u-finance', email: financeEmail, name: '核算员', role: 'finance' })
  const memberId = seedUser(db, { id: 'u-member', email: memberEmail, name: '申请人', role: 'member' })
  seedUser(db, { id: 'u-approver', email: approverEmail, name: '审批员', role: 'member' })
  projectId = seedProject(db, memberId, { name: '审批测试项目' })
})

describe('待审批聚合 GET /api/approvals', () => {
  it('未登录 401', async () => {
    const r = await req('GET', '/api/approvals')
    expect(r.status).toBe(401)
  })

  it('admin：返回预算与删除申请两类，字段完整且带项目名/申请人', async () => {
    const budgetId = seedBudget(projectId, 'u-member', { category: 'outsource', amount: 8000, description: '外包开发' })
    requestDeletion(projectId, 'u-member')
    const r = await req('GET', '/api/approvals', { token: await loginAs(adminEmail) })
    expect(r.status).toBe(200)
    const items = (r.json as { items: Array<Json> }).items
    expect(items).toHaveLength(2)
    const budget = items.find((i) => i.type === 'budget')!
    expect(budget.id).toBe(budgetId)
    expect(budget.title).toContain('外包费用 · 外包开发')
    expect(budget.projectName).toBe('审批测试项目')
    expect(budget.amount).toBe(8000)
    expect(budget.requesterName).toBe('申请人')
    const deletion = items.find((i) => i.type === 'deletion')!
    expect(deletion.id).toBe(projectId)
    expect(deletion.title).toBe('删除申请：审批测试项目')
    expect(deletion.requesterName).toBe('申请人')
  })

  it('finance：可见预算与删除申请（系统核算角色隐式审批权限）', async () => {
    seedBudget(projectId, 'u-member')
    requestDeletion(projectId, 'u-member')
    const r = await req('GET', '/api/approvals', { token: await loginAs(financeEmail) })
    expect(r.status).toBe(200)
    const types = (r.json as { items: Array<{ type: string }> }).items.map((i) => i.type).sort()
    expect(types).toEqual(['budget', 'deletion'])
  })

  it('自定义角色成员：仅授予 project.approve_delete 时只看到删除申请', async () => {
    const roleId = crypto.randomUUID()
    db.prepare('INSERT INTO roles (id, name) VALUES (?,?)').run(roleId, '删除审批员')
    const permId = crypto.randomUUID()
    db.prepare('INSERT INTO permissions (id, key, name) VALUES (?,?,?)').run(permId, 'project.approve_delete', '审批项目删除申请')
    db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)').run(roleId, permId)
    db.prepare('UPDATE users SET custom_role_id = ? WHERE id = ?').run(roleId, 'u-approver')
    seedBudget(projectId, 'u-member')
    requestDeletion(projectId, 'u-member')
    const r = await req('GET', '/api/approvals', { token: await loginAs(approverEmail) })
    expect(r.status).toBe(200)
    const items = (r.json as { items: Array<{ type: string }> }).items
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('deletion')
  })

  it('普通成员：无可审批内容，返回空列表', async () => {
    seedBudget(projectId, 'u-member')
    const r = await req('GET', '/api/approvals', { token: await loginAs(memberEmail) })
    expect(r.status).toBe(200)
    expect((r.json as { items: unknown[] }).items).toEqual([])
  })
})

describe('批量审批 POST /api/approvals/batch', () => {
  it('参数校验：空 items 400', async () => {
    const r = await req('POST', '/api/approvals/batch', { token: await loginAs(adminEmail), body: { action: 'approve', items: [] } })
    expect(r.status).toBe(400)
  })

  it('批量通过预算：状态与审批人正确落库', async () => {
    const b1 = seedBudget(projectId, 'u-member', { amount: 1000 })
    const b2 = seedBudget(projectId, 'u-member', { amount: 2000 })
    const r = await req('POST', '/api/approvals/batch', {
      token: await loginAs(adminEmail),
      body: { action: 'approve', items: [{ id: b1, type: 'budget' }, { id: b2, type: 'budget' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { succeeded: number }).succeeded).toBe(2)
    const rows = db.prepare('SELECT approval_status, approved_by FROM project_budgets WHERE id IN (?,?) ORDER BY amount').all(b1, b2) as Array<{ approval_status: string; approved_by: string }>
    expect(rows.every((row) => row.approval_status === 'approved' && row.approved_by === 'u-admin')).toBe(true)
  })

  it('批量驳回预算：已处理条目单独报错，不影响其余', async () => {
    const b1 = seedBudget(projectId, 'u-member')
    const b2 = seedBudget(projectId, 'u-member', { status: 'approved' })
    const r = await req('POST', '/api/approvals/batch', {
      token: await loginAs(adminEmail),
      body: { action: 'reject', comment: '金额超支', items: [{ id: b1, type: 'budget' }, { id: b2, type: 'budget' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { succeeded: number; failed: number }).succeeded).toBe(1)
    expect((r.json as { failed: number }).failed).toBe(1)
    const firstError = (r.json as { results: Array<{ ok: boolean; error?: string }> }).results.find((x) => !x.ok)?.error
    expect(firstError).toContain('已被处理')
    expect((db.prepare('SELECT approval_status FROM project_budgets WHERE id = ?').get(b1) as { approval_status: string }).approval_status).toBe('rejected')
  })

  it('批量批准删除申请：项目移入回收站并通知申请人', async () => {
    const p2 = seedProject(db, 'u-member', { name: '待删项目二' })
    requestDeletion(projectId, 'u-member')
    requestDeletion(p2, 'u-member')
    const r = await req('POST', '/api/approvals/batch', {
      token: await loginAs(adminEmail),
      body: { action: 'approve', items: [{ id: projectId, type: 'deletion' }, { id: p2, type: 'deletion' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { succeeded: number }).succeeded).toBe(2)
    for (const pid of [projectId, p2]) {
      const row = db.prepare('SELECT deleted_at, delete_requested_by FROM projects WHERE id = ?').get(pid) as { deleted_at: string | null; delete_requested_by: string | null }
      expect(row.deleted_at).toBeTruthy()
      expect(row.delete_requested_by).toBeNull()
    }
    const notified = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND title LIKE ?').get('u-member', '%删除申请已批准%') as { c: number }
    expect(notified.c).toBe(2)
  })

  it('批量驳回删除申请：清除申请标记并附驳回原因通知', async () => {
    requestDeletion(projectId, 'u-member')
    const r = await req('POST', '/api/approvals/batch', {
      token: await loginAs(adminEmail),
      body: { action: 'reject', comment: '项目仍有在途任务', items: [{ id: projectId, type: 'deletion' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { succeeded: number }).succeeded).toBe(1)
    const row = db.prepare('SELECT deleted_at, delete_requested_by, delete_reject_comment FROM projects WHERE id = ?').get(projectId) as { deleted_at: string | null; delete_requested_by: string | null; delete_reject_comment: string }
    expect(row.deleted_at).toBeNull()
    expect(row.delete_requested_by).toBeNull()
    expect(row.delete_reject_comment).toBe('项目仍有在途任务')
    const body = db.prepare('SELECT body FROM notifications WHERE user_id = ? AND title LIKE ?').get('u-member', '%删除申请被驳回%') as { body: string }
    expect(body.body).toContain('项目仍有在途任务')
  })

  it('普通成员批量审批：逐条返回无权限且不产生任何变更', async () => {
    const budgetId = seedBudget(projectId, 'u-member')
    requestDeletion(projectId, 'u-member')
    const r = await req('POST', '/api/approvals/batch', {
      token: await loginAs(memberEmail),
      body: { action: 'approve', items: [{ id: budgetId, type: 'budget' }, { id: projectId, type: 'deletion' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { succeeded: number; failed: number }).succeeded).toBe(0)
    expect((r.json as { failed: number }).failed).toBe(2)
    const errors = (r.json as { results: Array<{ error?: string }> }).results.map((x) => x.error)
    expect(errors[0]).toContain('无预算审批权限')
    expect(errors[1]).toContain('无删除审批权限')
    expect((db.prepare('SELECT approval_status FROM project_budgets WHERE id = ?').get(budgetId) as { approval_status: string }).approval_status).toBe('pending')
    expect((db.prepare('SELECT delete_requested_by FROM projects WHERE id = ?').get(projectId) as { delete_requested_by: string }).delete_requested_by).toBe('u-member')
  })

  it('自定义角色成员：只能批准删除申请，预算项逐条报错', async () => {
    const roleId = crypto.randomUUID()
    db.prepare('INSERT INTO roles (id, name) VALUES (?,?)').run(roleId, '删除审批员')
    const permId = crypto.randomUUID()
    db.prepare('INSERT INTO permissions (id, key, name) VALUES (?,?,?)').run(permId, 'project.approve_delete', '审批项目删除申请')
    db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?,?)').run(roleId, permId)
    db.prepare('UPDATE users SET custom_role_id = ? WHERE id = ?').run(roleId, 'u-approver')
    const budgetId = seedBudget(projectId, 'u-member')
    requestDeletion(projectId, 'u-member')
    const r = await req('POST', '/api/approvals/batch', {
      token: await loginAs(approverEmail),
      body: { action: 'approve', items: [{ id: budgetId, type: 'budget' }, { id: projectId, type: 'deletion' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { succeeded: number; failed: number }).succeeded).toBe(1)
    expect((r.json as { failed: number }).failed).toBe(1)
    expect((r.json as { results: Array<{ ok: boolean; error?: string }> }).results.find((x) => !x.ok)?.error).toContain('无预算审批权限')
    expect((db.prepare('SELECT deleted_at FROM projects WHERE id = ?').get(projectId) as { deleted_at: string | null }).deleted_at).toBeTruthy()
  })
})
