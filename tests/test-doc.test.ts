// 测试文档（v1.12）：类 Excel 网格 + 版本快照 + 回收站 + 权限矩阵 + Excel 导入导出
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import ExcelJS from 'exceljs'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import app from '../api/app.ts'
import db from '../api/db.ts'
import { seedUser, seedProject } from './helpers/test-db'
import {
  testDocRepo, computeDocChangeSummary, TEST_DOC_VERSION_RETENTION,
} from '../api/repository/repo.ts'
import { ApiError } from '../api/lib/utils.ts'
import type { TestDocColumn, TestDocRow } from '../shared/types.ts'

// ---------- 公共夹具 ----------

function makeGrid(): { columns: TestDocColumn[]; rows: TestDocRow[] } {
  return {
    columns: [
      { id: 'c1', label: '用例编号', width: 90 },
      { id: 'c2', label: '用例标题', width: 200 },
    ],
    rows: [
      { id: 'r1', cells: { c1: 'TC-01', c2: '登录成功' } },
      { id: 'r2', cells: { c1: 'TC-02', c2: '登录失败' } },
    ],
  }
}

// ---------- Part A：repo 层（变更摘要 / 版本快照 / 乐观锁 / 回收站） ----------

describe('computeDocChangeSummary：新旧网格 diff 摘要', () => {
  it('完全一致 → 无内容变更', () => {
    const { columns, rows } = makeGrid()
    expect(computeDocChangeSummary(columns, rows, columns, rows)).toBe('无内容变更')
  })

  it('修改单元格 → 修改 N 个单元格', () => {
    const { columns, rows } = makeGrid()
    const newRows = rows.map((r) => (r.id === 'r1' ? { ...r, cells: { ...r.cells, c2: '登录成功（改）' } } : r))
    expect(computeDocChangeSummary(columns, rows, columns, newRows)).toBe('修改 1 个单元格')
  })

  it('新增/删除行、新增/删除/重命名列、标题变更 → 各部分用 · 连接', () => {
    const { columns, rows } = makeGrid()
    const newColumns: TestDocColumn[] = [
      { id: 'c1', label: '用例编号', width: 90 },
      { id: 'c3', label: '优先级', width: 80 }, // 新增列
      // c2 被删除
    ]
    const newRows: TestDocRow[] = [
      { id: 'r1', cells: { c1: 'TC-01', c3: '高' } }, // r2 被删除
      { id: 'r3', cells: { c1: 'TC-03', c3: '中' } }, // 新增行
    ]
    // r1 行从 {c1,c2} 变为 {c1,c3}：c2 清空 + c3 新增，共 2 个单元格变化
    expect(
      computeDocChangeSummary(columns, rows, newColumns, newRows, { from: '旧标题', to: '新标题' }),
    ).toBe('新增列 优先级 · 删除列 用例标题 · 新增 1 行 · 删除 1 行 · 修改 2 个单元格 · 标题改为「新标题」')
  })

  it('列重命名 → 重命名列 X', () => {
    const { columns, rows } = makeGrid()
    const newColumns = columns.map((c) => (c.id === 'c2' ? { ...c, label: '用例名称' } : c))
    expect(computeDocChangeSummary(columns, rows, newColumns, rows)).toBe('重命名列 用例名称')
  })

  it('空字符串与缺 key 等价：cells 里值为空串 → 删掉该 key 视为未变更', () => {
    const columns: TestDocColumn[] = [{ id: 'c1', label: '用例编号', width: 90 }]
    const oldRows: TestDocRow[] = [{ id: 'r1', cells: { c1: 'TC-01', extra: '' } }]
    const newRows: TestDocRow[] = [{ id: 'r1', cells: { c1: 'TC-01' } }]
    expect(computeDocChangeSummary(columns, oldRows, columns, newRows)).toBe('无内容变更')
  })
})

