import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { expenseRepo, projectRepo, userRepo } from '../repository/repo.ts'
import { authRequired, financeRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import type { BudgetCategory } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

const createSchema = z.object({
  budgetId: z.string().nullable().optional().default(null),
  category: z.enum(['labor', 'outsource', 'hardware', 'software', 'other']),
  amount: z.number().min(0.01, '支出金额必须大于0'),
  description: z.string().max(500).optional().default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式不正确'),
})

const updateSchema = z.object({
  budgetId: z.string().nullable().optional(),
  category: z.enum(['labor', 'outsource', 'hardware', 'software', 'other']).optional(),
  amount: z.number().min(0.01).optional(),
  description: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

router.get('/projects/:projectId/expenses', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    const members = projectRepo.members(project.id)
    const isProjectMember = members.some(m => m.userId === req.userId)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && !isProjectMember) {
      throw new ApiError(403, '无权访问此项目支出')
    }
    const expenses = expenseRepo.findByProject(project.id)
    res.json({ expenses })
  } catch (e) { next(e) }
})

router.post('/projects/:projectId/expenses', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    const members = projectRepo.members(project.id)
    const isProjectMember = members.some(m => m.userId === req.userId)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && !isProjectMember) {
      throw new ApiError(403, '无权为该项目创建支出')
    }
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const expense = expenseRepo.create({
      projectId: project.id,
      budgetId: parsed.data.budgetId,
      category: parsed.data.category as BudgetCategory,
      amount: parsed.data.amount,
      description: parsed.data.description,
      date: parsed.data.date,
      createdBy: req.userId!,
    })
    res.status(201).json({ expense })
  } catch (e) { next(e) }
})

router.patch('/expenses/:expenseId', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = expenseRepo.findById(req.params.expenseId)
    if (!expense) throw new ApiError(404, '支出不存在')
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    expenseRepo.update(expense.id, parsed.data)
    res.json({ expense: expenseRepo.findById(expense.id)! })
  } catch (e) { next(e) }
})

router.delete('/expenses/:expenseId', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = expenseRepo.findById(req.params.expenseId)
    if (!expense) throw new ApiError(404, '支出不存在')
    expenseRepo.delete(expense.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.get('/projects/:projectId/expense-summary', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    const members = projectRepo.members(project.id)
    const isProjectMember = members.some(m => m.userId === req.userId)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && !isProjectMember) {
      throw new ApiError(403, '无权访问此项目支出')
    }
    const expenses = expenseRepo.findByProject(project.id)
    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0)
    const byCategory: Record<string, number> = {}
    expenses.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
    })
    res.json({
      totalExpense,
      byCategory,
      count: expenses.length,
    })
  } catch (e) { next(e) }
})

export default router