/**
 * 跨模块端到端集成测试（真实 HTTP 服务 + 临时 SQLite 库）
 *
 * 复现 2026-09-22 模块结合集成测试链路：认证 → 项目 → 任务 → 工时 → 台账 →
 * 台账权限(oplog.view) → 搜索 → 统计 → 回收站。
 *
 * 机制：
 *  - 子进程启动 api/server.ts（tsx），注入 FORTUNE_DB_PATH=临时目录/e2e.db 与随机端口，
 *    生产数据库零接触；SMTP 置空强制跳过邮件外发。
 *  - 结束后终止子进程并清理临时目录。
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
    } catch {
      // 服务未就绪，继续等待
    }
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fortune-e2e-'))
  server = spawn('node_modules/.bin/tsx', ['api/server.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      FORTUNE_DB_PATH: path.join(tmpDir, 'e2e.db'),
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`))
  await waitForHealth()
}, 90_000)

afterAll(async () => {
  if (server) {
    // 直接 SIGKILL：SIGTERM 会触发 server.close() 等待 keep-alive 连接而悬挂
    server.kill('SIGKILL')
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('跨模块端到端集成（临时库 + 真实服务）', () => {
  // 新装库启动时 seed 预置演示用户（admin = leigang@creat-value.com / 12345）与演示项目
  const member = { email: `e2e-member-${Date.now()}@pm.dev`, password: 'e2e-pass-123', name: 'E2E成员' }
  let adminToken = ''
  let memberToken = ''
  let memberId = ''
  let projectId = ''
  let taskId = ''
  let opLogId = ''

  it('种子管理员登录 → token + /auth/me 回读 admin 身份', async () => {
    const r = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(r.status).toBe(200)
    adminToken = (r.json as { token: string }).token
    const me = await req('GET', '/auth/me', undefined, adminToken)
    expect(me.status).toBe(200)
    expect((me.json.user as { role: string }).role).toBe('admin')
  })

  it('注册新用户 → 普通成员（全新库下 register 不再授予 admin）', async () => {
    const r2 = await req('POST', '/auth/register', member)
    expect(r2.status).toBe(201)
    expect((r2.json.user as { role: string }).role).toBe('member')
    memberToken = (r2.json as { token: string }).token
    memberId = (r2.json.user as { id: string }).id
  })

  it('新建项目缺 projectType → 400（类型硬校验）', async () => {
    const r = await req('POST', '/projects', { name: 'E2E无类型项目' }, adminToken)
    expect(r.status).toBe(400)
  })

  it('合法类型创建项目 → 201，回读类型正确', async () => {
    const r = await req('POST', '/projects', {
      name: 'E2E集成项目',
      projectType: '运维项目',
      status: 'active',
      startDate: '2026-09-01',
      dueDate: '2026-12-31',
    }, adminToken)
    expect(r.status).toBe(201)
    const p = r.json.project as { id: string; projectType: string }
    projectId = p.id
    expect(p.projectType).toBe('运维项目')
  })

  it('添加成员到项目 → 200', async () => {
    const r = await req('POST', `/projects/${projectId}/members`, { userId: memberId, role: 'editor' }, adminToken)
    expect(r.status).toBe(200)
  })

  it('创建任务（指派成员，含计划工时）→ 201', async () => {
    const r = await req('POST', `/projects/${projectId}/tasks`, {
      title: 'E2E修复磁盘告警',
      status: 'in_progress',
      priority: 'high',
      assigneeId: memberId,
      plannedHours: 8,
    }, adminToken)
    expect(r.status).toBe(201)
    taskId = (r.json.task as { id: string }).id
  })

  it('登记工时 → 201，回读计划/实际工时正确', async () => {
    const r = await req('POST', `/tasks/${taskId}/hours`, {
      date: '2026-09-23',
      plannedHours: 8,
      actualHours: 5,
      billedHours: 0,
      description: 'E2E 工时登记',
    }, memberToken)
    expect(r.status).toBe(201)
    const list = await req('GET', `/tasks/${taskId}/hours`, undefined, memberToken)
    expect(list.status).toBe(200)
    const hours = list.json.hours as Array<{ actualHours: number; plannedHours: number }>
    expect(hours.length).toBe(1)
    expect(hours[0].actualHours).toBe(5)
    expect(hours[0].plannedHours).toBe(8)
  })

  it('成员登记台账（关联项目 + 已完成经验三字段）→ 201', async () => {
    const r = await req('POST', '/op-logs', {
      projectId,
      category: '故障处理',
      status: '已完成',
      system: 'E2E系统',
      logDate: '2026-09-23',
      problem: 'E2E磁盘空间不足',
      detail: '清理日志并扩容',
      cause: '日志未轮转',
      solution: '配置logrotate',
      hours: 1.5,
      completionDate: '2026-09-23',
    }, memberToken)
    expect(r.status).toBe(201)
    opLogId = (r.json.log as { id: string }).id
  })

  it('台账列表作用域：成员可见 1 条，台账详情 oplog.view 放行 → 200', async () => {
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, memberToken)
    expect(list.status).toBe(200)
    const logs = list.json.logs as Array<{ id: string }>
    expect(logs.map((l) => l.id)).toContain(opLogId)

    // v1.9.1 权限口径统一回归：member 已在权限矩阵补授 oplog.view，详情不再「看得到列表打不开详情」
    const detail = await req('GET', `/op-logs/${opLogId}`, undefined, memberToken)
    expect(detail.status).toBe(200)
    expect((detail.json.log as { problem: string }).problem).toBe('E2E磁盘空间不足')
  })

  it('台账统计端点可用且含数据', async () => {
    const r = await req('GET', `/op-logs/stats?projectId=${projectId}`, undefined, memberToken)
    expect(r.status).toBe(200)
    const stats = r.json.stats as Array<{ count: number }>
    expect(stats.reduce((s, x) => s + x.count, 0)).toBeGreaterThanOrEqual(1)
  })

  it('全局搜索命中任务与项目', async () => {
    const r = await req('GET', '/search?q=磁盘告警', undefined, memberToken)
    expect(r.status).toBe(200)
    const tasks = r.json.tasks as Array<{ id: string }>
    expect(tasks.map((t) => t.id)).toContain(taskId)
  })

  it('成员统计作用域：仅见参与项目与任务', async () => {
    const r = await req('GET', '/stats/overview', undefined, memberToken)
    expect(r.status).toBe(200)
    const ov = r.json as { totalProjects: number; tasksByStatus: Record<string, number> }
    expect(ov.totalProjects).toBe(1)
    expect(Object.values(ov.tasksByStatus).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('软删任务 → 回收站可见 → 恢复 → 回读存在', async () => {
    const del = await req('DELETE', `/tasks/${taskId}`, undefined, adminToken)
    expect(del.status).toBe(200)

    const trash = await req('GET', '/trash', undefined, adminToken)
    expect(trash.status).toBe(200)
    const trashTasks = trash.json.tasks as Array<{ id: string }>
    expect(trashTasks.map((t) => t.id)).toContain(taskId)

    const restore = await req('POST', `/tasks/${taskId}/restore`, undefined, adminToken)
    expect(restore.status).toBe(200)
    const back = await req('GET', `/tasks/${taskId}`, undefined, adminToken)
    expect(back.status).toBe(200)
    expect((back.json.task as { deletedAt: string | null }).deletedAt ?? null).toBeNull()
  })
})
