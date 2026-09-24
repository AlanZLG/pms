import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { hoursRepo, taskRepo, userRepo, taskPlannedSummary, DEFAULT_RATE_OWNER, DEFAULT_RATE_MEMBER, DEFAULT_RATE_OUTSOURCED } from '../repository/repo.ts'
import { authRequired, financeRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import db, { type SqlRow, type SqlParam } from '../db.ts'
import { resolveScope } from './stats.ts'

const router = Router()
router.use(authRequired)

// 默认时薪（RMB/h）：项目负责人 200 / 成员 150 / 外包 125（常量与单价解析统一在 repo.ts）
// 生效优先级：个人时薪(u.hourly_rate) > 人员类别时薪(uc.hourly_rate) > 项目角色默认价 > 0
// 成本口径：优先用工时登记时冻结的快照单价(th.rate_snapshot)，改价不追溯历史

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不正确'),
  plannedHours: z.number().optional().default(0),
  actualHours: z.number().optional().default(0),
  billedHours: z.number().optional().default(0),
  description: z.string().max(500).optional().default(''),
})

const updateSchema = z.object({
  plannedHours: z.number().optional(),
  actualHours: z.number().optional(),
  billedHours: z.number().optional(),
  description: z.string().max(500).optional(),
})

router.get('/tasks/:taskId/hours', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const hours = hoursRepo.findByTask(task.id)
    res.json({ hours })
  } catch (e) { next(e) }
})

router.post('/tasks/:taskId/hours', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const record = hoursRepo.create({
      taskId: task.id,
      userId: req.userId!,
      date: parsed.data.date,
      plannedHours: parsed.data.plannedHours,
      actualHours: parsed.data.actualHours,
      billedHours: parsed.data.billedHours,
      description: parsed.data.description,
    })
    res.status(201).json({ record })
  } catch (e) { next(e) }
})

router.patch('/hours/:recordId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = hoursRepo.findById(req.params.recordId)
    if (!record) throw new ApiError(404, '工时记录不存在')
    if (record.userId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权修改此工时记录')
    }
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    hoursRepo.update(record.id, parsed.data)
    res.json({ record: hoursRepo.findById(record.id)! })
  } catch (e) { next(e) }
})

router.delete('/hours/:recordId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const record = hoursRepo.findById(req.params.recordId)
    if (!record) throw new ApiError(404, '工时记录不存在')
    if (record.userId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权删除此工时记录')
    }
    hoursRepo.delete(record.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.get('/hours/me', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const hours = hoursRepo.findByUser(req.userId!)
    res.json({ hours })
  } catch (e) { next(e) }
})

// 工时报表明细：登录即可查看，但数据严格限定在权限可见的项目范围内
// 返回 hours（工时登记记录，含项目/任务信息）+ taskPlannedHours（任务计划工时汇总，来自 tasks.planned_hours）
router.get('/stats/hours', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    const { projectId, userId, startDate, endDate } = req.query as Record<string, string>
    const scope = resolveScope(user, projectId || '')
    if (scope && scope.length === 0) {
      res.json({ hours: [], taskPlannedHours: 0, unassignedPlannedHours: 0, taskPlannedByDate: [], baselineSkippedHours: 0 })
      return
    }
    let query = `
      SELECT th.*, t.title as task_title,
             p.id as project_id, p.name as project_name
      FROM task_hours th
      JOIN tasks t ON th.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      WHERE 1=1
    `
    const params: SqlParam[] = []
    if (scope) {
      query += ` AND p.id IN (${scope.map(() => '?').join(',')})`
      params.push(...scope)
    }
    if (userId) {
      query += ' AND th.user_id = ?'
      params.push(userId)
    }
    if (startDate) {
      query += ' AND th.date >= ?'
      params.push(startDate)
    }
    if (endDate) {
      query += ' AND th.date <= ?'
      params.push(endDate)
    }
    query += ' ORDER BY th.date DESC'
    const rows = db.prepare(query).all(...params) as SqlRow[]

    // 人员下拉补齐用：当前项目/期间内有登记记录或负责任务的人（不受人员筛选影响）。
    // 成员列表是当前快照，登记/指派是历史事实，两者可能不一致（如已被移出项目的参与人）。
    const registrantIds = new Set<string>()
    {
      let regQ = `
        SELECT DISTINCT th.user_id as id FROM task_hours th
        JOIN tasks t ON th.task_id = t.id
        JOIN projects p ON t.project_id = p.id
        WHERE 1=1
      `
      const regParams: SqlParam[] = []
      if (scope) {
        regQ += ` AND p.id IN (${scope.map(() => '?').join(',')})`
        regParams.push(...scope)
      }
      if (startDate) {
        regQ += ' AND th.date >= ?'
        regParams.push(startDate)
      }
      if (endDate) {
        regQ += ' AND th.date <= ?'
        regParams.push(endDate)
      }
      for (const r of db.prepare(regQ).all(...regParams) as SqlRow[]) registrantIds.add(String(r.id))

      // 任务负责人（任务计划工时按负责人归集，负责人可能非当前成员，日期筛选不适用）
      let asgQ = 'SELECT DISTINCT assignee_id as id FROM tasks WHERE deleted_at IS NULL AND assignee_id IS NOT NULL'
      const asgParams: SqlParam[] = []
      if (scope) {
        asgQ += ` AND project_id IN (${scope.map(() => '?').join(',')})`
        asgParams.push(...scope)
      }
      for (const r of db.prepare(asgQ).all(...asgParams) as SqlRow[]) registrantIds.add(String(r.id))
    }

    // 任务计划工时汇总（同项目/人员范围；日期筛选不适用——计划工时是任务属性而非登记记录）
    const summary = taskPlannedSummary(scope, userId || undefined)
    // 任务计划基线：按任务起止区间把计划工时按天均摊，供趋势图叠加对比
    // 基线同样裁剪到所选期间内，保证趋势图时间轴与顶部期间筛选一致
    const taskPlannedByDate = plannedBaseline(scope, userId || undefined, startDate, endDate)
    // 因未设起止日期或区间过长而未进基线的计划工时
    const baselineSum = taskPlannedByDate.reduce((s, b) => s + b.planned, 0)

    res.json({
      hours: rows.map(rowToHours),
      taskPlannedHours: summary.total,
      unassignedPlannedHours: summary.unassigned,
      registrantIds: Array.from(registrantIds),
      taskPlannedByDate,
      baselineSkippedHours: Math.round((summary.total - baselineSum) * 100) / 100,
    })
  } catch (e) { next(e) }
})

