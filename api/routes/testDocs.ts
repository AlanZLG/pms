// 测试文档路由
// 路径说明:
//   - 项目内:  /projects/:projectId/test-docs（列表/新建/Excel 导入）
//   - 单文档:  /test-docs/:id（读写/版本履历/回滚/Excel 导出/删除/恢复）
// 权限模型:
//   - 查看/在线编辑/保存/导入/导出：项目成员即可（访客 guest 只读）
//   - 删除/恢复：仅项目负责人或 admin（成员 403）；删除为软删除进回收站，可随时恢复

import { Router, type Response, type NextFunction } from 'express'
import multer from 'multer'
import ExcelJS from 'exceljs'
import crypto from 'crypto'
import { z } from 'zod'
import { testDocRepo, projectRepo, userRepo, notificationRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { assertProjectReadAccess } from './projects.ts'
import { ApiError } from '../lib/utils.ts'
import type { Project, TestDoc, TestDocColumn, TestDocRow } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } })

// 新建文档的默认列（测试用例模板）
const DEFAULT_COLUMNS: TestDocColumn[] = [
  { id: 'col-case', label: '用例编号', width: 90 },
  { id: 'col-module', label: '所属模块', width: 120 },
  { id: 'col-title', label: '用例标题', width: 200 },
  { id: 'col-steps', label: '测试步骤', width: 240 },
  { id: 'col-expected', label: '预期结果', width: 200 },
  { id: 'col-actual', label: '实际结果', width: 200 },
  { id: 'col-status', label: '执行状态', width: 90 },
]

const contentSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200).optional(),
  baseVersion: z.number().int().optional(),
  columns: z.array(z.object({
    id: z.string().min(1),
    label: z.string().trim().min(1, '列名不能为空').max(100),
    width: z.number().int().min(40).max(600),
  })).min(1, '至少保留一列').max(50),
  rows: z.array(z.object({
    id: z.string().min(1),
    cells: z.record(z.string()),
  })).max(2000, '行数超出上限（2000 行）'),
})

// 校验并取出网格内容（safeParse 已在运行时保证形状，这里仅做类型收窄）
function parseDocContent(body: unknown): { title?: string; baseVersion?: number; columns: TestDocColumn[]; rows: TestDocRow[] } {
  const parsed = contentSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message || '保存内容格式不正确')
  }
  return {
    title: parsed.data.title,
    baseVersion: parsed.data.baseVersion,
    columns: parsed.data.columns as TestDocColumn[],
    rows: parsed.data.rows as TestDocRow[],
  }
}

// ---------- 权限守卫 ----------

// 读取：复用项目读取守卫（admin/finance 全局，其余须为负责人或成员）
function requireProjectRead(req: AuthRequest, projectId: string): Project {
  return assertProjectReadAccess(userRepo.findById(req.userId!), projectId)
}

// 编辑：项目成员即可，系统访客（guest）只读
function requireProjectEdit(req: AuthRequest, projectId: string): { project: Project; userName: string } {
  const project = requireProjectRead(req, projectId)
  const user = userRepo.findById(req.userId!)!
  if (user.role === 'guest') throw new ApiError(403, '访客只读，无权编辑测试文档')
  return { project, userName: user.name }
}

// 删除/恢复：仅项目负责人或 admin（成员不可删除，按需求硬性限制）
function requireDocManage(req: AuthRequest, doc: TestDoc): { project: Project; userName: string } {
  const project = projectRepo.findById(doc.projectId)
  if (!project) throw new ApiError(404, '项目不存在')
  const user = userRepo.findById(req.userId!)!
  if (project.ownerId !== user.id && user.role !== 'admin') {
    throw new ApiError(403, '仅项目负责人可删除测试文档')
  }
  return { project, userName: user.name }
}

