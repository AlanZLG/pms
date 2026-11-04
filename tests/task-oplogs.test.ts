// 任务关联台账聚合（月度对照视图）API 单测
// 覆盖：鉴权、任务不存在、按月聚合与合计舍入、计划工时透传、只返回 task_id 匹配且同项目的台账
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { AddressInfo } from 'node:net'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import app from '../api/app.ts'
import db from '../api/db.ts'
import { seedUser, seedProject, seedTask, seedOpLog } from './helpers/test-db'

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

let adminEmail: string
let projectId: string
let taskId: string
let taskId2: string

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

beforeEach(() => {
  for (const t of ['task_hours', 'op_logs', 'task_history', 'tasks', 'projects', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
  // 固定 ID 保证缓存 token 跨用例有效
  adminEmail = 'to-admin@pm.dev'
  seedUser(db, { id: 'u-admin', email: adminEmail, name: '管理员', role: 'admin' })
  projectId = seedProject(db, 'u-admin', { name: '台账对照项目' })
  taskId = seedTask(db, projectId, { id: 't-main', title: '一月运维', plannedHours: 16 })
  taskId2 = seedTask(db, projectId, { id: 't-other', title: '二月巡检' })
})

describe('任务关联台账 GET /api/tasks/:taskId/op-logs', () => {
  it('未登录 401', async () => {
    const r = await req('GET', `/api/tasks/${taskId}/op-logs`)
    expect(r.status).toBe(401)
  })

  it('任务不存在 404', async () => {
    const r = await req('GET', '/api/tasks/nonexistent/op-logs', { token: await loginAs(adminEmail) })
    expect(r.status).toBe(404)
  })

  it('按月聚合、合计舍入、月度降序，仅含 task_id 匹配的台账', async () => {
    seedOpLog(db, 'u-admin', { projectId, taskId, logDate: '2026-01-15', hours: 2.5 })
    seedOpLog(db, 'u-admin', { projectId, taskId, logDate: '2026-01-20', hours: 1.25 })
    seedOpLog(db, 'u-admin', { projectId, taskId, logDate: '2026-02-10', hours: 3 })
    // 干扰数据：其他任务、未关联任务、其他项目但同 taskId
    seedOpLog(db, 'u-admin', { projectId, taskId: taskId2, logDate: '2026-01-11', hours: 4 })
    seedOpLog(db, 'u-admin', { projectId, logDate: '2026-01-12', hours: 9 })
    seedProject(db, 'u-admin', { id: 'p-other', name: '其他项目' })
    seedOpLog(db, 'u-admin', { projectId: 'p-other', taskId, logDate: '2026-03-01', hours: 8 })

    const r = await req('GET', `/api/tasks/${taskId}/op-logs`, { token: await loginAs(adminEmail) })
    expect(r.status).toBe(200)
    const j = r.json as unknown as { logs: Array<{ id: string }>; monthly: Array<{ month: string; hours: number }>; totalHours: number; plannedHours: number | null }
    expect(j.logs.map((l) => l.id).sort()).toHaveLength(3)
    expect(j.monthly).toEqual([
      { month: '2026-02', hours: 3 },
      { month: '2026-01', hours: 3.75 },
    ])
    expect(j.totalHours).toBe(6.75)
    expect(j.plannedHours).toBe(16)
  })

  it('任务无计划工时返回 plannedHours=null，无台账返回空聚合', async () => {
    const t3 = seedTask(db, projectId, { title: '无计划任务' })
    const r = await req('GET', `/api/tasks/${t3}/op-logs`, { token: await loginAs(adminEmail) })
    expect(r.status).toBe(200)
    const j = r.json as unknown as { logs: unknown[]; monthly: unknown[]; totalHours: number; plannedHours: number | null }
    expect(j.logs).toHaveLength(0)
    expect(j.monthly).toEqual([])
    expect(j.totalHours).toBe(0)
    expect(j.plannedHours).toBeNull()
  })
})