// 任务计划工时按天均摊基线（有起止区间的任务平摊到每天）
// 区间超过 60 天或未设置起止日期的任务不生成基线（避免长周期任务拉爆时间轴），由 baselineSkippedHours 提示
// startDate/endDate 用于把基线裁剪到所选期间内，保证趋势图时间轴与筛选一致
function plannedBaseline(scope: string[] | undefined, userId?: string, startDate?: string, endDate?: string): { date: string; planned: number }[] {
  let q = 'SELECT planned_hours, start_date, due_date FROM tasks WHERE deleted_at IS NULL AND planned_hours > 0'
  const params: SqlParam[] = []
  if (scope) {
    q += ` AND project_id IN (${scope.map(() => '?').join(',')})`
    params.push(...scope)
  }
  if (userId) {
    q += ' AND assignee_id = ?'
    params.push(userId)
  }
  const rows = db.prepare(q).all(...params) as SqlRow[]
  const acc: Record<string, number> = {}
  for (const r of rows) {
    const hours = Number(r.planned_hours) || 0
    if (hours <= 0) continue
    const start = String(r.start_date || r.due_date || '').slice(0, 10)
    const end = String(r.due_date || r.start_date || '').slice(0, 10)
    const s = Date.parse(start)
    const e = Date.parse(end)
    if (Number.isNaN(s)) continue
    const spanDays = Number.isNaN(e) ? 1 : Math.max(1, Math.round((e - s) / 86400000) + 1)
    if (spanDays > 60) continue
    const perDay = Math.round((hours / spanDays) * 100) / 100
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(s + i * 86400000).toISOString().slice(0, 10)
      if (startDate && d < startDate) continue
      if (endDate && d > endDate) continue
      acc[d] = (acc[d] || 0) + perDay
    }
  }
  return Object.entries(acc)
    .map(([date, planned]) => ({ date, planned: Math.round(planned * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

router.get('/stats/hours-by-user', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, projectId } = req.query as Record<string, string>
    let query = `
      SELECT 
        u.id as user_id, u.name as user_name, u.avatar_color as avatar_color,
        u.role as user_role, u.is_outsourced as is_outsourced,
        p.id as project_id, p.name as project_name,
        CASE WHEN pm.role = 'owner' THEN 1 ELSE 0 END as is_project_owner,
        SUM(th.planned_hours) as planned_hours,
        SUM(th.actual_hours) as actual_hours,
        SUM(COALESCE(th.billed_hours, 0)) as billed_hours
      FROM task_hours th
      JOIN users u ON th.user_id = u.id
      JOIN tasks t ON th.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = u.id
      WHERE 1=1
    `
    const params: SqlParam[] = []
    if (startDate) {
      query += ' AND th.date >= ?'
      params.push(startDate)
    }
    if (endDate) {
      query += ' AND th.date <= ?'
      params.push(endDate)
    }
    if (projectId) {
      query += ' AND t.project_id = ?'
      params.push(projectId)
    }
    query += ' GROUP BY u.id, p.id'
    const rows = db.prepare(query).all(...params) as SqlRow[]

    interface UserRollup {
      userId: string
      userName: string
      avatarColor: string
      userRole: string
      isOutsourced: boolean
      isProjectOwner: boolean
      projects: { projectId: string; projectName: string; plannedHours: number; actualHours: number; billedHours: number }[]
      totalPlanned: number
      totalActual: number
      totalBilled: number
    }
    const result: UserRollup[] = []
    const userMap: Record<string, UserRollup> = {}
    rows.forEach((r: SqlRow) => {
      if (!userMap[r.user_id]) {
        userMap[r.user_id] = {
          userId: r.user_id,
          userName: r.user_name,
          avatarColor: r.avatar_color,
          userRole: r.user_role,
          isOutsourced: r.is_outsourced === 1,
          isProjectOwner: false,
          projects: [],
          totalPlanned: 0,
          totalActual: 0,
          totalBilled: 0,
        }
        result.push(userMap[r.user_id])
      }
      if (r.is_project_owner === 1) {
        userMap[r.user_id].isProjectOwner = true
      }
      userMap[r.user_id].projects.push({
        projectId: r.project_id,
        projectName: r.project_name,
        plannedHours: Number(r.planned_hours) || 0,
        actualHours: Number(r.actual_hours) || 0,
        billedHours: Number(r.billed_hours) || 0,
      })
      userMap[r.user_id].totalPlanned += Number(r.planned_hours) || 0
      userMap[r.user_id].totalActual += Number(r.actual_hours) || 0
      userMap[r.user_id].totalBilled += Number(r.billed_hours) || 0
    })

    const getSortOrder = (u: UserRollup) => {
      if (u.userRole === 'admin') return 0
      if (u.userRole === 'finance') return 1
      if (u.isProjectOwner) return 2
      if (!u.isOutsourced) return 3
      return 4
    }

    result.sort((a, b) => {
      const orderA = getSortOrder(a)
      const orderB = getSortOrder(b)
      if (orderA !== orderB) return orderA - orderB
      return a.userName.localeCompare(b.userName)
    })

    res.json({ data: result })
  } catch (e) { next(e) }
})

router.get('/stats/project-cost', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.query as Record<string, string>

    // 项目总览：预算/支出各自子查询聚合后 1:1 对齐，避免 b×e 笛卡尔积放大金额
    let projectQuery = `
      SELECT p.id as project_id, p.name as project_name,
             COALESCE(bb.budget, 0) as total_budget,
             COALESCE(ee.expense, 0) as total_expense
      FROM projects p
      LEFT JOIN (SELECT project_id, SUM(amount) as budget FROM project_budgets WHERE approval_status = 'approved' GROUP BY project_id) bb ON bb.project_id = p.id
      LEFT JOIN (SELECT project_id, SUM(amount) as expense FROM project_expenses GROUP BY project_id) ee ON ee.project_id = p.id
      WHERE p.deleted_at IS NULL
    `
    const params: SqlParam[] = []
    if (projectId) {
      projectQuery += ' AND p.id = ?'
      params.push(projectId)
    }
    projectQuery += ' ORDER BY p.name'
    const projectRows = db.prepare(projectQuery).all(...params) as SqlRow[]
    if (projectRows.length === 0) {
      res.json({ data: [] })
      return
    }

    const ids = projectRows.map((r) => r.project_id as string)
    const inClause = ids.map(() => '?').join(',')

    // 分类预算/支出：预算与支出各自按 (project, category) 聚合后再合并，一次查全部项目
    const catRows = db.prepare(`
      SELECT project_id, category, SUM(budget) as budget, SUM(expense) as expense FROM (
        SELECT project_id, category, SUM(amount) as budget, 0 as expense
        FROM project_budgets WHERE approval_status = 'approved' AND project_id IN (${inClause})
        GROUP BY project_id, category
        UNION ALL
        SELECT project_id, category, 0 as budget, SUM(amount) as expense
        FROM project_expenses WHERE project_id IN (${inClause})
        GROUP BY project_id, category
      ) GROUP BY project_id, category
    `).all(...ids, ...ids) as SqlRow[]

    // 人员成本：一次查全部项目（替代原来每项目两查的 N+1）
    // 成本按行计价：优先用工时登记时冻结的快照单价，旧数据（快照为空）回退实时价
    const memberRows = db.prepare(`
      SELECT t.project_id as project_id,
             u.id as user_id, u.name as user_name, u.role as user_role,
             COALESCE(u.is_outsourced, uc.is_outsourced, 0) as is_outsourced,
             COALESCE(u.hourly_rate, uc.hourly_rate,
               CASE WHEN pm.role = 'owner' THEN ${DEFAULT_RATE_OWNER}
                    WHEN COALESCE(u.is_outsourced, uc.is_outsourced, 0) = 1 THEN ${DEFAULT_RATE_OUTSOURCED}
                    ELSE ${DEFAULT_RATE_MEMBER} END,
               0) as live_rate,
             CASE WHEN pm.role = 'owner' THEN 1 ELSE 0 END as is_project_owner,
             SUM(th.actual_hours) as total_hours,
             SUM(th.actual_hours * COALESCE(th.rate_snapshot, COALESCE(u.hourly_rate, uc.hourly_rate,
               CASE WHEN pm.role = 'owner' THEN ${DEFAULT_RATE_OWNER}
                    WHEN COALESCE(u.is_outsourced, uc.is_outsourced, 0) = 1 THEN ${DEFAULT_RATE_OUTSOURCED}
                    ELSE ${DEFAULT_RATE_MEMBER} END, 0))) as total_cost,
             COUNT(DISTINCT th.rate_source) as rate_source_count,
             MAX(th.rate_source) as rate_source
      FROM task_hours th
      JOIN tasks t ON th.task_id = t.id
      JOIN users u ON th.user_id = u.id
      LEFT JOIN user_categories uc ON u.category_id = uc.id
      LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = u.id
      WHERE t.project_id IN (${inClause})
      GROUP BY t.project_id, u.id
    `).all(...ids) as SqlRow[]

    // 项目实际工时总计（分类行的 hours 沿用原口径：项目总实际工时）
    const projectHours: Record<string, number> = {}
    memberRows.forEach((m) => {
      projectHours[m.project_id as string] = (projectHours[m.project_id as string] || 0) + (Number(m.total_hours) || 0)
    })

    interface ProjectCostItem {
      projectId: string
      projectName: string
      totalBudget: number
      totalExpense: number
      remainingBudget: number
      costByCategory: { category: string; budget: number; expense: number; hours: number; cost: number }[]
      memberCosts: { userId: string; userName: string; isOutsourced: boolean; hourlyRate: number; liveRate: number; rateSource: string; totalHours: number; totalCost: number; categoryName: string | null }[]
    }

    const getMemberSortOrder = (mr: SqlRow) => {
      if (mr.user_role === 'admin') return 0
      if (mr.user_role === 'finance') return 1
      if (mr.is_project_owner === 1) return 2
      if (mr.is_outsourced === 0) return 3
      return 4
    }

    const result: ProjectCostItem[] = projectRows.map((pr) => {
      const cats = catRows.filter((c) => c.project_id === pr.project_id)
      const members = memberRows.filter((m) => m.project_id === pr.project_id)
      members.sort((a, b) => {
        const orderA = getMemberSortOrder(a)
        const orderB = getMemberSortOrder(b)
        if (orderA !== orderB) return orderA - orderB
        return (a.user_name || '').localeCompare(b.user_name || '')
      })
      const totalBudget = Number(pr.total_budget) || 0
      const totalExpense = Number(pr.total_expense) || 0
      return {
        projectId: pr.project_id as string,
        projectName: pr.project_name as string,
        totalBudget,
        totalExpense,
        remainingBudget: totalBudget - totalExpense,
        costByCategory: cats.map((cr) => ({
          category: cr.category || 'other',
          budget: Number(cr.budget) || 0,
          expense: Number(cr.expense) || 0,
          hours: projectHours[pr.project_id as string] || 0,
          cost: 0,
        })),
        memberCosts: members.map((mr) => {
          const hours = Number(mr.total_hours) || 0
          const totalCost = Number(mr.total_cost) || 0
          const liveRate = Number(mr.live_rate) || 0
          const rateSources = Number(mr.rate_source_count) || 0
          // 实际加权均价（快照价混合时取成本/工时），无工时时展示当前生效价
          const effectiveRate = hours > 0 ? totalCost / hours : liveRate
          return {
            userId: mr.user_id as string,
            userName: mr.user_name as string,
            isOutsourced: mr.is_outsourced === 1,
            hourlyRate: effectiveRate,
            liveRate,
            rateSource: rateSources > 1 ? 'mixed' : ((mr.rate_source as string) || 'live'),
            totalHours: hours,
            totalCost,
            categoryName: mr.category_name || null,
          }
        }),
      }
    })
    res.json({ data: result })
  } catch (e) { next(e) }
})

function rowToHours(r: SqlRow) {
  return {
    id: r.id, taskId: r.task_id, userId: r.user_id,
    date: r.date, plannedHours: Number(r.planned_hours),
    actualHours: Number(r.actual_hours), billedHours: Number(r.billed_hours) || 0, description: r.description || '',
    createdAt: r.created_at,
    projectId: r.project_id || null, projectName: r.project_name || null,
    taskTitle: r.task_title || null,
  }
}

export default router