// 台账自定义项权限（v1.10）：字段库维护仅系统管理员；项目负责人（或管理员）可为项目勾选启用
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

let adminEmail: string, ownerEmail: string, memberEmail: string, outsiderEmail: string
let projectId: string

beforeAll(async () => {
  server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// 登录限流 10 次/分钟：固定用户 ID + 缓存 token（authRequired 只校验 token_version，重建同 ID 用户后 token 仍有效）
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

beforeEach(() => {
  for (const t of ['audit_logs', 'project_activity_log', 'op_logs', 'projects', 'oplog_custom_fields', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
  // admin / 项目负责人 / 项目成员（非负责人）/ 路人（固定 ID，保证缓存 token 跨用例有效）
  adminEmail = `cf-admin@pm.dev`
  ownerEmail = `cf-owner@pm.dev`
  memberEmail = `cf-member@pm.dev`
  outsiderEmail = `cf-out@pm.dev`
  seedUser(db, { id: 'u-admin', email: adminEmail, name: '管理员', role: 'admin' })
  const ownerId = seedUser(db, { id: 'u-owner', email: ownerEmail, name: '负责人', role: 'member' })
  const memberId = seedUser(db, { id: 'u-member', email: memberEmail, name: '成员', role: 'member' })
  seedUser(db, { id: 'u-out', email: outsiderEmail, name: '路人', role: 'member' })
  projectId = seedProject(db, ownerId, { name: '权限验证项目' })
  db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
    .run(crypto.randomUUID(), projectId, memberId, 'editor')
})

describe('台账自定义项库维护（仅系统管理员）', () => {
  it('admin：可新增/改名/切换类型/删除', async () => {
    const token = await loginAs(adminEmail)
    const created = await req('POST', '/api/op-logs/custom-fields', { token, body: { label: '影响范围', type: 'date' } })
    expect(created.status).toBe(200)
    const key = (created.json as { field: { key: string } }).field.key
    const renamed = await req('PATCH', `/api/op-logs/custom-fields/${encodeURIComponent(key)}`, { token, body: { label: '影响范围2' } })
    expect(renamed.status).toBe(200)
    const del = await req('DELETE', `/api/op-logs/custom-fields/${encodeURIComponent(key)}`, { token })
    expect(del.status).toBe(200)
  })

  it('项目负责人：新增/改名/删除 → 403', async () => {
    const token = await loginAs(ownerEmail)
    const post = await req('POST', '/api/op-logs/custom-fields', { token, body: { label: '越权字段' } })
    expect(post.status).toBe(403)
    expect((post.json as { error: string }).error).toBe('仅系统管理员可维护台账自定义项库')
    const patch = await req('PATCH', `/api/op-logs/custom-fields/${encodeURIComponent('不存在')}`, { token, body: { label: 'x' } })
    expect(patch.status).toBe(403)
    const del = await req('DELETE', '/api/op-logs/custom-fields/x', { token })
    expect(del.status).toBe(403)
  })

  it('项目成员/路人：新增 → 403', async () => {
    for (const email of [memberEmail, outsiderEmail]) {
      const token = await loginAs(email)
      const post = await req('POST', '/api/op-logs/custom-fields', { token, body: { label: '越权字段' } })
      expect(post.status).toBe(403)
    }
  })

  it('字段库列表：登录用户均可读（项目勾选/表单渲染需要）', async () => {
    const token = await loginAs(memberEmail)
    const r = await req('GET', '/api/op-logs/custom-fields', { token })
    expect(r.status).toBe(200)
    expect(Array.isArray((r.json as { fields: unknown[] }).fields)).toBe(true)
  })
})

describe('项目勾选启用自定义项（项目负责人或管理员）', () => {
  it('admin 建字段 → 项目负责人勾选成功，label 按库回填', async () => {
    const adminToken = await loginAs(adminEmail)
    const created = await req('POST', '/api/op-logs/custom-fields', { token: adminToken, body: { label: '客户名称' } })
    const key = (created.json as { field: { key: string } }).field.key
    const ownerToken = await loginAs(ownerEmail)
    const put = await req('PUT', `/api/projects/${projectId}/oplog-columns`, {
      token: ownerToken,
      body: { enabled: true, columns: [{ key }] },
    })
    expect(put.status).toBe(200)
    const project = (put.json as { project: { oplogExtraColumns: { enabled: boolean; columns: { key: string; label: string }[] } } }).project
    expect(project.oplogExtraColumns.enabled).toBe(true)
    expect(project.oplogExtraColumns.columns).toEqual([{ key, label: '客户名称' }])
  })

  it('admin：可为任意项目勾选', async () => {
    const adminToken = await loginAs(adminEmail)
    const created = await req('POST', '/api/op-logs/custom-fields', { token: adminToken, body: { label: '台账区分' } })
    const key = (created.json as { field: { key: string } }).field.key
    const put = await req('PUT', `/api/projects/${projectId}/oplog-columns`, {
      token: adminToken,
      body: { enabled: true, columns: [{ key }] },
    })
    expect(put.status).toBe(200)
  })

  it('项目成员（非负责人）：勾选 → 403', async () => {
    const token = await loginAs(memberEmail)
    const put = await req('PUT', `/api/projects/${projectId}/oplog-columns`, {
      token,
      body: { enabled: true, columns: [{ key: '任意' }] },
    })
    expect(put.status).toBe(403)
    expect((put.json as { error: string }).error).toBe('仅项目负责人或管理员可配置台账自定义列')
  })

  it('路人：勾选 → 403；未登录 → 401', async () => {
    const outToken = await loginAs(outsiderEmail)
    const put = await req('PUT', `/api/projects/${projectId}/oplog-columns`, {
      token: outToken,
      body: { enabled: true, columns: [] },
    })
    expect(put.status).toBe(403)
    const anon = await req('PUT', `/api/projects/${projectId}/oplog-columns`, { body: { enabled: false, columns: [] } })
    expect(anon.status).toBe(401)
  })

  it('勾选未入库的字段键 → 400 提示刷新重新勾选', async () => {
    const ownerToken = await loginAs(ownerEmail)
    const put = await req('PUT', `/api/projects/${projectId}/oplog-columns`, {
      token: ownerToken,
      body: { enabled: true, columns: [{ key: '幽灵字段' }] },
    })
    expect(put.status).toBe(400)
    expect((put.json as { error: string }).error).toContain('不存在于自定义项库')
  })

  it('启用时至少勾选 1 个 → 400', async () => {
    const ownerToken = await loginAs(ownerEmail)
    const put = await req('PUT', `/api/projects/${projectId}/oplog-columns`, {
      token: ownerToken,
      body: { enabled: true, columns: [] },
    })
    expect(put.status).toBe(400)
  })
})
