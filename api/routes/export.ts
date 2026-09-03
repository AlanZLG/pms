import { Router, type Response, type NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { taskRepo, projectRepo, userRepo, expenseRepo, budgetRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import db from '../db.ts'

export const router = Router()
router.use(authRequired)

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const statusLabel: Record<string, string> = {
  todo: '待办', in_progress: '进行中', review: '审核中', done: '已完成',
}
const priorityLabel: Record<string, string> = {
  low: '低', medium: '中', high: '高', urgent: '紧急',
}

// 样式辅助函数
function applyHeaderStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF4472C4' } },
      left: { style: 'thin', color: { argb: 'FF4472C4' } },
      bottom: { style: 'thin', color: { argb: 'FF4472C4' } },
      right: { style: 'thin', color: { argb: 'FF4472C4' } },
    }
  })
  row.height = 25
}

function applyDataBorders(ws: ExcelJS.Worksheet, startRow: number, endRow: number, colCount: number) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = 1; c <= colCount; c++) {
      const cell = ws.getCell(r, c)
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        left: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        right: { style: 'hair', color: { argb: 'FFD9D9D9' } },
      }
      cell.alignment = { vertical: 'middle' }
    }
  }
}

function setColumnWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
}

function colorForStatus(status: string): string {
  const colors: Record<string, string> = {
    todo: 'FFF2F2F2',
    in_progress: 'FFFFF2CC',
    review: 'FFE6F3FF',
    done: 'FFE2EFDA',
  }
  return colors[status] || 'FFFFFFFF'
}

function colorForPriority(priority: string): string {
  const colors: Record<string, string> = {
    urgent: 'FFFF0000',
    high: 'FFFF9900',
    medium: 'FFFFC000',
    low: 'FF92D050',
  }
  return colors[priority] || 'FF000000'
}

router.get('/projects/:projectId/tasks.csv', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const tasks = taskRepo.findByProject(project.id)
    const users = new Map<string, string>()
    for (const t of tasks) {
      if (t.assigneeId && !users.has(t.assigneeId)) {
        const u = userRepo.findById(t.assigneeId)
        if (u) users.set(u.id, u.name)
      }
    }

    const headers = ['ID', '标题', '状态', '优先级', '负责人', '标签', '截止日期', '创建时间']
    const rows = tasks.map((t) => [
      t.id,
      t.title,
      statusLabel[t.status] || t.status,
      priorityLabel[t.priority] || t.priority,
      users.get(t.assigneeId || '') || '',
      t.labels.join('、'),
      t.dueDate ? new Date(t.dueDate).toLocaleDateString('zh-CN') : '',
      new Date(t.createdAt).toLocaleString('zh-CN'),
    ])

    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
    const filename = encodeURIComponent(`${project.name}_任务列表.csv`)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send('\uFEFF' + csv)
  } catch (e) { next(e) }
})

router.get('/projects.csv', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user) throw new ApiError(404, '用户不存在')
    let projects = projectRepo.findAll()
    if (user.role !== 'admin') {
      projects = projects.filter((p) => p.members.some((m) => m.userId === user.id) || p.ownerId === user.id)
    }

    const headers = ['ID', '项目名称', '描述', '状态', '进度', '成员数', '任务数', '截止日期', '创建时间']
    const rows = projects.map((p) => [
      p.id,
      p.name,
      p.description,
      { planning: '规划中', active: '进行中', completed: '已完成', archived: '已归档' }[p.status] || p.status,
      `${p.progress}%`,
      p.members.length,
      taskRepo.findByProject(p.id).length,
      p.dueDate ? new Date(p.dueDate).toLocaleDateString('zh-CN') : '',
      new Date(p.createdAt).toLocaleString('zh-CN'),
    ])

    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n')
    const filename = encodeURIComponent('项目列表.csv')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.send('\uFEFF' + csv)
  } catch (e) { next(e) }
})

