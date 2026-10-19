/**
 * 台账导出列序端到端验证（临时库 + 真实 HTTP 服务）
 *
 * 验证「导出的列排序与列设置后的界面一模一样」：
 *  - 路径 A：界面「列设置」持久化（PUT /auth/me 的 oplogColumnOrder）→ 不带参数导出，表头与设置一致
 *  - 路径 B：导出请求显式携带完整 colOrder（前端当前界面列序，最高优先）→ 完全按请求序输出，覆盖账号持久化序
 *  - 部分列序：colOrder 仅含部分固定列 → 缺失标准列按默认相对位置补齐、请求列相对顺序保留（与前端 mergeColumnOrder 同语义）
 *  - 回退：从未设置过列序的账号 → 完整默认序（含「详细描述」）
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { OP_LOG_DEFAULT_COLUMN_ORDER } from '../../shared/types.ts'

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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

/** 导出 xlsx 并解析首行表头（序号固定第 1 列） */
async function exportHeaders(url: string, token: string): Promise<{ status: number; headers: string[] }> {
  const res = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { status: res.status, headers: [] }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer)
  const headers: string[] = []
  wb.worksheets[0].getRow(1).eachCell((cell) => headers.push(String(cell.value)))
  return { status: res.status, headers }
}

const LABELS: Record<string, string> = {
  logDate: '日期', category: '分类', status: '状态', system: '系统', department: '部门',
  proposer: '提出人', recorder: '记录人', problem: '问题', detail: '详细描述', cause: '原因',
  solution: '解决方案', completionDate: '完成日', hours: '工时', createdAt: '登记日期',
}
const toLabels = (keys: readonly string[]) => keys.map((k) => LABELS[k] ?? k)
const DEFAULTS = OP_LOG_DEFAULT_COLUMN_ORDER as readonly string[]

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

describe('台账导出列序 = 界面列设置（端到端）', () => {
  const member = { email: `exp-order-${Date.now()}@pm.dev`, password: 'e2e-pass-123', name: '列序成员' }
  let adminToken = ''
  let memberToken = ''
  let projectId = ''

  it('管理员登录（种子账号）', async () => {
    const r = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(r.status).toBe(200)
    adminToken = (r.json as { token: string }).token
  })

  it('注册普通成员（未设置过列序，用于默认序回退验证）', async () => {
    const r = await req('POST', '/auth/register', member)
    expect(r.status).toBe(201)
    memberToken = (r.json as { token: string }).token
  })

  it('建运维项目 + 成员加入', async () => {
    const p = await req('POST', '/projects', {
      name: '列序验证项目', projectType: '运维项目', status: 'active', startDate: '2026-10-01',
    }, adminToken)
    expect(p.status).toBe(201)
    projectId = (p.json.project as { id: string }).id
    const me = await req('GET', '/auth/me', undefined, memberToken)
    const memberId = (me.json.user as { id: string }).id
    const m = await req('POST', `/projects/${projectId}/members`, { userId: memberId, role: 'editor' }, adminToken)
    expect(m.status).toBe(200)
  })

  it('管理员与成员各登记一条台账（含详细描述/原因/解决方案）', async () => {
    const a = await req('POST', '/op-logs', {
      projectId, category: '故障处理', status: '已完成', system: '验证系统',
      logDate: '2026-10-15', problem: '磁盘告警', detail: '磁盘使用率 92%', cause: '日志膨胀',
      solution: '清理并轮转', hours: 2, recorder: '管理员',
    }, adminToken)
    expect(a.status).toBe(201)
    const b = await req('POST', '/op-logs', {
      projectId, category: '日常巡检', status: '待处理', system: '验证系统',
      logDate: '2026-10-16', problem: '巡检发现慢查询', detail: '慢查询 3 条', cause: '缺索引',
      solution: '补索引', hours: 1, recorder: '列序成员',
    }, memberToken)
    expect(b.status).toBe(201)
  })

  it('路径 A：界面列设置持久化后导出 → 表头与设置完全一致', async () => {
    const custom = ['status', 'problem', 'detail', 'cause', 'solution', 'logDate', 'hours', 'completionDate', 'category', 'system', 'department', 'proposer', 'recorder', 'createdAt']
    const save = await req('PUT', '/auth/me', { oplogColumnOrder: custom }, adminToken)
    expect(save.status).toBe(200)
    const { status, headers } = await exportHeaders(`/op-logs/export.xlsx?projectId=${projectId}`, adminToken)
    expect(status).toBe(200)
    // 序号永远第 1 列，其余固定列 = 用户设置序
    expect(headers[0]).toBe('序号')
    expect(headers.slice(1)).toEqual(toLabels(custom))
  })

  it('路径 B：导出请求显式携带 colOrder → 请求序优先于账号持久化序', async () => {
    // 管理员已持久化 custom 序（「状态」第 1）；请求携带完整倒序 → 导出必须完全按请求序输出
    const reversed = (DEFAULTS.filter((k) => k !== 'project')).reverse()
    const url = `/op-logs/export.xlsx?projectId=${projectId}&colOrder=${encodeURIComponent(JSON.stringify(reversed))}`
    const { status, headers } = await exportHeaders(url, adminToken)
    expect(status).toBe(200)
    expect(headers[0]).toBe('序号')
    expect(headers.slice(1)).toEqual(toLabels(reversed))
  })

  it('回退：未设置过列序的账号导出 → 完整默认序（含「详细描述」）', async () => {
    const { status, headers } = await exportHeaders(`/op-logs/export.xlsx?projectId=${projectId}`, memberToken)
    expect(status).toBe(200)
    expect(headers.slice(1)).toEqual(toLabels(DEFAULTS.filter((k) => k !== 'seq' && k !== 'project')))
    expect(headers).toContain('详细描述')
  })

  it('请求携带部分列序 → 缺失列按默认相对位置补齐且请求序生效', async () => {
    const partial = ['hours', 'problem']
    const url = `/op-logs/export.xlsx?projectId=${projectId}&colOrder=${encodeURIComponent(JSON.stringify(partial))}`
    const { status, headers } = await exportHeaders(url, memberToken)
    expect(status).toBe(200)
    expect(headers[0]).toBe('序号')
    // 补齐语义（与前端 mergeColumnOrder 相同）：默认前置列补在最前；请求列相对顺序保留；
    // detail 补在 problem（请求序中最后一个默认位次在 detail 之前的列）之后，createdAt（默认末位）补到最后
    expect(headers.slice(1)).toEqual(toLabels([
      'logDate', 'category', 'status', 'system', 'department', 'proposer', 'recorder',
      'hours', 'problem', 'detail', 'cause', 'solution', 'completionDate', 'createdAt',
    ]))
  })
})

