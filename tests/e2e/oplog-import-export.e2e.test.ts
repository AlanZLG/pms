/**
 * 台账导入 ↔ 导出端到端验证（临时库 + 真实 HTTP 服务 + 真实 xlsx 字节流）
 *
 * 覆盖闭环：
 *  - 手工 Excel → 导入：正常行入库、文件内重复行查重、缺「问题」行报错跳过、已完成缺经验字段放行+提醒
 *  - preview 预检：只统计不写库，重复/新行计数正确
 *  - 导出：表头为完整默认序（含「详细描述」），数据与导入值逐格一致
 *  - 导出文件回灌导入 → 全部识别为重复（备份-恢复闭环，不产生脏数据）
 *  - 模板下载 → 直接导入成功（模板→导入闭环）
 *  - skipDuplicates=false：重复行照导
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = 23000 + Math.floor(Math.random() * 20000)
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

/** multipart 上传导入台账 Excel */
async function importExcel(
  buf: Buffer,
  fields: Record<string, string>,
  token: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(buf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '台账.xlsx')
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  const res = await fetch(`${BASE}/op-logs/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

/** 构造导入 Excel：表头 = 固定列全序（序号第 1 列） */
const IMPORT_HEADERS = ['序号', '分类', '状态', '提出人', '系统', '部门', '日期', '记录人', '问题', '完成日', '工时', '详细描述', '原因', '解决方案']
async function buildExcel(rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('运维台账')
  ws.addRow(IMPORT_HEADERS)
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer() as unknown as ArrayBuffer)
}

/** 下载 xlsx 并解析表头 + 数据行（固定列均为文本/数值单元格） */
async function downloadSheet(url: string, token: string): Promise<{ status: number; headers: string[]; rows: string[][] }> {
  const res = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { status: res.status, headers: [], rows: [] }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer)
  const ws = wb.worksheets[0]
  const cellText = (v: ExcelJS.CellValue): string => (v == null || typeof v === 'object' ? '' : String(v))
  const headers: string[] = []
  ws.getRow(1).eachCell((cell) => headers.push(cellText(cell.value)))
  const rows: string[][] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row: string[] = []
    for (let c = 1; c <= headers.length; c++) row.push(cellText(ws.getCell(r, c).value))
    rows.push(row)
  }
  return { status: res.status, headers, rows }
}

// 导出默认表头（mergeFixedExportOrder([])：完整默认序，含「详细描述」与「登记日期」）
const DEFAULT_EXPORT_HEADERS = ['序号', '日期', '分类', '状态', '系统', '部门', '提出人', '记录人', '问题', '详细描述', '原因', '解决方案', '完成日', '工时', '登记日期']

// 导入文件数据行（行号 = 表头行 1 之后的物理行号）
const ROW_A: (string | number | null)[] = [1, '故障处理', '已完成', '张三', 'OA系统', '技术部', '2026-10-10', '李四', '登录页面报错', '2026-10-11', 2, '用户反馈无法登录，报500错误', '缓存服务异常', '重启缓存服务并清理过期key']
const ROW_B: (string | number | null)[] = [2, '日常巡检', '待处理', '', '验证系统', '', '2026-10-12', '王五', '巡检发现慢查询', '', 1, '', '', '']
// 与 A 同项目+日期+问题（仅空白/CRLF 差异，归一化后相同）→ 文件内重复
const ROW_C: (string | number | null)[] = [3, '故障处理', '已完成', '张三', 'OA系统', '技术部', '2026-10-10', '李四', ' 登录页面报错\r\n ', '2026-10-11', 2, '用户反馈无法登录，报500错误', '缓存服务异常', '重启缓存服务并清理过期key']
// 缺「问题」→ 报错跳过
const ROW_D: (string | number | null)[] = [4, '其他', '待处理', '', '', '', '2026-10-13', '', '', '', 0.5, '', '', '']
// 已完成但缺经验三字段 → 放行 + fieldWarning
const ROW_E: (string | number | null)[] = [5, '故障处理', '已完成', '', '', '', '2026-10-14', '', '磁盘告警未填经验', '', 0, '', '', '']

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fortune-e2e-io-'))
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

describe('台账导入 ↔ 导出（端到端 round-trip）', () => {
  let adminToken = ''
  let projectId = ''

  it('管理员登录（种子账号）', async () => {
    const r = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(r.status).toBe(200)
    adminToken = (r.json as { token: string }).token
  })

  it('建运维项目', async () => {
    const p = await req('POST', '/projects', {
      name: '导入导出验证项目', projectType: '运维项目', status: 'active', startDate: '2026-10-01',
    }, adminToken)
    expect(p.status).toBe(201)
    projectId = (p.json.project as { id: string }).id
  })

  it('首次导入：3 行入库 / 1 行文件内重复 / 1 行缺问题报错 / 1 行经验字段提醒', async () => {
    const buf = await buildExcel([ROW_A, ROW_B, ROW_C, ROW_D, ROW_E])
    const r = await importExcel(buf, { projectId }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.imported).toBe(3)
    expect(r.json.duplicateCount).toBe(1)
    expect(r.json.skipped).toBe(2)
    expect(JSON.stringify(r.json.duplicates)).toContain('第 4 行')
    expect(JSON.stringify(r.json.errors)).toContain('缺少「问题」')
    expect(r.json.fieldWarningCount).toBe(1)
    expect(JSON.stringify(r.json.fieldWarnings)).toContain('已完成但缺少')
  })

  it('preview 预检：不写库，重复/新行计数正确', async () => {
    const buf = await buildExcel([ROW_A, ROW_B, ROW_C, ROW_D, ROW_E])
    const r = await importExcel(buf, { projectId, mode: 'preview' }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.mode).toBe('preview')
    // 解析 4 行（缺问题行已跳过）；A/B/E 与库中重复、C 与文件内 A 重复 → 全部重复
    expect(r.json.total).toBe(4)
    expect(r.json.newCount).toBe(0)
    expect(r.json.duplicateCount).toBe(4)
  })

  it('导出：表头完整默认序（含详细描述），数据与导入值逐格一致', async () => {
    const { status, headers, rows } = await downloadSheet(`/op-logs/export.xlsx?projectId=${projectId}`, adminToken)
    expect(status).toBe(200)
    expect(headers).toEqual(DEFAULT_EXPORT_HEADERS)
    expect(rows).toHaveLength(3)
    // 导入文件指定的序号原样落库（1/2/5；文件内重复行未入库）
    expect(rows.map((r) => r[0]).sort()).toEqual(['1', '2', '5'])
    const a = rows.find((r) => r[8] === '登录页面报错')!
    expect(a).toEqual(['1', '2026-10-10', '故障处理', '已完成', 'OA系统', '技术部', '张三', '李四', '登录页面报错', '用户反馈无法登录，报500错误', '缓存服务异常', '重启缓存服务并清理过期key', '2026-10-11', '2', expect.any(String)])
    const b = rows.find((r) => r[8] === '巡检发现慢查询')!
    expect(b[1]).toBe('2026-10-12')
    expect(b[13]).toBe('1')
    const e = rows.find((r) => r[8] === '磁盘告警未填经验')!
    expect(e[9]).toBe('') // 详细描述为空原样导出
  })

  it('导出文件回灌导入 → 全部识别为重复，0 新增（备份-恢复闭环）', async () => {
    const { headers } = await downloadSheet(`/op-logs/export.xlsx?projectId=${projectId}`, adminToken)
    expect(headers).toEqual(DEFAULT_EXPORT_HEADERS)
    const res = await fetch(`${BASE}/op-logs/export.xlsx?projectId=${projectId}`, { headers: { Authorization: `Bearer ${adminToken}` } })
    const buf = Buffer.from(await res.arrayBuffer())
    const r = await importExcel(buf, { projectId }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.imported).toBe(0)
    expect(r.json.duplicateCount).toBe(3)
    expect(r.json.errors).toEqual([])
    // 回灌后总量不变
    const after = await downloadSheet(`/op-logs/export.xlsx?projectId=${projectId}`, adminToken)
    expect(after.rows).toHaveLength(3)
  })

  it('模板下载：表头为 14 个固定列 + 自定义列示例，含示例行', async () => {
    const { status, headers, rows } = await downloadSheet('/op-logs/template.xlsx', adminToken)
    expect(status).toBe(200)
    expect(headers.slice(0, 14)).toEqual(IMPORT_HEADERS)
    expect(headers[14]).toBe('自定义列示例')
    expect(rows[0]?.[8]).toBe('登录页面报错')
  })

  it('模板直接导入成功（模板→导入闭环）', async () => {
    const p = await req('POST', '/projects', {
      name: '模板闭环项目', projectType: '运维项目', status: 'active', startDate: '2026-10-01',
    }, adminToken)
    expect(p.status).toBe(201)
    const projectId2 = (p.json.project as { id: string }).id
    const res = await fetch(`${BASE}/op-logs/template.xlsx`, { headers: { Authorization: `Bearer ${adminToken}` } })
    const buf = Buffer.from(await res.arrayBuffer())
    const r = await importExcel(buf, { projectId: projectId2 }, adminToken)
    expect(r.status).toBe(200)
    // 模板自带 1 行示例（「自定义列示例」列本身不导入）
    expect(r.json.imported).toBe(1)
    expect(r.json.duplicateCount).toBe(0)
    expect(r.json.unknownColumns).toEqual([])
  })

  it('skipDuplicates=false：重复行照导，不静默丢弃', async () => {
    const buf = await buildExcel([ROW_A, ROW_B, ROW_C, ROW_D, ROW_E])
    const r = await importExcel(buf, { projectId, skipDuplicates: 'false' }, adminToken)
    expect(r.status).toBe(200)
    // A/B/C/E 全部写入（含重复），仅缺问题行报错跳过
    expect(r.json.imported).toBe(4)
    expect(r.json.duplicateCount).toBe(0)
    expect(JSON.stringify(r.json.errors)).toContain('缺少「问题」')
    const { rows } = await downloadSheet(`/op-logs/export.xlsx?projectId=${projectId}`, adminToken)
    expect(rows).toHaveLength(7)
  })

  it('表头归一化：全角括号/空格的配置列「实绩工数（小时）」仍匹配入库，不被静默丢弃', async () => {
    // 启用项目自定义列配置（字段库种子含「实绩工数(小时)」number 型与「对应日」date 型）
    const cfg = await req('PUT', `/projects/${projectId}/oplog-columns`, {
      enabled: true,
      columns: [{ key: '实绩工数(小时)' }, { key: '对应日' }],
    }, adminToken)
    expect(cfg.status).toBe(200)
    // 文件表头故意使用中文 Excel 常见写法：全角括号 + 尾随全角空格
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('运维台账')
    ws.addRow(['分类', '状态', '日期', '问题', '记录人', '实绩工数（小时）\u3000', '对应日'])
    ws.addRow(['故障处理', '已完成', '2026-10-15', '全角表头冒烟验证', '甲', 1.5, '2026-10-15'])
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as unknown as ArrayBuffer)
    const r = await importExcel(buf, { projectId }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.imported).toBe(1)
    expect(r.json.unknownColumns).toEqual([]) // 未被当作未识别列丢弃
    const list = await req('GET', `/op-logs?projectId=${projectId}&keyword=${encodeURIComponent('全角表头冒烟验证')}`, undefined, adminToken)
    const log = (list.json.logs as Array<{ extraFields: Record<string, string> }>)[0]
    expect(log.extraFields['实绩工数(小时)']).toBe('1.50') // 归一到库键（半角括号）+ number 型 2 位小数
    expect(log.extraFields['对应日']).toBe('2026-10-15')
  })
})
