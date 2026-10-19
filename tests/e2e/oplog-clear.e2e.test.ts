/**
 * 台账一键清空端到端验证（临时库 + 真实 HTTP 服务）
 *
 * 验证 POST /op-logs/clear 的护栏与行为：
 *  - 二次确认：请求体缺 confirm=true → 400，不执行删除
 *  - 权限：项目内清空仅项目负责人或管理员（成员 403）；跨项目清空仅管理员（成员 403）
 *  - 筛选范围：按筛选条件只清空匹配记录；范围内无记录 → 400
 *  - 软删除：清空后列表不再显示（op_logs 打 deleted_at 标记，非物理删除）
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = 21000 + Math.floor(Math.random() * 20000)
const BASE = `http://localhost:${PORT}/api`

let server: ChildProcess | null = null
let tmpDir = ''

async function waitForHealth(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch { /* 未就绪继续等 */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`服务在 ${timeoutMs}ms 内未就绪`)
}

async function req(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fortune-e2e-'))
  server = spawn(process.execPath, [path.join(PROJECT_ROOT, 'tests/e2e/server-guard.mjs')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      FORTUNE_DB_PATH: path.join(tmpDir, 'e2e.db'),
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`))
  server.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`))
  await waitForHealth()
}, 90_000)

afterAll(async () => {
  if (server) {
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => server?.kill('SIGKILL'), 3000)
      server?.once('exit', () => { clearTimeout(t); resolve() })
    })
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('台账一键清空（软删除）', () => {
  const member = { email: `op-clear-${Date.now()}@pm.dev`, password: 'e2e-pass-123', name: '清空成员' }
  let adminToken = ''
  let memberToken = ''
  let projectId = ''

  it('管理员登录 + 注册普通成员', async () => {
    const a = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(a.status).toBe(200)
    adminToken = (a.json as { token: string }).token
    const m = await req('POST', '/auth/register', member)
    expect(m.status).toBe(201)
    memberToken = (m.json as { token: string }).token
  })

  it('建运维项目 + 成员加入 + 登记 3 条台账（2 条故障处理 + 1 条日常巡检）', async () => {
    const p = await req('POST', '/projects', {
      name: '清空验证项目', projectType: '运维项目', status: 'active', startDate: '2026-10-01',
    }, adminToken)
    expect(p.status).toBe(201)
    projectId = (p.json.project as { id: string }).id
    const me = await req('GET', '/auth/me', undefined, memberToken)
    const memberId = (me.json.user as { id: string }).id
    const add = await req('POST', `/projects/${projectId}/members`, { userId: memberId, role: 'editor' }, adminToken)
    expect(add.status).toBe(200)
    for (const [i, item] of [
      { category: '故障处理', problem: '磁盘告警一' },
      { category: '故障处理', problem: '磁盘告警二' },
      { category: '日常巡检', problem: '巡检慢查询' },
    ].entries()) {
      const r = await req('POST', '/op-logs', {
        projectId, category: item.category, status: '待处理', system: '清空系统',
        logDate: `2026-10-1${i + 1}`, problem: item.problem,
      }, adminToken)
      expect(r.status).toBe(201)
    }
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, adminToken)
    expect((list.json.logs as unknown[]).length).toBe(3)
  })

  it('缺 confirm 二次确认标记 → 400，记录不受影响', async () => {
    const r = await req('POST', '/op-logs/clear', { projectId }, adminToken)
    expect(r.status).toBe(400)
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, adminToken)
    expect((list.json.logs as unknown[]).length).toBe(3)
  })

  it('非负责人成员清空项目台账 → 403；成员跨项目清空 → 403', async () => {
    const inProject = await req('POST', '/op-logs/clear', { projectId, confirm: true }, memberToken)
    expect(inProject.status).toBe(403)
    const global = await req('POST', '/op-logs/clear', { confirm: true }, memberToken)
    expect(global.status).toBe(403)
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, adminToken)
    expect((list.json.logs as unknown[]).length).toBe(3)
  })

  it('管理员按筛选清空（仅故障处理）→ cleared=2，列表只剩巡检 1 条', async () => {
    const r = await req('POST', '/op-logs/clear', { projectId, confirm: true, category: '故障处理' }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.cleared).toBe(2)
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, adminToken)
    const logs = list.json.logs as Array<{ category: string }>
    expect(logs.length).toBe(1)
    expect(logs[0].category).toBe('日常巡检')
  })

  it('同筛选再清空 → 400（范围内无可清空记录）', async () => {
    const r = await req('POST', '/op-logs/clear', { projectId, confirm: true, category: '故障处理' }, adminToken)
    expect(r.status).toBe(400)
  })

  it('管理员跨项目清空 → 清掉剩余记录，列表为空（软删除生效）', async () => {
    const r = await req('POST', '/op-logs/clear', { confirm: true }, adminToken)
    expect(r.status).toBe(200)
    expect((r.json.cleared as number)).toBeGreaterThanOrEqual(1)
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, adminToken)
    expect((list.json.logs as unknown[]).length).toBe(0)
  })
})