router.get('/projects/:projectId/progress.xlsx', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const tasks = taskRepo.findByProject(project.id)

    // 计算任务统计
    const totalTasks = tasks.length
    const todoCount = tasks.filter((t) => t.status === 'todo').length
    const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length
    const reviewCount = tasks.filter((t) => t.status === 'review').length
    const doneCount = tasks.filter((t) => t.status === 'done').length
    const completionRate = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0

    // 计算工时
    let totalPlannedHours = 0
    let totalActualHours = 0
    for (const task of tasks) {
      const hourRows = db.prepare(
        'SELECT COALESCE(SUM(planned_hours), 0) as planned, COALESCE(SUM(actual_hours), 0) as actual FROM task_hours WHERE task_id = ?',
      ).get(task.id) as { planned: number; actual: number }
      totalPlannedHours += Number(hourRows.planned) || 0
      totalActualHours += Number(hourRows.actual) || 0
    }

    // 计算预算与支出
    const budgets = budgetRepo.findByProject(project.id)
    const expenses = expenseRepo.findByProject(project.id)
    const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0)
    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0)
    const remainingBudget = totalBudget - totalExpense

    // 获取成员信息
    const members = project.members.map((m) => {
      const user = userRepo.findById(m.userId)
      return user ? { name: user.name, role: m.role, isOutsourced: user.isOutsourced, id: user.id } : null
    }).filter(Boolean) as { name: string; role: string; isOutsourced: boolean; id: string }[]

    // 为每位成员计算工时和任务
    const memberDetails = members.map((member) => {
      const memberTasks = tasks.filter((t) => {
        const user = userRepo.findById(t.assigneeId || '')
        return user?.id === member.id
      })
      const doneTasks = memberTasks.filter((t) => t.status === 'done')
      let plannedHours = 0
      let actualHours = 0
      for (const task of memberTasks) {
        const hr = db.prepare(
          'SELECT COALESCE(SUM(planned_hours), 0) as planned, COALESCE(SUM(actual_hours), 0) as actual FROM task_hours WHERE task_id = ?',
        ).get(task.id) as { planned: number; actual: number }
        plannedHours += Number(hr.planned) || 0
        actualHours += Number(hr.actual) || 0
      }
      return {
        name: member.name,
        role: member.role === 'owner' ? '项目负责人' : '成员',
        isOutsourced: member.isOutsourced,
        plannedHours,
        actualHours,
        taskCount: memberTasks.length,
        doneCount: doneTasks.length,
      }
    })

    // 构建Excel工作簿
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '项目管理系统'
    workbook.created = new Date()

    // ====== Sheet 1: 项目概况 ======
    const wsOverview = workbook.addWorksheet('项目概况')
    wsOverview.properties.defaultRowHeight = 22

    // 标题行
    wsOverview.mergeCells('A1:D1')
    const titleCell = wsOverview.getCell('A1')
    titleCell.value = '项目进度报告'
    titleCell.font = { bold: true, size: 18, color: { argb: 'FF1F4E79' } }
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } }
    wsOverview.getRow(1).height = 40

    // 报告时间
    wsOverview.getCell('A3').value = '生成时间'
    wsOverview.getCell('B3').value = new Date().toLocaleString('zh-CN')
    wsOverview.getCell('A3').font = { bold: true }

    // 项目基本信息
    const overviewData: [string, string | number][] = [
      ['项目名称', project.name],
      ['项目ID', project.id],
      ['项目状态', ({ planning: '规划中', active: '进行中', completed: '已完成', archived: '已归档' } as Record<string, string>)[project.status] || project.status],
      ['整体进度', `${project.progress}%`],
      ['任务完成率', `${completionRate}%`],
      ['开始日期', project.startDate ? new Date(project.startDate).toLocaleDateString('zh-CN') : '未设置'],
      ['截止日期', project.dueDate ? new Date(project.dueDate).toLocaleDateString('zh-CN') : '未设置'],
      ['创建时间', new Date(project.createdAt).toLocaleString('zh-CN')],
    ]

    overviewData.forEach(([label, value], i) => {
      const row = i + 5
      wsOverview.getCell(`A${row}`).value = label
      wsOverview.getCell(`A${row}`).font = { bold: true }
      wsOverview.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }
      wsOverview.getCell(`B${row}`).value = value
      wsOverview.getCell(`A${row}`).border = {
        top: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        left: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        right: { style: 'hair', color: { argb: 'FFD9D9D9' } },
      }
      wsOverview.getCell(`B${row}`).border = {
        top: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        left: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } },
        right: { style: 'hair', color: { argb: 'FFD9D9D9' } },
      }
    })

    setColumnWidths(wsOverview, [15, 30, 15, 15])

    // ====== Sheet 2: 任务统计 ======
    const wsStats = workbook.addWorksheet('任务统计')
    const statsHeader = wsStats.addRow(['指标', '数量', '占比'])
    applyHeaderStyle(statsHeader)

    const completionPct = totalTasks > 0 ? `${((doneCount / totalTasks) * 100).toFixed(1)}%` : '0%'
    const rows2: (string | number)[][] = [
      ['总任务数', totalTasks, '100%'],
      ['待办', todoCount, totalTasks > 0 ? `${((todoCount / totalTasks) * 100).toFixed(1)}%` : '0%'],
      ['进行中', inProgressCount, totalTasks > 0 ? `${((inProgressCount / totalTasks) * 100).toFixed(1)}%` : '0%'],
      ['审核中', reviewCount, totalTasks > 0 ? `${((reviewCount / totalTasks) * 100).toFixed(1)}%` : '0%'],
      ['已完成', doneCount, completionPct],
    ]
    rows2.forEach((r) => wsStats.addRow(r))
    applyDataBorders(wsStats, 2, 6, 3)
    setColumnWidths(wsStats, [15, 12, 12])

    // ====== Sheet 3: 工时统计 ======
    const wsHours = workbook.addWorksheet('工时统计')
    const hoursHeader = wsHours.addRow(['指标', '数值'])
    applyHeaderStyle(hoursHeader)
    const hoursRows: (string | number)[][] = [
      ['计划工时(小时)', Number(totalPlannedHours.toFixed(1))],
      ['实际工时(小时)', Number(totalActualHours.toFixed(1))],
      ['工时偏差(小时)', Number((totalActualHours - totalPlannedHours).toFixed(1))],
      ['工时偏差率', totalPlannedHours > 0 ? `${(((totalActualHours - totalPlannedHours) / totalPlannedHours) * 100).toFixed(1)}%` : '0%'],
    ]
    hoursRows.forEach((r) => wsHours.addRow(r))
    applyDataBorders(wsHours, 2, 5, 2)
    wsHours.getCell('B5').font = { color: { argb: totalActualHours > totalPlannedHours ? 'FFFF0000' : 'FF00B050' } }
    setColumnWidths(wsHours, [20, 15])

    // ====== Sheet 4: 预算与支出 ======
    const wsBudget = workbook.addWorksheet('预算与支出')
    const budgetHeader = wsBudget.addRow(['指标', '金额(元)'])
    applyHeaderStyle(budgetHeader)
    const budgetRows: (string | number)[][] = [
      ['总预算', Number(totalBudget.toFixed(2))],
      ['总支出', Number(totalExpense.toFixed(2))],
      ['剩余预算', Number(remainingBudget.toFixed(2))],
      ['预算使用率', totalBudget > 0 ? `${((totalExpense / totalBudget) * 100).toFixed(1)}%` : '0%'],
    ]
    budgetRows.forEach((r) => wsBudget.addRow(r))
    applyDataBorders(wsBudget, 2, 5, 2)
    // 高亮剩余预算
    if (remainingBudget < 0) {
      wsBudget.getCell('B4').font = { color: { argb: 'FFFF0000' }, bold: true }
    }
    setColumnWidths(wsBudget, [20, 18])

    // ====== Sheet 5: 成员工作量 ======
    const wsMembers = workbook.addWorksheet('成员工作量')
    const memberHeader = wsMembers.addRow(['姓名', '项目角色', '是否外包', '计划工时', '实际工时', '偏差', '已分配任务', '已完成任务'])
    applyHeaderStyle(memberHeader)

    for (const md of memberDetails) {
      const row = wsMembers.addRow([
        md.name,
        md.role,
        md.isOutsourced ? '是' : '否',
        Number(md.plannedHours.toFixed(1)),
        Number(md.actualHours.toFixed(1)),
        Number((md.actualHours - md.plannedHours).toFixed(1)),
        md.taskCount,
        md.doneCount,
      ])
      if (md.isOutsourced) {
        row.getCell(3).font = { color: { argb: 'FFFF9900' } }
      }
    }
    applyDataBorders(wsMembers, 2, 1 + memberDetails.length, 8)
    setColumnWidths(wsMembers, [12, 12, 10, 10, 10, 10, 12, 12])

    // ====== Sheet 6: 任务明细 ======
    const wsTasks = workbook.addWorksheet('任务明细')
    const taskHeader = wsTasks.addRow(['序号', '任务标题', '状态', '优先级', '负责人', '开始日期', '截止日期', '计划工时', '实际工时', '标签'])
    applyHeaderStyle(taskHeader)

    const userMap = new Map<string, string>()
    const sortedTasks = [...tasks].sort((a, b) => {
      const orderA = ['in_progress', 'review', 'todo', 'done'].indexOf(a.status)
      const orderB = ['in_progress', 'review', 'todo', 'done'].indexOf(b.status)
      return orderA - orderB
    })

    sortedTasks.forEach((t, i) => {
      if (t.assigneeId && !userMap.has(t.assigneeId)) {
        const u = userRepo.findById(t.assigneeId)
        if (u) userMap.set(u.id, u.name)
      }
      const hr = db.prepare(
        'SELECT COALESCE(SUM(planned_hours), 0) as planned, COALESCE(SUM(actual_hours), 0) as actual FROM task_hours WHERE task_id = ?',
      ).get(t.id) as { planned: number; actual: number }

      const row = wsTasks.addRow([
        i + 1,
        t.title,
        statusLabel[t.status] || t.status,
        priorityLabel[t.priority] || t.priority,
        userMap.get(t.assigneeId || '') || '未分配',
        t.startDate ? new Date(t.startDate) : '',
        t.dueDate ? new Date(t.dueDate) : '',
        Number(hr.planned.toFixed(1)),
        Number(hr.actual.toFixed(1)),
        t.labels.join('、'),
      ])

      // 状态着色
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorForStatus(t.status) } }
      if (t.status === 'done') {
        row.getCell(3).font = { color: { argb: 'FF006100' } }
      }

      // 优先级着色
      const priorityColor = colorForPriority(t.priority)
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: priorityColor } }
      if (t.priority === 'urgent' || t.priority === 'high') {
        row.getCell(4).font = { color: { argb: 'FFFFFFFF' } }
      }

      // 日期格式
      if (t.startDate) row.getCell(6).numFmt = 'yyyy-mm-dd'
      if (t.dueDate) row.getCell(7).numFmt = 'yyyy-mm-dd'
    })
    applyDataBorders(wsTasks, 2, 1 + sortedTasks.length, 10)
    setColumnWidths(wsTasks, [6, 25, 10, 8, 12, 12, 12, 10, 10, 15])

    // 冻结首行
    wsTasks.views = [{ state: 'frozen', ySplit: 1 }]

    // ====== Sheet 7: 预算明细 ======
    const wsBudgetDetail = workbook.addWorksheet('预算明细')
    const budgetDetailHeader = wsBudgetDetail.addRow(['类别', '预算金额', '批准状态'])
    applyHeaderStyle(budgetDetailHeader)

    for (const b of budgets) {
      wsBudgetDetail.addRow([
        b.category,
        Number(b.amount.toFixed(2)),
        b.approvalStatus === 'approved' ? '已批准' : b.approvalStatus === 'pending' ? '待审批' : '已拒绝',
      ])
    }
    applyDataBorders(wsBudgetDetail, 2, 1 + budgets.length, 3)
    setColumnWidths(wsBudgetDetail, [20, 15, 12])

    // ====== Sheet 8: 支出明细 ======
    const wsExpenseDetail = workbook.addWorksheet('支出明细')
    const expenseHeader = wsExpenseDetail.addRow(['日期', '类别', '金额', '描述'])
    applyHeaderStyle(expenseHeader)

    for (const e of expenses) {
      const row = wsExpenseDetail.addRow([e.date, e.category, Number(e.amount.toFixed(2)), e.description || ''])
      row.getCell(1).numFmt = 'yyyy-mm-dd'
    }
    applyDataBorders(wsExpenseDetail, 2, 1 + expenses.length, 4)
    setColumnWidths(wsExpenseDetail, [12, 15, 12, 30])

    // 设置响应头并输出
    const filename = encodeURIComponent(`${project.name}_进度报告.xlsx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')

    await workbook.xlsx.write(res)
    res.end()
  } catch (e) { next(e) }
})