// 负责人知会：编辑人非负责人本人时，向负责人推送修改履历通知（失败不影响主流程）
function notifyDocOwner(project: Project, operatorId: string, title: string, body: string): void {
  if (!project.ownerId || project.ownerId === operatorId) return
  try {
    notificationRepo.create({ userId: project.ownerId, type: 'doc', title, body, projectId: project.id })
  } catch {
    // 通知失败不影响保存主流程
  }
}

// ---------- Excel 辅助 ----------

/** ExcelJS 单元格值统一转文本（兼容富文本/公式结果/日期） */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as { richText?: { text: string }[]; result?: unknown; text?: unknown }
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    const r = v.result ?? v.text
    return r === null || r === undefined ? '' : String(r)
  }
  return String(value)
}

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  row.height = 25
}

// ---------- 项目内路由 ----------

// 列表
router.get('/projects/:projectId/test-docs', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireProjectRead(req, req.params.projectId)
    res.json({ testDocs: testDocRepo.findByProject(req.params.projectId) })
  } catch (e) { next(e) }
})

// 新建（成员也可新建，默认测试用例模板列）
router.post('/projects/:projectId/test-docs', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { project, userName } = requireProjectEdit(req, req.params.projectId)
    const title = String(req.body?.title || '').trim()
    if (!title) throw new ApiError(400, '请填写文档标题')
    const columns = Array.isArray(req.body?.columns) && req.body.columns.length > 0
      ? parseDocContent({ columns: req.body.columns }).columns
      : DEFAULT_COLUMNS
    const testDoc = testDocRepo.create({ projectId: project.id, title, columns, rows: [], userId: req.userId! })
    notifyDocOwner(project, req.userId!, `${userName} 创建了测试文档《${title}》`, `v1 · 空白文档（${columns.length} 列）`)
    res.status(201).json({ testDoc })
  } catch (e) { next(e) }
})

// 从 Excel 导入创建：首行为表头列，其余行为数据
router.post('/projects/:projectId/test-docs/import', upload.single('file'), (req: AuthRequest, res: Response, next: NextFunction) => {
  (async () => {
    const { project, userName } = requireProjectEdit(req, req.params.projectId)
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file
    if (!file) throw new ApiError(400, '请选择 xlsx 文件')
    const title = String(req.body?.title || '').trim() || file.originalname.replace(/\.xlsx$/i, '') || '导入的测试文档'

    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(file.buffer)
    } catch {
      throw new ApiError(400, '无法解析该文件，请上传有效的 .xlsx 文件')
    }
    const ws = workbook.worksheets[0]
    if (!ws || ws.rowCount < 1) throw new ApiError(400, 'Excel 内容为空')

    // 首行表头 → 列定义（空表头跳过并剔除该列）
    const headerRow = ws.getRow(1)
    const columnMap: { id: string; colIndex: number }[] = []
    const columns: TestDocColumn[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell, colIndex) => {
      const label = cellText(cell.value).trim()
      if (!label || columns.length >= 50) return
      const id = `c${colIndex}`
      columns.push({ id, label, width: Math.min(600, Math.max(80, label.length * 14 + 40)) })
      columnMap.push({ id, colIndex })
    })
    if (columns.length === 0) throw new ApiError(400, 'Excel 首行未识别到表头')

    // 其余行 → 行数据
    const rows: TestDocRow[] = []
    for (let r = 2; r <= ws.rowCount && rows.length < 2000; r++) {
      const row = ws.getRow(r)
      const cells: Record<string, string> = {}
      let hasValue = false
      for (const { id, colIndex } of columnMap) {
        const text = cellText(row.getCell(colIndex).value)
        cells[id] = text
        if (text) hasValue = true
      }
      if (hasValue) rows.push({ id: crypto.randomUUID(), cells })
    }

    const testDoc = testDocRepo.create({ projectId: project.id, title, columns, rows, userId: req.userId! })
    notifyDocOwner(project, req.userId!, `${userName} 导入了测试文档《${title}》`, `v1 · ${rows.length} 行 · ${columns.length} 列`)
    res.status(201).json({ testDoc })
  })().catch(next)
})

