import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { hoursRepo, taskRepo, userRepo } from '../repository/repo.ts'
import { authRequired, financeRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import db, { type SqlRow, type SqlParam } from '../db.ts'

const router = Router()
router.use(authRequired)

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不正确'),
  plannedHours: z.number().optional().default(0),
  actualHours: z.number().optional().default(0),
  description: z.string().max(500).optional().default(''),
})

const updateSchema = z.object({
  plannedHours: z.number().optional(),
  actualHours: z.number().optional(),
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

router.get('/stats/hours', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId, userId, startDate, endDate } = req.query as Record<string, string>
    let query = 'SELECT * FROM task_hours WHERE 1=1'
    const params: SqlParam[] = []
    if (projectId) {
      query += ' AND task_id IN (SELECT id FROM tasks WHERE project_id = ?)'
      params.push(projectId)
    }
    if (userId) {
      query += ' AND user_id = ?'
      params.push(userId)
    }
    if (startDate) {
      query += ' AND date >= ?'
      params.push(startDate)
    }
    if (endDate) {
      query += ' AND date <= ?'
      params.push(endDate)
    }
    query += ' ORDER BY date DESC'
    const rows = db.prepare(query).all(...params) as SqlRow[]
    res.json({ hours: rows.map(rowToHours) })
  } catch (e) { next(e) }
})

router.get('/stats/hours-by-user', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string>
    let query = `
      SELECT 
        u.id as user_id, u.name as user_name, u.avatar_color as avatar_color,
        u.role as user_role, u.is_outsourced as is_outsourced,
        p.id as project_id, p.name as project_name,
        CASE WHEN pm.role = 'owner' THEN 1 ELSE 0 END as is_project_owner,
        SUM(th.planned_hours) as planned_hours,
        SUM(th.actual_hours) as actual_hours
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
    query += ' GROUP BY u.id, p.id'
    const rows = db.prepare(query).all(...params) as SqlRow[]

    interface UserRollup {
      userId: string
      userName: string
      avatarColor: string
      userRole: string
      isOutsourced: boolean
      isProjectOwner: boolean
      projects: { projectId: string; projectName: string; plannedHours: number; actualHours: number }[]
      totalPlanned: number
      totalActual: number
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
      })
      userMap[r.user_id].totalPlanned += Number(r.planned_hours) || 0
      userMap[r.user_id].totalActual += Number(r.actual_hours) || 0
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
    
    let query = `
      SELECT 
        p.id as project_id, p.name as project_name,
        COALESCE(SUM(b.amount), 0) as total_budget,
        COALESCE(SUM(e.amount), 0) as total_expense
      FROM projects p
      LEFT JOIN project_budgets b ON p.id = b.project_id AND b.approval_status = 'approved'
      LEFT JOIN project_expenses e ON p.id = e.project_id
      WHERE 1=1
    `
    const params: SqlParam[] = []
    if (projectId) {
      query += ' AND p.id = ?'
      params.push(projectId)
    }
    query += ' GROUP BY p.id ORDER BY p.name'
    const projectRows = db.prepare(query).all(...params) as SqlRow[]

    interface ProjectCostItem {
      projectId: string
      projectName: string
      totalBudget: number
      totalExpense: number
      remainingBudget: number
      costByCategory: { category: string; budget: number; expense: number; hours: number; cost: number }[]
      memberCosts: { userId: string; userName: string; isOutsourced: boolean; hourlyRate: number; totalHours: number; totalCost: number; categoryName: string | null }[]
    }
    const result: ProjectCostItem[] = []
    for (const pr of projectRows) {
      const categoryQuery = `
        SELECT 
          b.category,
          COALESCE(SUM(b.amount), 0) as budget,
          COALESCE(SUM(e.amount), 0) as expense,
          COALESCE(SUM(th.actual_hours), 0) as hours
        FROM projects p
        LEFT JOIN project_budgets b ON p.id = b.project_id AND b.approval_status = 'approved'
        LEFT JOIN project_expenses e ON p.id = e.project_id AND e.category = b.category
        LEFT JOIN tasks t ON p.id = t.project_id
        LEFT JOIN task_hours th ON t.id = th.task_id
        WHERE p.id = ?
        GROUP BY b.category
      `
      const categoryRows = db.prepare(categoryQuery).all(pr.project_id) as SqlRow[]

      const memberQuery = `
        SELECT 
          u.id as user_id, u.name as user_name,
          u.role as user_role,
          COALESCE(u.is_outsourced, uc.is_outsourced, 0) as is_outsourced,
          COALESCE(u.hourly_rate, uc.hourly_rate, 0) as hourly_rate,
          CASE WHEN pm.role = 'owner' THEN 1 ELSE 0 END as is_project_owner,
          SUM(th.actual_hours) as total_hours,
          uc.name as category_name
        FROM users u
        LEFT JOIN user_categories uc ON u.category_id = uc.id
        LEFT JOIN project_members pm ON pm.project_id = ? AND pm.user_id = u.id
        JOIN task_hours th ON u.id = th.user_id
        JOIN tasks t ON th.task_id = t.id
        WHERE t.project_id = ?
        GROUP BY u.id
      `
      const memberRows = db.prepare(memberQuery).all(pr.project_id, pr.project_id) as SqlRow[]

      const getMemberSortOrder = (mr: SqlRow) => {
        if (mr.user_role === 'admin') return 0
        if (mr.user_role === 'finance') return 1
        if (mr.is_project_owner === 1) return 2
        if (mr.is_outsourced === 0) return 3
        return 4
      }

      memberRows.sort((a: SqlRow, b: SqlRow) => {
        const orderA = getMemberSortOrder(a)
        const orderB = getMemberSortOrder(b)
        if (orderA !== orderB) return orderA - orderB
        return (a.user_name || '').localeCompare(b.user_name || '')
      })

      result.push({
        projectId: pr.project_id,
        projectName: pr.project_name,
        totalBudget: Number(pr.total_budget) || 0,
        totalExpense: Number(pr.total_expense) || 0,
        remainingBudget: (Number(pr.total_budget) || 0) - (Number(pr.total_expense) || 0),
        costByCategory: categoryRows.map((cr: SqlRow) => ({
          category: cr.category || 'other',
          budget: Number(cr.budget) || 0,
          expense: Number(cr.expense) || 0,
          hours: Number(cr.hours) || 0,
          cost: 0,
        })),
        memberCosts: memberRows.map((mr: SqlRow) => {
          const rate = Number(mr.hourly_rate) || 0
          const hours = Number(mr.total_hours) || 0
          return {
            userId: mr.user_id,
            userName: mr.user_name,
            isOutsourced: mr.is_outsourced === 1,
            hourlyRate: rate,
            totalHours: hours,
            totalCost: rate * hours,
            categoryName: mr.category_name || null,
          }
        }),
      })
    }
    res.json({ data: result })
  } catch (e) { next(e) }
})

function rowToHours(r: SqlRow) {
  return {
    id: r.id, taskId: r.task_id, userId: r.user_id,
    date: r.date, plannedHours: Number(r.planned_hours),
    actualHours: Number(r.actual_hours), description: r.description || '',
    createdAt: r.created_at,
  }
}

export default router