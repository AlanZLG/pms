import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { budgetRepo, projectRepo, userRepo } from '../repository/repo.ts'
import { authRequired, financeRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import type { BudgetCategory } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

const createSchema = z.object({
  category: z.enum(['labor', 'outsource', 'hardware', 'software', 'other']),
  amount: z.number().min(0.01, '预算金额必须大于0'),
  currency: z.string().optional().default('RMB'),
  description: z.string().max(500).optional().default(''),
})

const updateSchema = z.object({
  category: z.enum(['labor', 'outsource', 'hardware', 'software', 'other']).optional(),
  amount: z.number().min(0.01).optional(),
  currency: z.string().optional(),
  description: z.string().max(500).optional(),
})

const approveSchema = z.object({
  comment: z.string().max(500).optional().default(''),
})

const totalBudgetSchema = z.object({
  totalBudget: z.number().min(0, '总预算不能为负').nullable(),
})

/** 总预算设置权限：admin/finance/项目负责人 */
function assertTotalBudgetAccess(project: { ownerId: string }, role?: string, userId?: string): void {
  if (role !== 'admin' && role !== 'finance' && project.ownerId !== userId) {
    throw new ApiError(403, '仅项目负责人、财务或管理员可设置总预算')
  }
}

/** 设置项目总预算（v1.9.4 自上而下预算控制；null 清除 = 不启用） */
router.put('/projects/:projectId/total-budget', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    assertTotalBudgetAccess(project, currentUser?.role, req.userId)
    const parsed = totalBudgetSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const total = parsed.data.totalBudget
    // 硬拦截语义：总额不得低于当前已分配额度（pending+approved），否则存量明细立即违规
    const allocated = budgetRepo.sumAllocated(project.id)
    if (total != null && total < allocated) throw new ApiError(400, `总预算不能低于当前已分配额度 ¥${allocated.toFixed(2)}`)
    projectRepo.update(project.id, { totalBudget: total })
    res.json({ project: projectRepo.findById(project.id)! })
  } catch (e) { next(e) }
})

/** 总预算硬拦截校验：已分配（不含 excludeId 本身）+ 本次金额 不得超过总额 */
function assertTotalBudgetLimit(projectId: string, amount: number, excludeId?: string): void {
  const project = projectRepo.findById(projectId)
  if (!project || project.totalBudget == null) return
  const allocated = budgetRepo.sumAllocated(projectId, excludeId)
  const remaining = project.totalBudget - allocated
  if (amount > remaining + 1e-9) {
    throw new ApiError(400, `超出项目总预算：剩余可分配 ¥${Math.max(remaining, 0).toFixed(2)}，本次申请 ¥${amount.toFixed(2)}`)
  }
}

router.get('/projects/:projectId/budgets', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    const members = projectRepo.members(project.id)
    const isProjectMember = members.some(m => m.userId === req.userId)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && !isProjectMember) {
      throw new ApiError(403, '无权访问此项目预算')
    }
    const budgets = budgetRepo.findByProject(project.id)
    res.json({ budgets })
  } catch (e) { next(e) }
})

router.post('/projects/:projectId/budgets', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    const members = projectRepo.members(project.id)
    const isProjectMember = members.some(m => m.userId === req.userId)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && !isProjectMember) {
      throw new ApiError(403, '无权为该项目创建预算')
    }
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    assertTotalBudgetLimit(project.id, parsed.data.amount)
    const budget = budgetRepo.create({
      projectId: project.id,
      category: parsed.data.category as BudgetCategory,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      description: parsed.data.description,
      createdBy: req.userId!,
    })
    res.status(201).json({ budget })
  } catch (e) { next(e) }
})

router.patch('/budgets/:budgetId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = budgetRepo.findById(req.params.budgetId)
    if (!budget) throw new ApiError(404, '预算不存在')
    const currentUser = userRepo.findById(req.userId!)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && budget.createdBy !== req.userId) {
      throw new ApiError(403, '无权修改此预算')
    }
    if (budget.approvalStatus === 'approved') {
      throw new ApiError(400, '已审批的预算无法修改')
    }
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    // 改金额/分类时同样受总预算硬拦截（排除自身当前占用）
    if (parsed.data.amount !== undefined) {
      assertTotalBudgetLimit(budget.projectId, parsed.data.amount, budget.id)
    }
    budgetRepo.update(budget.id, parsed.data)
    res.json({ budget: budgetRepo.findById(budget.id)! })
  } catch (e) { next(e) }
})

router.delete('/budgets/:budgetId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = budgetRepo.findById(req.params.budgetId)
    if (!budget) throw new ApiError(404, '预算不存在')
    const currentUser = userRepo.findById(req.userId!)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && budget.createdBy !== req.userId) {
      throw new ApiError(403, '无权删除此预算')
    }
    if (budget.approvalStatus === 'approved') {
      throw new ApiError(400, '已审批的预算无法删除')
    }
    budgetRepo.delete(budget.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.get('/projects/:projectId/budget-summary', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const currentUser = userRepo.findById(req.userId!)
    const members = projectRepo.members(project.id)
    const isProjectMember = members.some(m => m.userId === req.userId)
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'finance' && !isProjectMember) {
      throw new ApiError(403, '无权访问此项目预算')
    }
    const budgets = budgetRepo.findByProject(project.id)
    const isFinance = currentUser?.role === 'admin' || currentUser?.role === 'finance'
    const filteredBudgets = isFinance ? budgets : budgets.filter(b => b.approvalStatus === 'approved')
    const totalBudget = filteredBudgets.reduce((sum, b) => sum + b.amount, 0)
    res.json({
      totalBudget,
      budgets: filteredBudgets.map(b => ({
        id: b.id,
        category: b.category,
        amount: b.amount,
        description: b.description,
        approvalStatus: b.approvalStatus,
      })),
    })
  } catch (e) { next(e) }
})

router.post('/budgets/:budgetId/approve', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = budgetRepo.findById(req.params.budgetId)
    if (!budget) throw new ApiError(404, '预算不存在')
    if (budget.approvalStatus !== 'pending') {
      throw new ApiError(400, '只有待审批的预算才能审批')
    }
    const parsed = approveSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    budgetRepo.approve(budget.id, req.userId!, parsed.data.comment)
    res.json({ budget: budgetRepo.findById(budget.id)! })
  } catch (e) { next(e) }
})

router.post('/budgets/:budgetId/reject', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budget = budgetRepo.findById(req.params.budgetId)
    if (!budget) throw new ApiError(404, '预算不存在')
    if (budget.approvalStatus !== 'pending') {
      throw new ApiError(400, '只有待审批的预算才能拒绝')
    }
    const parsed = approveSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    budgetRepo.reject(budget.id, req.userId!, parsed.data.comment)
    res.json({ budget: budgetRepo.findById(budget.id)! })
  } catch (e) { next(e) }
})

router.get('/budgets/mine', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const budgets = budgetRepo.findByCreator(req.userId!)
    res.json({
      budgets: budgets.map((b) => ({ ...b, projectName: projectRepo.findById(b.projectId)?.name || '' })),
    })
  } catch (e) { next(e) }
})

router.get('/budgets/pending', financeRequired, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pending = budgetRepo.findPending()
    res.json({ budgets: pending })
  } catch (e) { next(e) }
})

export default router