// ---------- 单文档路由 ----------

// 详情（含网格内容）
router.get('/test-docs/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    requireProjectRead(req, doc.projectId)
    res.json({ testDoc: doc })
  } catch (e) { next(e) }
})

// 保存（乐观锁 + 版本快照 + 负责人通知）
router.put('/test-docs/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    const { project, userName } = requireProjectEdit(req, doc.projectId)
    const content = parseDocContent(req.body)
    const updated = testDocRepo.update(doc.id, {
      title: content.title,
      columns: content.columns,
      rows: content.rows,
      userId: req.userId!,
      baseVersion: content.baseVersion,
    })
    const summary = testDocRepo.listVersions(updated.id)[0]?.changeSummary || ''
    notifyDocOwner(project, req.userId!, `${userName} 修改了测试文档《${updated.title}》`, `v${updated.version} · ${summary}`)
    res.json({ testDoc: updated })
  } catch (e) { next(e) }
})

// 修改履历（版本列表，不含内容）
router.get('/test-docs/:id/versions', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    requireProjectRead(req, doc.projectId)
    res.json({ versions: testDocRepo.listVersions(doc.id) })
  } catch (e) { next(e) }
})

// 版本快照详情（只读回看）
router.get('/test-docs/:id/versions/:version', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    requireProjectRead(req, doc.projectId)
    const version = testDocRepo.getVersion(doc.id, Number(req.params.version))
    if (!version) throw new ApiError(404, '版本不存在')
    res.json({ version })
  } catch (e) { next(e) }
})

// 回滚到指定版本（产生新版本，履历可追溯）
router.post('/test-docs/:id/rollback', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    const { project, userName } = requireProjectEdit(req, doc.projectId)
    const version = Number(req.body?.version)
    if (!Number.isInteger(version)) throw new ApiError(400, '请指定要回滚的版本号')
    const updated = testDocRepo.rollback(doc.id, version, req.userId!)
    notifyDocOwner(project, req.userId!, `${userName} 将测试文档《${updated.title}》回滚到 v${version}`, `当前版本 v${updated.version}`)
    res.json({ testDoc: updated })
  } catch (e) { next(e) }
})

// 导出 Excel（随时可下，与在线内容同构）
router.get('/test-docs/:id/export.xlsx', (req: AuthRequest, res: Response, next: NextFunction) => {
  (async () => {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    requireProjectRead(req, doc.projectId)

    const workbook = new ExcelJS.Workbook()
    workbook.creator = '项目管理系统'
    workbook.created = new Date()
    const ws = workbook.addWorksheet(doc.title.slice(0, 31) || '测试文档') // sheet 名上限 31 字符

    const header = ws.addRow(doc.columns.map((c) => c.label))
    applyHeaderStyle(header)
    for (const row of doc.rows) {
      ws.addRow(doc.columns.map((c) => row.cells[c.id] ?? ''))
    }
    doc.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.round(c.width / 7) || 14 })
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    const filename = encodeURIComponent(`${doc.title}.xlsx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    await workbook.xlsx.write(res)
    res.end()
  })().catch(next)
})

// 删除（软删除进回收站，仅项目负责人/admin）
router.delete('/test-docs/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findById(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    requireDocManage(req, doc)
    testDocRepo.softDelete(doc.id, req.userId!)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 从回收站恢复（随时可恢复，仅项目负责人/admin）
router.post('/test-docs/:id/restore', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findByIdWithTrash(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    if (!doc.deletedAt) throw new ApiError(400, '文档未在回收站中')
    requireDocManage(req, doc)
    testDocRepo.restore(doc.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 彻底删除（回收站内，仅项目负责人/admin）
router.delete('/test-docs/:id/physical', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = testDocRepo.findByIdWithTrash(req.params.id)
    if (!doc) throw new ApiError(404, '测试文档不存在')
    requireDocManage(req, doc)
    testDocRepo.physicalDelete(doc.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export { router }