describe('统一交错列序（端到端）：自定义列/项目列按界面位置交错输出，不再堆尾/置顶', () => {
  let adminToken = ''
  let extraKey = ''
  let projectId2 = ''

  it('管理员登录（种子账号）', async () => {
    const r = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(r.status).toBe(200)
    adminToken = (r.json as { token: string }).token
  })

  it('跨项目导出：colOrder 把「项目」放在中间 → 按请求位置输出（不再强制第 2 列）', async () => {
    // 注意：必须在创建任何自定义字段数据之前执行（跨项目导出的 extra 列取自数据实际字段）
    const colOrder = ['logDate', 'project', 'problem']
    const url = `/op-logs/export.xlsx?colOrder=${encodeURIComponent(JSON.stringify(colOrder))}`
    const { status, headers } = await exportHeaders(url, adminToken)
    expect(status).toBe(200)
    expect(headers).toEqual([
      '序号', '日期', '分类', '状态', '项目', '系统', '部门', '提出人', '记录人',
      '问题', '详细描述', '原因', '解决方案', '完成日', '工时', '登记日期',
    ])
  })

  it('建自定义字段「客户名称」+ 新项目并启用自定义列配置', async () => {
    const f = await req('POST', '/op-logs/custom-fields', { label: '客户名称', type: 'text' }, adminToken)
    expect(f.status).toBe(200)
    extraKey = (f.json.field as { key: string }).key
    const p = await req('POST', '/projects', {
      name: '交错列序项目', projectType: '运维项目', status: 'active', startDate: '2026-10-01',
    }, adminToken)
    expect(p.status).toBe(201)
    projectId2 = (p.json.project as { id: string }).id
    const cfg = await req('PUT', `/projects/${projectId2}/oplog-columns`, {
      enabled: true, columns: [{ key: extraKey }],
    }, adminToken)
    expect(cfg.status).toBe(200)
  })

  it('登记一条携带自定义字段值的台账', async () => {
    const r = await req('POST', '/op-logs', {
      projectId: projectId2, category: '故障处理', status: '待处理', system: '交错系统',
      logDate: '2026-10-16', problem: '自定义列交错验证',
      extraFields: { [extraKey]: '某某公司' },
    }, adminToken)
    expect(r.status).toBe(201)
  })

  it('项目内导出：colOrder 把自定义列放在中间 → 表头与值均按界面位置交错（修复核心场景）', async () => {
    // 界面列设置：日期、问题、[客户名称]、工时 → 缺失固定列按默认相对位置补齐，自定义列保持问题与工时之间
    const colOrder = ['logDate', 'problem', `extra:${extraKey}`, 'hours']
    const url = `/op-logs/export.xlsx?projectId=${projectId2}&colOrder=${encodeURIComponent(JSON.stringify(colOrder))}`
    const { status, headers } = await exportHeaders(url, adminToken)
    expect(status).toBe(200)
    // 精确表头：客户名称在「完成日」与「工时」之间（修复前会被强制堆到最末）
    expect(headers).toEqual([
      '序号', '日期', '分类', '状态', '系统', '部门', '提出人', '记录人',
      '问题', '详细描述', '原因', '解决方案', '完成日', '客户名称', '工时', '登记日期',
    ])
    // 值对齐：「某某公司」必须落在「客户名称」表头所在列（表头 index 13 → Excel 第 14 列）
    const res = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${adminToken}` } })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer)
    const sheet = wb.worksheets[0]
    const labelCol = headers.indexOf('客户名称') + 1
    let found = false
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      row.eachCell((cell, colNumber) => {
        if (String(cell.value ?? '').includes('某某公司')) {
          found = true
          expect(colNumber).toBe(labelCol)
        }
      })
    })
    expect(found).toBe(true)
  })
})
