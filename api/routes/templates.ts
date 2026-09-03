// 项目模板路由

import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import {
  projectTemplateRepo,
  templateTaskRepo,
  templateBudgetRepo,
  templateKanbanColumnRepo,
  projectRepo,
  taskRepo,
  budgetRepo,
  kanbanColumnRepo,
  userRepo,
} from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import type { TaskStatus, TaskPriority, BudgetCategory } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// ===== 项目模板 CRUD =====

// 获取所有模板列表
router.get('/project-templates', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const templates = projectTemplateRepo.findAll()
    // 为每个模板添加统计信息
    const templatesWithStats = templates.map(t => ({
      ...t,
      taskCount: templateTaskRepo.findByTemplate(t.id).length,
      budgetCount: templateBudgetRepo.findByTemplate(t.id).length,
      kanbanColumnCount: templateKanbanColumnRepo.findByTemplate(t.id).length,
    }))
    res.json({ templates: templatesWithStats })
  } catch (e) {
    next(e)
  }
})

// 获取模板详情（含任务、预算、看板列）
router.get('/project-templates/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const template = projectTemplateRepo.findByIdWithDetails(req.params.id)
    if (!template) throw new ApiError(404, '模板不存在')
    res.json({ template })
  } catch (e) {
    next(e)
  }
})

// 创建模板（仅管理员）
router.post('/project-templates', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以创建模板')
    }

    const schema = z.object({
      name: z.string().min(1, '模板名称必填').max(60),
      description: z.string().max(500).optional().default(''),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    const template = projectTemplateRepo.create({
      name: parsed.data.name,
      description: parsed.data.description,
      createdBy: req.userId,
    })
    res.status(201).json({ template })
  } catch (e) {
    next(e)
  }
})

// 更新模板（仅管理员）
router.patch('/project-templates/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以修改模板')
    }

    const template = projectTemplateRepo.findById(req.params.id)
    if (!template) throw new ApiError(404, '模板不存在')

    const schema = z.object({
      name: z.string().min(1).max(60).optional(),
      description: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    projectTemplateRepo.update(req.params.id, parsed.data)
    res.json({ template: projectTemplateRepo.findById(req.params.id)! })
  } catch (e) {
    next(e)
  }
})

// 删除模板（仅管理员，系统模板不可删）
router.delete('/project-templates/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以删除模板')
    }

    const template = projectTemplateRepo.findById(req.params.id)
    if (!template) throw new ApiError(404, '模板不存在')
    if (template.isSystem) throw new ApiError(400, '系统预设模板不能删除')

    projectTemplateRepo.delete(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// 从项目保存为模板（仅管理员）
router.post('/projects/:id/save-as-template', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以保存为模板')
    }

    const project = projectRepo.findById(req.params.id)
    if (!project) throw new ApiError(404, '项目不存在')

    const schema = z.object({
      templateName: z.string().min(1, '模板名称必填').max(60),
      templateDescription: z.string().max(500).optional().default(''),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    // 创建模板
    const template = projectTemplateRepo.create({
      name: parsed.data.templateName,
      description: parsed.data.templateDescription,
      createdBy: req.userId,
    })

    // 复制任务到模板
    const tasks = taskRepo.findByProject(req.params.id)
    tasks.forEach((task, index) => {
      templateTaskRepo.create({
        templateId: template.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        labels: task.labels,
        sortOrder: index,
        plannedHours: task.plannedHours,
      })
    })

    // 复制预算类别到模板
    const budgets = budgetRepo.findByProject(req.params.id)
    budgets.forEach(budget => {
      templateBudgetRepo.create({
        templateId: template.id,
        category: budget.category,
        description: budget.description,
      })
    })

    // 复制看板列配置到模板
    const kanbanColumns = kanbanColumnRepo.findByProject(req.params.id)
    kanbanColumns.forEach(col => {
      templateKanbanColumnRepo.create({
        templateId: template.id,
        statusKey: col.statusKey,
        label: col.label,
        color: col.color,
        sortOrder: col.sortOrder,
      })
    })

    res.status(201).json({
      template: projectTemplateRepo.findByIdWithDetails(template.id)
    })
  } catch (e) {
    next(e)
  }
})

// ===== 模板任务 CRUD =====