describe('testDocRepo：CRUD / 版本快照 / 乐观锁 / 回收站', () => {
  let ownerId: string
  let memberId: string
  let pid: string
  let docId: string
  let grid: { columns: TestDocColumn[]; rows: TestDocRow[] }

  beforeEach(() => {
    for (const t of ['test_doc_versions', 'test_docs', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
    ownerId = seedUser(db, { email: 'td-owner@pm.dev', name: '负责人' })
    memberId = seedUser(db, { email: 'td-member@pm.dev', name: '成员' })
    pid = seedProject(db, ownerId, { name: '测试文档项目' })
    grid = makeGrid()
    docId = testDocRepo.create({ projectId: pid, title: '登录模块用例', columns: grid.columns, rows: grid.rows, userId: ownerId }).id
  })

  it('create：v1 落快照「创建文档」，联查创建人姓名', () => {
    const doc = testDocRepo.findById(docId)!
    expect(doc.version).toBe(1)
    expect(doc.createdById).toBe(ownerId)
    expect(doc.createdByName).toBe('负责人')
    expect(doc.deletedAt).toBeNull()
    const v1 = testDocRepo.getVersion(docId, 1)!
    expect(v1.changeSummary).toBe('创建文档')
    expect(v1.rows).toEqual(grid.rows)
    expect(testDocRepo.listVersions(docId)).toHaveLength(1)
  })

  it('findByProject：只返回未删除文档，按创建时间倒序', () => {
    testDocRepo.create({ projectId: pid, title: '第二个文档', columns: grid.columns, rows: [], userId: memberId })
    // 手动把第一个文档时间提前，制造可排序的时间差
    db.prepare("UPDATE test_docs SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(docId)
    const list = testDocRepo.findByProject(pid)
    expect(list).toHaveLength(2)
    expect(list[0].title).toBe('第二个文档')
    expect(list[1].title).toBe('登录模块用例')
    // 其他项目不可见
    const otherPid = seedProject(db, ownerId, { name: '别的项目' })
    expect(testDocRepo.findByProject(otherPid)).toHaveLength(0)
  })

  it('update：版本 +1 落快照，摘要自动 diff', () => {
    const newRows = grid.rows.map((r) => (r.id === 'r1' ? { ...r, cells: { ...r.cells, c2: '登录成功（改）' } } : r))
    const updated = testDocRepo.update(docId, { columns: grid.columns, rows: newRows, userId: memberId })
    expect(updated.version).toBe(2)
    const versions = testDocRepo.listVersions(docId)
    expect(versions).toHaveLength(2)
    expect(versions[0].version).toBe(2)
    expect(versions[0].changeSummary).toBe('修改 1 个单元格')
    expect(versions[0].editedByName).toBe('成员')
  })

  it('update：仅改标题 → 摘要「标题改为」，内容不变也产生新版本', () => {
    const updated = testDocRepo.update(docId, {
      title: '登录模块用例 V2', columns: grid.columns, rows: grid.rows, userId: ownerId,
    })
    expect(updated.version).toBe(2)
    expect(updated.title).toBe('登录模块用例 V2')
    expect(testDocRepo.listVersions(docId)[0].changeSummary).toBe('标题改为「登录模块用例 V2」')
  })

  it('update：内容无变更 → 跳过，版本不递增', () => {
    const updated = testDocRepo.update(docId, { columns: grid.columns, rows: grid.rows, userId: ownerId })
    expect(updated.version).toBe(1)
    expect(testDocRepo.listVersions(docId)).toHaveLength(1)
  })

  it('update：baseVersion 过期 → 409 乐观锁冲突', () => {
    const e = (() => {
      try {
        testDocRepo.update(docId, { columns: grid.columns, rows: grid.rows, userId: memberId, baseVersion: 99 })
        return null
      } catch (err) {
        return err as ApiError
      }
    })()
    expect(e).not.toBeNull()
    expect(e!.status).toBe(409)
    expect(e!.message).toBe('文档已被他人修改，请刷新后重试')
  })

  it('rollback：回滚到 v1 产生新版本，内容与 v1 一致且履历可追溯', () => {
    const newRows = grid.rows.map((r) => ({ ...r, cells: { c1: 'X', c2: 'Y' } }))
    testDocRepo.update(docId, { columns: grid.columns, rows: newRows, userId: memberId }) // v2
    const rolled = testDocRepo.rollback(docId, 1, ownerId) // v3
    expect(rolled.version).toBe(3)
    expect(rolled.rows).toEqual(grid.rows) // 内容回到 v1
    const versions = testDocRepo.listVersions(docId)
    expect(versions[0].changeSummary).toBe('回滚到 v1')
    // 回滚产生的是新版本而非删版本：v2 快照仍在
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1])
  })

  it('rollback：版本不存在 → 404', () => {
    expect(() => testDocRepo.rollback(docId, 999, ownerId)).toThrowError(ApiError)
  })

  it(`版本快照保留最近 ${TEST_DOC_VERSION_RETENTION} 版，最旧版本被清理`, () => {
    expect(TEST_DOC_VERSION_RETENTION).toBe(50)
    let current = grid
    for (let i = 0; i < 55; i++) {
      const rows = current.rows.map((r) => (r.id === 'r1' ? { ...r, cells: { ...r.cells, c2: `内容-${i}` } } : r))
      current = { columns: current.columns, rows }
      testDocRepo.update(docId, { columns: current.columns, rows, userId: ownerId })
    }
    const doc = testDocRepo.findById(docId)!
    expect(doc.version).toBe(56)
    const versions = testDocRepo.listVersions(docId)
    expect(versions).toHaveLength(50)
    expect(versions[0].version).toBe(56)
    expect(versions[49].version).toBe(7) // v1~v6 已清理
    expect(testDocRepo.getVersion(docId, 1)).toBeNull()
    expect(testDocRepo.getVersion(docId, 7)).not.toBeNull()
  })

  it('软删除 → 回收站可查（含项目名）→ 恢复后回到列表', () => {
    testDocRepo.softDelete(docId, ownerId)
    expect(testDocRepo.findById(docId)).toBeNull()
    expect(testDocRepo.findByProject(pid)).toHaveLength(0)
    const trash = testDocRepo.findTrash()
    expect(trash).toHaveLength(1)
    expect(trash[0].projectName).toBe('测试文档项目')
    expect(trash[0].title).toBe('登录模块用例')
    testDocRepo.restore(docId)
    expect(testDocRepo.findById(docId)).not.toBeNull()
    expect(testDocRepo.findTrash()).toHaveLength(0)
  })

  it('physicalDelete：文档与全部版本快照级联清除', () => {
    testDocRepo.softDelete(docId, ownerId)
    testDocRepo.physicalDelete(docId)
    expect(testDocRepo.findByIdWithTrash(docId)).toBeNull()
    expect(testDocRepo.findTrash()).toHaveLength(0)
    const count = db.prepare('SELECT COUNT(*) AS n FROM test_doc_versions WHERE doc_id = ?').get(docId) as { n: number }
    expect(count.n).toBe(0)
  })
})

// ---------- Part B：HTTP 层（权限矩阵 / 通知 / Excel 导入导出 / 回收站聚合） ----------

describe('测试文档 HTTP：权限/通知/导入导出', () => {
  let server: ReturnType<typeof app.listen>
  let base = ''

  type Json = Record<string, unknown>
  async function req(method: string, path: string, { token, body }: { token?: string; body?: Json } = {}) {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json }
  }

  // 登录限流 10 次/分钟：固定用户 ID + 缓存 token（与 oplog-custom-field-perm 同策略）
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

  function ownerNotifications(): { type: string; title: string; body: string }[] {
    return db.prepare("SELECT type, title, body FROM notifications WHERE user_id = 'u-owner' ORDER BY created_at").all() as { type: string; title: string; body: string }[]
  }

  let projectId: string
  let docId: string

  beforeAll(async () => {
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    for (const t of ['test_doc_versions', 'test_docs', 'notifications', 'audit_logs', 'project_activity_log', 'project_members', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
    // 固定 ID：保证缓存 token 跨用例有效
    seedUser(db, { id: 'u-admin', email: 'tdd-admin@pm.dev', name: '管理员', role: 'admin' })
    const ownerId = seedUser(db, { id: 'u-owner', email: 'tdd-owner@pm.dev', name: '负责人', role: 'member' })
    const memberId = seedUser(db, { id: 'u-member', email: 'tdd-member@pm.dev', name: '成员', role: 'member' })
    seedUser(db, { id: 'u-out', email: 'tdd-out@pm.dev', name: '路人', role: 'member' })
    seedUser(db, { id: 'u-guest', email: 'tdd-guest@pm.dev', name: '访客', role: 'guest' })
    projectId = seedProject(db, ownerId, { name: 'HTTP 测试项目' })
    db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
      .run(crypto.randomUUID(), projectId, memberId, 'editor')
    db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?,?,?,?)')
      .run(crypto.randomUUID(), projectId, 'u-guest', 'viewer')
    docId = testDocRepo.create({
      projectId, title: '登录模块用例',
      columns: [{ id: 'c1', label: '用例编号', width: 90 }, { id: 'c2', label: '用例标题', width: 200 }],
      rows: [{ id: 'r1', cells: { c1: 'TC-01', c2: '登录成功' } }],
      userId: ownerId,
    }).id
  })

  it('未登录 → 401；路人（非成员）→ 403', async () => {
    expect((await req('GET', `/api/projects/${projectId}/test-docs`)).status).toBe(401)
    const outToken = await loginAs('tdd-out@pm.dev')
    const r = await req('GET', `/api/projects/${projectId}/test-docs`, { token: outToken })
    expect(r.status).toBe(403)
    expect((r.json as { error: string }).error).toBe('无权查看该项目')
  })

  it('成员新建文档（默认测试用例模板 7 列）→ 201，负责人收到 type=doc 通知', async () => {
    const token = await loginAs('tdd-member@pm.dev')
    const r = await req('POST', `/api/projects/${projectId}/test-docs`, { token, body: { title: '下单流程用例' } })
    expect(r.status).toBe(201)
    const doc = (r.json as { testDoc: { version: number; columns: { label: string }[]; createdByName: string } }).testDoc
    expect(doc.version).toBe(1)
    expect(doc.columns.map((c) => c.label)).toEqual(['用例编号', '所属模块', '用例标题', '测试步骤', '预期结果', '实际结果', '执行状态'])
    expect(doc.createdByName).toBe('成员')
    const notes = ownerNotifications()
    expect(notes).toHaveLength(1)
    expect(notes[0].type).toBe('doc')
    expect(notes[0].title).toBe('成员 创建了测试文档《下单流程用例》')
  })

  it('负责人自己新建 → 不给自己发通知', async () => {
    const token = await loginAs('tdd-owner@pm.dev')
    const r = await req('POST', `/api/projects/${projectId}/test-docs`, { token, body: { title: '自建文档' } })
    expect(r.status).toBe(201)
    expect(ownerNotifications()).toHaveLength(0)
  })

  it('访客 guest 只读：列表可看（200），新建/保存 → 403', async () => {
    const token = await loginAs('tdd-guest@pm.dev')
    expect((await req('GET', `/api/projects/${projectId}/test-docs`, { token })).status).toBe(200)
    const create = await req('POST', `/api/projects/${projectId}/test-docs`, { token, body: { title: '越权' } })
    expect(create.status).toBe(403)
    expect((create.json as { error: string }).error).toBe('访客只读，无权编辑测试文档')
    const save = await req('PUT', `/api/test-docs/${docId}`, {
      token,
      body: { columns: [{ id: 'c1', label: '列', width: 80 }], rows: [] },
    })
    expect(save.status).toBe(403)
  })

  it('成员保存修改 → 版本 +1，负责人收到修改履历通知（标题+摘要）', async () => {
    const token = await loginAs('tdd-member@pm.dev')
    const r = await req('PUT', `/api/test-docs/${docId}`, {
      token,
      body: {
        baseVersion: 1,
        columns: [{ id: 'c1', label: '用例编号', width: 90 }, { id: 'c2', label: '用例标题', width: 200 }],
        rows: [{ id: 'r1', cells: { c1: 'TC-01', c2: '登录成功（修正）' } }],
      },
    })
    expect(r.status).toBe(200)
    const doc = (r.json as { testDoc: { version: number } }).testDoc
    expect(doc.version).toBe(2)
    const notes = ownerNotifications()
    expect(notes).toHaveLength(1)
    expect(notes[0].type).toBe('doc')
    expect(notes[0].title).toBe('成员 修改了测试文档《登录模块用例》')
    expect(notes[0].body).toContain('v2')
    expect(notes[0].body).toContain('修改 1 个单元格')
  })

  it('保存带过期 baseVersion → 409', async () => {
    const token = await loginAs('tdd-member@pm.dev')
    const r = await req('PUT', `/api/test-docs/${docId}`, {
      token,
      body: {
        baseVersion: 99,
        columns: [{ id: 'c1', label: '用例编号', width: 90 }],
        rows: [{ id: 'r1', cells: { c1: 'X' } }],
      },
    })
    expect(r.status).toBe(409)
    expect((r.json as { error: string }).error).toBe('文档已被他人修改，请刷新后重试')
  })

  it('版本履历与快照：成员可查版本列表与 v1 内容；回滚产生新版本', async () => {
    const token = await loginAs('tdd-member@pm.dev')
    const list = await req('GET', `/api/test-docs/${docId}/versions`, { token })
    expect(list.status).toBe(200)
    expect((list.json as { versions: { version: number }[] }).versions.map((v) => v.version)).toEqual([1])
    const snap = await req('GET', `/api/test-docs/${docId}/versions/1`, { token })
    expect(snap.status).toBe(200)
    expect((snap.json as { version: { rows: { cells: Record<string, string> }[] } }).version.rows[0].cells.c2).toBe('登录成功')
    const rolled = await req('POST', `/api/test-docs/${docId}/rollback`, { token, body: { version: 1 } })
    expect(rolled.status).toBe(200)
    expect((rolled.json as { testDoc: { version: number } }).testDoc.version).toBe(2)
    const notes = ownerNotifications()
    expect(notes[0].title).toContain('回滚到 v1')
  })

  it('删除权限矩阵：成员删除 → 403；负责人软删除 → 回收站；成员恢复 → 403；负责人恢复 → 200', async () => {
    const memberToken = await loginAs('tdd-member@pm.dev')
    const ownerToken = await loginAs('tdd-owner@pm.dev')

    const memberDelete = await req('DELETE', `/api/test-docs/${docId}`, { token: memberToken })
    expect(memberDelete.status).toBe(403)
    expect((memberDelete.json as { error: string }).error).toBe('仅项目负责人可删除测试文档')

    const ownerDelete = await req('DELETE', `/api/test-docs/${docId}`, { token: ownerToken })
    expect(ownerDelete.status).toBe(200)

    // 回收站聚合接口包含测试文档（含所属项目名）
    const trash = await req('GET', '/api/trash', { token: ownerToken })
    expect(trash.status).toBe(200)
    const docs = (trash.json as { testDocs: { id: string; projectName: string }[] }).testDocs
    expect(docs.some((d) => d.id === docId && d.projectName === 'HTTP 测试项目')).toBe(true)

    const memberRestore = await req('POST', `/api/test-docs/${docId}/restore`, { token: memberToken })
    expect(memberRestore.status).toBe(403)

    const ownerRestore = await req('POST', `/api/test-docs/${docId}/restore`, { token: ownerToken })
    expect(ownerRestore.status).toBe(200)
    const trashAfter = await req('GET', '/api/trash', { token: ownerToken })
    expect((trashAfter.json as { testDocs: unknown[] }).testDocs).toHaveLength(0)
  })

  it('彻底删除：负责人可彻底删除，文档与版本快照一并清除', async () => {
    const ownerToken = await loginAs('tdd-owner@pm.dev')
    await req('DELETE', `/api/test-docs/${docId}`, { token: ownerToken })
    const r = await req('DELETE', `/api/test-docs/${docId}/physical`, { token: ownerToken })
    expect(r.status).toBe(200)
    expect(testDocRepo.findByIdWithTrash(docId)).toBeNull()
    const memberToken = await loginAs('tdd-member@pm.dev')
    const again = await req('DELETE', `/api/test-docs/${docId}/physical`, { token: memberToken })
    expect(again.status).toBe(404)
  })

  it('从 Excel 导入创建：首行表头 → 列定义，空行剔除，负责人收到导入通知', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.addRow(['用例编号', '用例标题'])
    ws.addRow(['TC-01', '登录成功'])
    ws.addRow([null, null]) // 空行应剔除
    ws.addRow(['TC-02', '登录失败'])
    const buf = Buffer.from(await wb.xlsx.writeBuffer())

    const token = await loginAs('tdd-member@pm.dev')
    const form = new FormData()
    form.append('file', new Blob([buf]), '登录用例.xlsx')
    form.append('title', '导入的登录用例')
    const res = await fetch(`${base}/api/projects/${projectId}/test-docs/import`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    })
    expect(res.status).toBe(201)
    const doc = (await res.json() as { testDoc: { version: number; columns: { id: string; label: string }[]; rows: { cells: Record<string, string> }[] } }).testDoc
    expect(doc.version).toBe(1)
    expect(doc.columns.map((c) => c.label)).toEqual(['用例编号', '用例标题'])
    expect(doc.rows).toHaveLength(2) // 空行被剔除
    expect(doc.rows[0].cells[doc.columns[0].id]).toBe('TC-01')
    expect(doc.rows[1].cells[doc.columns[1].id]).toBe('登录失败')

    const notes = ownerNotifications()
    expect(notes).toHaveLength(1)
    expect(notes[0].type).toBe('doc')
    expect(notes[0].title).toBe('成员 导入了测试文档《导入的登录用例》')
    expect(notes[0].body).toContain('2 行 · 2 列')
  })

  it('导入非 xlsx 内容 → 400', async () => {
    const token = await loginAs('tdd-member@pm.dev')
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('这不是 Excel')]), 'fake.xlsx')
    const res = await fetch(`${base}/api/projects/${projectId}/test-docs/import`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('无法解析该文件，请上传有效的 .xlsx 文件')
  })

  it('导出 Excel：与在线内容同构（表头+数据行），文件名 UTF-8 编码', async () => {
    const token = await loginAs('tdd-member@pm.dev')
    const raw = await fetch(`${base}/api/test-docs/${docId}/export.xlsx`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(raw.status).toBe(200)
    expect(raw.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(raw.headers.get('content-disposition')).toContain(encodeURIComponent('登录模块用例.xlsx'))

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await raw.arrayBuffer()))
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).getCell(1).value).toBe('用例编号')
    expect(ws.getRow(1).getCell(2).value).toBe('用例标题')
    expect(ws.getRow(2).getCell(1).value).toBe('TC-01')
    expect(ws.getRow(2).getCell(2).value).toBe('登录成功')
    expect(ws.rowCount).toBe(2)
  })

  it('导出：路人 → 403', async () => {
    const outToken = await loginAs('tdd-out@pm.dev')
    const raw = await fetch(`${base}/api/test-docs/${docId}/export.xlsx`, {
      headers: { Authorization: `Bearer ${outToken}` },
    })
    expect(raw.status).toBe(403)
  })
})
