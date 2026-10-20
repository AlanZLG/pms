/**
 * 工时登记规则端到端验证（临时库 + 真实 HTTP 服务）
 *
 * 验证「单日不限量 + 累计超计划 20% 仅提示」：
 *  - 单日登记不限量：计划 10h 的任务单日可登记 8h（旧规则上限 2h 会 400）→ 201
 *  - 累计提示：任务累计实绩 > 计划 × 120% 时响应携带 warning 文案，且登记成功不拦截
 *  - 阈值内不提示：累计 ≤ 计划 × 120% 时 warning 为 null
 *  - 未设计划工时的任务永不提示
 *  - 周表批量：单格超过旧上限仍保存成功，超限时 warnings 非空
 *  - PATCH 修改记录后累计超限同样提示
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

describe('工时登记：单日不限量 + 累计超计划 20% 提示', () => {
  const member = { email: `ot-${Date.now()}@pm.dev`, password: 'e2e-pass-123', name: '超限成员' }
  let adminToken = ''
  let memberToken = ''
  let memberId = ''
  let projectId = ''
  let taskAId = '' // 计划 10h
  let taskBId = '' // 计划 10h（周表用）
  let taskCId = '' // 无计划
  let recordA1Id = '' // 任务 A 第一条登记（8h）

  it('管理员登录 + 注册成员', async () => {
    const a = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(a.status).toBe(200)
    adminToken = (a.json as { token: string }).token
    const m = await req('POST', '/auth/register', member)
    expect(m.status).toBe(201)
    memberToken = (m.json as { token: string }).token
    const me = await req('GET', '/auth/me', undefined, memberToken)
    memberId = (me.json.user as { id: string }).id
  })

  it('建项目 + 成员加入 + 三个任务（计划 10h ×2、无计划 ×1）', async () => {
    const p = await req('POST', '/projects', {
      name: '工时规则验证项目', projectType: '开发项目', status: 'active', startDate: '2026-10-01',
    }, adminToken)
    expect(p.status).toBe(201)
    projectId = (p.json.project as { id: string }).id
    const add = await req('POST', `/projects/${projectId}/members`, { userId: memberId, role: 'editor' }, adminToken)
    expect(add.status).toBe(200)
    for (const [i, t] of [{ title: '任务A-计划10h', plannedHours: 10 }, { title: '任务B-计划10h', plannedHours: 10 }, { title: '任务C-无计划', plannedHours: 0 }].entries()) {
      const r = await req('POST', `/projects/${projectId}/tasks`, {
        title: t.title, status: 'in_progress', priority: 'medium', assigneeId: memberId, plannedHours: t.plannedHours,
      }, adminToken)
      expect(r.status).toBe(201)
      if (i === 0) taskAId = (r.json.task as { id: string }).id
      if (i === 1) taskBId = (r.json.task as { id: string }).id
      if (i === 2) taskCId = (r.json.task as { id: string }).id
    }
  })

  it('快速登记单日 8h（计划 10h，远超旧上限 2h）→ 201 且无提示', async () => {
    const r = await req('POST', `/tasks/${taskAId}/hours`, { date: '2026-10-10', actualHours: 8 }, memberToken)
    expect(r.status).toBe(201)
    expect(r.json.warning).toBeNull() // 累计 8h ≤ 阈值 12h
    recordA1Id = (r.json.record as { id: string }).id
  })

  it('继续登记 5h → 201 且登记成功，累计 13h 超过计划 120% → 返回提示', async () => {
    const r = await req('POST', `/tasks/${taskAId}/hours`, { date: '2026-10-11', actualHours: 5 }, memberToken)
    expect(r.status).toBe(201)
    const warning = String(r.json.warning)
    expect(warning).toContain('任务A-计划10h')
    expect(warning).toContain('累计实绩 13h')
    expect(warning).toContain('计划 10h')
    expect(warning).toContain('阈值 12h')
    // 记录确实保存了（提示不拦截）
    const list = await req('GET', `/tasks/${taskAId}/hours`, undefined, memberToken)
    expect((list.json.hours as unknown[]).length).toBe(2)
  })

  it('未设计划工时的任务登记 24h → 201 且永不提示', async () => {
    const r = await req('POST', `/tasks/${taskCId}/hours`, { date: '2026-10-10', actualHours: 24 }, memberToken)
    expect(r.status).toBe(201)
    expect(r.json.warning).toBeNull()
  })

  it('PATCH 修改记录使累计继续超限 → 200 + 提示', async () => {
    // 8h → 10h，累计 10 + 5 = 15h > 12h 阈值
    const r = await req('PATCH', `/hours/${recordA1Id}`, { actualHours: 10 }, memberToken)
    expect(r.status).toBe(200)
    expect(String(r.json.warning)).toContain('累计实绩 15h')
  })

  it('周表批量：单格 6h（超旧上限 2h）保存成功无提示；再填 7h 累计 13h → warnings 非空', async () => {
    const r1 = await req('POST', '/hours/bulk', { entries: [{ taskId: taskBId, date: '2026-10-12', hours: 6 }] }, memberToken)
    expect(r1.status).toBe(200)
    expect(r1.json.warnings).toEqual([])
    const r2 = await req('POST', '/hours/bulk', { entries: [{ taskId: taskBId, date: '2026-10-13', hours: 7 }] }, memberToken)
    expect(r2.status).toBe(200)
    const warnings = r2.json.warnings as string[]
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('任务B-计划10h')
    expect(warnings[0]).toContain('累计实绩 13h')
  })
})