// 添加模板任务
router.post('/project-templates/:id/tasks', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板任务')
    }

    const template = projectTemplateRepo.findById(req.params.id)
    if (!template) throw new ApiError(404, '模板不存在')

    const schema = z.object({
      title: z.string().min(1, '任务标题必填').max(100),
      description: z.string().optional().default(''),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().default('todo'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
      labels: z.array(z.string()).optional().default([]),
      sortOrder: z.number().optional().default(0),
      plannedHours: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    const task = templateTaskRepo.create({
      templateId: req.params.id,
      title: parsed.data.title,
      description: parsed.data.description,
      labels: parsed.data.labels,
      sortOrder: parsed.data.sortOrder,
      plannedHours: parsed.data.plannedHours,
      status: parsed.data.status as TaskStatus,
      priority: parsed.data.priority as TaskPriority,
    })
    res.status(201).json({ task })
  } catch (e) {
    next(e)
  }
})

// 更新模板任务
router.patch('/template-tasks/:taskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板任务')
    }

    const task = templateTaskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')

    const schema = z.object({
      title: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      labels: z.array(z.string()).optional(),
      sortOrder: z.number().optional(),
      plannedHours: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    templateTaskRepo.update(req.params.taskId, {
      ...parsed.data,
      status: parsed.data.status as TaskStatus | undefined,
      priority: parsed.data.priority as TaskPriority | undefined,
    })
    res.json({ task: templateTaskRepo.findById(req.params.taskId)! })
  } catch (e) {
    next(e)
  }
})

// 删除模板任务
router.delete('/template-tasks/:taskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板任务')
    }

    const task = templateTaskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')

    templateTaskRepo.delete(req.params.taskId)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// ===== 模板预算类别 CRUD =====

// 添加模板预算类别
router.post('/project-templates/:id/budgets', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板预算')
    }

    const template = projectTemplateRepo.findById(req.params.id)
    if (!template) throw new ApiError(404, '模板不存在')

    const schema = z.object({
      category: z.enum(['labor', 'outsource', 'hardware', 'software', 'other']),
      description: z.string().optional().default(''),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    const budget = templateBudgetRepo.create({
      templateId: req.params.id,
      category: parsed.data.category as BudgetCategory,
      description: parsed.data.description,
    })
    res.status(201).json({ budget })
  } catch (e) {
    next(e)
  }
})

// 删除模板预算类别
router.delete('/template-budgets/:budgetId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板预算')
    }

    const budget = templateBudgetRepo.findById(req.params.budgetId)
    if (!budget) throw new ApiError(404, '预算类别不存在')

    templateBudgetRepo.delete(req.params.budgetId)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// ===== 模板看板列 CRUD =====

// 添加模板看板列
router.post('/project-templates/:id/kanban-columns', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板看板列')
    }

    const template = projectTemplateRepo.findById(req.params.id)
    if (!template) throw new ApiError(404, '模板不存在')

    const schema = z.object({
      statusKey: z.string().min(1),
      label: z.string().min(1).max(20),
      color: z.string().optional(),
      sortOrder: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    const column = templateKanbanColumnRepo.create({
      templateId: req.params.id,
      statusKey: parsed.data.statusKey,
      label: parsed.data.label,
      color: parsed.data.color,
      sortOrder: parsed.data.sortOrder,
    })
    res.status(201).json({ column })
  } catch (e) {
    next(e)
  }
})

// 更新模板看板列
router.patch('/template-kanban-columns/:columnId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板看板列')
    }

    const column = templateKanbanColumnRepo.findById(req.params.columnId)
    if (!column) throw new ApiError(404, '看板列不存在')

    const schema = z.object({
      label: z.string().min(1).max(20).optional(),
      color: z.string().optional(),
      sortOrder: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    templateKanbanColumnRepo.update(req.params.columnId, parsed.data)
    res.json({ column: templateKanbanColumnRepo.findById(req.params.columnId)! })
  } catch (e) {
    next(e)
  }
})

// 删除模板看板列
router.delete('/template-kanban-columns/:columnId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user || user.role !== 'admin') {
      throw new ApiError(403, '仅管理员可以管理模板看板列')
    }

    const column = templateKanbanColumnRepo.findById(req.params.columnId)
    if (!column) throw new ApiError(404, '看板列不存在')

    templateKanbanColumnRepo.delete(req.params.columnId)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

export default router
