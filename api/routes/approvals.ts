/**
 * 统一审批（我的待办）：
 * 聚合所有需要当前用户审批的内容（预算审批 + 项目删除申请），
 * 支持单条/批量通过与驳回；批量逐条容错，失败项单独返回原因。
 */
import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { budgetRepo, projectRepo, userRepo, notificationRepo, rolePermissionRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import type { ApprovalItem, ApprovalType, BatchApprovalResult, BudgetCategory } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  labor: '内部人力', outsource: '外包费用', hardware: '硬件设备', software: '软件服务', other: '其他',
}

/** 是否可审批预算（与 /api/budgets 审批口径一致：管理员/项目核算） */
function canApproveBudgets(role: string | undefined): boolean {
  return role === 'admin' || role === 'finance'
}

/** 是否可审批项目删除申请（管理员或被授予 project.approve_delete 权限） */
function canApproveDeletions(userId: string, role: string | undefined): boolean {
  if (role === 'admin') return true
  return rolePermissionRepo.userHasPermission(userId, 'project.approve_delete')
}

/** 待审批聚合：仅返回当前用户有权审批的内容 */
router.get('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.userRole
    const items: ApprovalItem[] = []
    if (canApproveBudgets(role)) {
      for (const b of budgetRepo.findPending()) {
        const label = CATEGORY_LABELS[b.category] || b.category
        items.push({
          id: b.id,
          type: 'budget',
          title: `${label}${b.description ? ` · ${b.description}` : ''}`,
          projectId: b.projectId,
          projectName: projectRepo.findById(b.projectId)?.name || '',
          amount: b.amount,
          description: b.description || '',
          requesterName: userRepo.findById(b.createdBy)?.name || '未知用户',
          requestedAt: b.createdAt,
        })
      }
    }
    if (canApproveDeletions(req.userId!, role)) {
      for (const p of projectRepo.findPendingDeletions()) {
        items.push({
          id: p.id,
          type: 'deletion',
          title: `删除申请：${p.name}`,
          projectId: p.id,
          projectName: p.name,
          requesterName: p.deleteRequestedBy ? userRepo.findById(p.deleteRequestedBy)?.name || '未知用户' : '未知用户',
          requestedAt: p.deleteRequestedAt || p.createdAt,
        })
      }
    }
    items.sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''))
    res.json({ items })
  } catch (e) { next(e) }
})

const batchSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(200, '审批意见最多 200 字').optional().default(''),
  items: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['budget', 'deletion']),
  })).min(1, '请选择要审批的条目').max(100, '单次最多处理 100 条'),
})

/** 批量审批：逐条独立处理，单条失败不影响其余，返回逐条结果 */
router.post('/batch', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = batchSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const { action, comment, items } = parsed.data
    const role = req.userRole

    const results: BatchApprovalResult[] = items.map((it) => {
      try {
        if (it.type === 'budget') {
          if (!canApproveBudgets(role)) throw new ApiError(403, '无预算审批权限')
          const b = budgetRepo.findById(it.id)
          if (!b) throw new ApiError(404, '预算不存在')
          if (b.approvalStatus !== 'pending') throw new ApiError(400, '该预算已被处理，请刷新')
          if (action === 'approve') budgetRepo.approve(b.id, req.userId!, comment)
          else budgetRepo.reject(b.id, req.userId!, comment)
        } else {
          if (!canApproveDeletions(req.userId!, role)) throw new ApiError(403, '无删除审批权限')
          const p = projectRepo.findById(it.id)
          if (!p) throw new ApiError(404, '项目不存在')
          if (!p.deleteRequestedBy) throw new ApiError(400, '该项目没有待审批的删除申请')
          if (action === 'approve') {
            projectRepo.softDelete(p.id)
            projectRepo.cancelDeletion(p.id)
            notificationRepo.create({
              userId: p.deleteRequestedBy,
              type: 'system',
              title: `项目「${p.name}」删除申请已批准`,
              body: '你提交的项目删除申请已获批准，项目及其任务已移入回收站',
              projectId: p.id,
            })
          } else {
            projectRepo.rejectDeletion(p.id, comment)
            notificationRepo.create({
              userId: p.deleteRequestedBy,
              type: 'system',
              title: `项目「${p.name}」删除申请被驳回`,
              body: comment ? `驳回原因：${comment}` : '管理员或项目核算人员驳回了该项目的删除申请',
              projectId: p.id,
            })
          }
        }
        return { id: it.id, type: it.type as ApprovalType, ok: true }
      } catch (e) {
        return { id: it.id, type: it.type as ApprovalType, ok: false, error: e instanceof ApiError ? e.message : '处理失败' }
      }
    })

    res.json({
      results,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    })
  } catch (e) { next(e) }
})

export default router
