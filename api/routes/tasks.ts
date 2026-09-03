// 任务路由
// 路径说明:
//   - 项目内任务:   /projects/:projectId/tasks
//   - 单任务操作:   /tasks/:taskId
// 此 router 同时处理两类路径,挂在根 /api 下即可

import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { taskRepo, projectRepo, commentRepo, subtaskRepo, userRepo, notificationRepo, attachmentRepo, dependencyRepo, historyRepo, savedFilterRepo, type AuditRow } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import { sendMail, taskCompleteEmail } from '../lib/mail.ts'
import { pushFeishuNotification } from '../lib/notifier.ts'
import type { TaskStatus, TaskPriority, TaskFilter, Project } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// 全局搜索任务
router.get('/search', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const keyword = req.query.q as string
    if (!keyword || keyword.trim().length < 2) {
      return res.json({ tasks: [], projects: [], keyword: '' })
    }

    // 根据用户角色获取可见的项目ID列表
    const user = userRepo.findById(req.userId!)
    let projectIds: string[] | null = null
    if (user?.role !== 'admin' && user?.role !== 'finance') {
      // 非管理员只能搜索参与项目的任务
      const projects = projectRepo.findByMember(req.userId!)
      projectIds = projects.map(p => p.id)
    }

    // 搜索任务（标题、描述、标签）
    const tasks = taskRepo.search(keyword.trim(), projectIds)

    // 获取相关项目信息
    const projectMap = new Map<string, Project>()
    for (const t of tasks) {
      if (!projectMap.has(t.projectId)) {
        const p = projectRepo.findById(t.projectId)
        if (p) projectMap.set(t.projectId, p)
      }
    }

    res.json({
      tasks,
      projects: Array.from(projectMap.values()),
      keyword: keyword.trim()
    })
  } catch (e) { next(e) }
})

const createSchema = z.object({
  title: z.string().min(1, '任务标题必填').max(120),
  description: z.string().max(2000).optional().default(''),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  assigneeId: z.string().nullable().optional().default(null),
  labels: z.array(z.string()).optional().default([]),
  startDate: z.string().nullable().optional().default(null),
  dueDate: z.string().nullable().optional().default(null),
  plannedHours: z.number().optional().nullable(),
  progress: z.number().min(0).max(100).optional().default(0),
})

const updateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  plannedHours: z.number().optional().nullable(),
  progress: z.number().min(0).max(100).optional(),
})

// 列出某项目任务
router.get('/projects/:projectId/tasks', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')

    // 解析筛选参数
    const filter: TaskFilter = {}
    const { status, assigneeId, priority, labels, startDateFrom, startDateTo, dueDateFrom, dueDateTo, keyword } = req.query

    if (status && typeof status === 'string') {
      filter.status = status.split(',').filter(s => ['todo', 'in_progress', 'review', 'done'].includes(s)) as TaskStatus[]
    }
    if (assigneeId !== undefined) {
      filter.assigneeId = assigneeId === '' || assigneeId === 'null' ? null : String(assigneeId)
    }
    if (priority && typeof priority === 'string') {
      filter.priority = priority.split(',').filter(p => ['low', 'medium', 'high', 'urgent'].includes(p)) as TaskPriority[]
    }
    if (labels && typeof labels === 'string') {
      filter.labels = labels.split(',').map(l => l.trim()).filter(Boolean)
    }
    if (startDateFrom) filter.startDateFrom = String(startDateFrom)
    if (startDateTo) filter.startDateTo = String(startDateTo)
    if (dueDateFrom) filter.dueDateFrom = String(dueDateFrom)
    if (dueDateTo) filter.dueDateTo = String(dueDateTo)
    if (keyword && typeof keyword === 'string') {
      filter.keyword = keyword
    }

    const tasks = taskRepo.findByProject(project.id, filter)
    res.json({ project, tasks })
  } catch (e) { next(e) }
})

// 创建
router.post('/projects/:projectId/tasks', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    if (parsed.data.assigneeId && !userRepo.findById(parsed.data.assigneeId)) {
      throw new ApiError(400, '负责人不存在')
    }
    const task = taskRepo.create({
      projectId: project.id,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status as TaskStatus,
      priority: parsed.data.priority as TaskPriority,
      assigneeId: parsed.data.assigneeId,
      labels: parsed.data.labels,
      startDate: parsed.data.startDate,
      dueDate: parsed.data.dueDate,
      plannedHours: parsed.data.plannedHours,
    })
    projectRepo.updateProgress(project.id)
    historyRepo.create(task.id, req.userId, 'create', `创建任务: ${task.title}`)
    // 记录一条系统流水评论
    if (req.userId) {
        try { commentRepo.create(task.id, req.userId, '— 创建了任务 —') } catch {
          // 忽略评论创建失败
        }
    }
    // 指派通知
    if (task.assigneeId && task.assigneeId !== req.userId) {
      try {
        notificationRepo.create({
          userId: task.assigneeId,
          type: 'assign',
          title: `你被指派到任务`,
          body: `「${task.title}」`,
          taskId: task.id,
          projectId: project.id,
        })
        pushFeishuNotification(task.assigneeId, 'assign', '你被指派到任务', `「${task.title}」`)
      } catch {
        // 忽略通知发送失败
      }
    }
    res.status(201).json({ task })
  } catch (e) { next(e) }
})

// 任务详情(含评论与子任务)
router.get('/tasks/:taskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const comments = commentRepo.findByTask(task.id)
    const subtasks = subtaskRepo.findByTask(task.id)
    const attachments = attachmentRepo.findByTask(task.id)
    const history = historyRepo.findByTask(task.id, 20)
    res.json({ task, comments, subtasks, attachments, history })
  } catch (e) { next(e) }
})

// 更新
router.patch('/tasks/:taskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const prevAssignee = task.assigneeId
    const prevStatus = task.status
    taskRepo.update(task.id, parsed.data)
    projectRepo.updateProgress(task.projectId)
    const updated = taskRepo.findById(task.id)!
    // 记录操作历史
    if (parsed.data.status !== undefined && parsed.data.status !== prevStatus) {
      historyRepo.create(task.id, req.userId, 'status_change', `状态: ${prevStatus} → ${parsed.data.status}`)
    }
    if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== prevAssignee) {
      historyRepo.create(task.id, req.userId, 'assignee_change', `负责人: ${prevAssignee || '未分配'} → ${parsed.data.assigneeId || '未分配'}`)
    }
    if (parsed.data.progress !== undefined) {
      historyRepo.create(task.id, req.userId, 'progress_update', `进度: ${parsed.data.progress}%`)
    }
    if (parsed.data.startDate !== undefined || parsed.data.dueDate !== undefined) {
      const parts: string[] = []
      if (parsed.data.startDate) parts.push(`开始: ${parsed.data.startDate}`)
      if (parsed.data.dueDate) parts.push(`截止: ${parsed.data.dueDate}`)
      if (parts.length) historyRepo.create(task.id, req.userId, 'date_update', parts.join(', '))
    }
    // 负责人变更通知
    if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== prevAssignee) {
      const newAssignee = parsed.data.assigneeId as string | null
      if (newAssignee && newAssignee !== req.userId) {
        try {
          notificationRepo.create({
            userId: newAssignee,
            type: 'assign',
            title: '你被指派到任务',
            body: `「${updated.title}」`,
            taskId: updated.id,
            projectId: updated.projectId,
          })
          pushFeishuNotification(newAssignee, 'assign', '你被指派到任务', `「${updated.title}」`)
        } catch {
          // 忽略指派通知发送失败
        }
      }
      if (prevAssignee && prevAssignee !== req.userId && prevAssignee !== newAssignee) {
        try {
          notificationRepo.create({
            userId: prevAssignee,
            type: 'assign',
            title: '你已被解除指派',
            body: `任务「${updated.title}」不再分配给你`,
            taskId: updated.id,
            projectId: updated.projectId,
          })
          pushFeishuNotification(prevAssignee, 'assign', '你已被解除指派', `任务「${updated.title}」不再分配给你`)
        } catch {
          // 忽略解除指派通知发送失败
        }
      }
    }
    // 任务完成邮件通知
    if (parsed.data.status === 'done' && prevStatus !== 'done' && task.assigneeId && task.assigneeId !== req.userId) {
      const assignee = userRepo.findById(task.assigneeId)
      const project = projectRepo.findById(task.projectId)
      if (assignee && project) {
        sendMail(
          assignee.email,
          `任务已完成: ${task.title}`,
          taskCompleteEmail(task.title, project.name, assignee.name),
        ).catch(() => {})
      }
    }
    res.json({ task: updated })
  } catch (e) { next(e) }
})

// 仅更新状态(看板拖拽)
router.patch('/tasks/:taskId/status', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const schema = z.object({ status: z.enum(['todo', 'in_progress', 'review', 'done']) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const from = task.status
    taskRepo.updateStatus(task.id, parsed.data.status as TaskStatus)
    projectRepo.updateProgress(task.projectId)
    // 记录状态流转
    if (req.userId && from !== parsed.data.status) {
      const label: Record<string, string> = { todo: '待办', in_progress: '进行中', review: '审核中', done: '已完成' }
      try {
        commentRepo.create(task.id, req.userId, `— 将状态从「${label[from] || from}」改为「${label[parsed.data.status]}」 —`)
      } catch {
        // 忽略状态变更评论创建失败
      }
      // 通知负责人(若不是操作者本人)
      if (task.assigneeId && task.assigneeId !== req.userId) {
        try {
          notificationRepo.create({
            userId: task.assigneeId,
            type: 'status',
            title: `任务状态变更为「${label[parsed.data.status]}」`,
            body: `「${task.title}」`,
            taskId: task.id,
            projectId: task.projectId,
          })
          pushFeishuNotification(task.assigneeId, 'status', `任务状态变更为「${label[parsed.data.status]}」`, `「${task.title}」`)
        } catch {
          // 忽略状态变更通知发送失败
        }
        // 任务完成时发送邮件通知
        if (parsed.data.status === 'done') {
          const assignee = userRepo.findById(task.assigneeId)
          const project = projectRepo.findById(task.projectId)
          if (assignee && project) {
            sendMail(
              assignee.email,
              `任务已完成: ${task.title}`,
              taskCompleteEmail(task.title, project.name, assignee.name),
            ).catch(() => {})
          }
        }
      }
    }
    res.json({ task: taskRepo.findById(task.id)! })
  } catch (e) { next(e) }
})

router.delete('/tasks/:taskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const project = projectRepo.findById(task.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role === 'guest') {
      throw new ApiError(403, '访客无权删除任务')
    }
    taskRepo.softDelete(task.id)
    projectRepo.updateProgress(task.projectId)
    historyRepo.create(task.id, req.userId, 'trash', `移入回收站: ${task.title}`)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.post('/tasks/:taskId/restore', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findByIdWithTrash(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    if (!task.deletedAt) throw new ApiError(400, '任务未在回收站中')
    taskRepo.restore(task.id)
    projectRepo.updateProgress(task.projectId)
    historyRepo.create(task.id, req.userId, 'restore', `从回收站恢复: ${task.title}`)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.delete('/tasks/:taskId/physical', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findByIdWithTrash(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const project = projectRepo.findById(task.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role === 'guest') {
      throw new ApiError(403, '访客无权彻底删除任务')
    }
    taskRepo.physicalDelete(task.id)
    projectRepo.updateProgress(task.projectId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

router.get('/trash', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = req.query.projectId as string | undefined
    const tasks = taskRepo.findTrash(projectId)
    res.json({ tasks })
  } catch (e) { next(e) }
})

// 评论
router.post('/tasks/:taskId/comments', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const schema = z.object({ content: z.string().min(1, '评论不能为空').max(1000) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const comment = commentRepo.create(task.id, req.userId!, parsed.data.content)
    // 通知负责人(若不是本人)
    if (task.assigneeId && task.assigneeId !== req.userId) {
      try {
        notificationRepo.create({
          userId: task.assigneeId,
          type: 'comment',
          title: '有人评论了你负责的任务',
          body: parsed.data.content.slice(0, 60),
          taskId: task.id,
          projectId: task.projectId,
        })
        pushFeishuNotification(task.assigneeId, 'comment', '有人评论了你负责的任务', parsed.data.content.slice(0, 60))
      } catch {
        // 忽略评论通知发送失败
      }
    }
    // 解析 @提及 并发送通知
    const mentions = parseMentions(parsed.data.content)
    for (const name of mentions) {
      const mentioned = userRepo.findByName(name)
      if (mentioned && mentioned.id !== req.userId) {
        try {
          notificationRepo.create({
            userId: mentioned.id,
            type: 'comment',
            title: `你被 @ 提及了`,
            body: parsed.data.content.slice(0, 60),
            taskId: task.id,
            projectId: task.projectId,
          })
          pushFeishuNotification(mentioned.id, 'comment', `你被 @ 提及了`, parsed.data.content.slice(0, 60))
        } catch {
          // 忽略 @ 提及通知发送失败
        }
      }
    }
    res.status(201).json({ comment })
  } catch (e) { next(e) }
})

// ===== 子任务 =====
// 创建子任务
router.post('/tasks/:taskId/subtasks', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const schema = z.object({ title: z.string().min(1, '子任务不能为空').max(200) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const subtask = subtaskRepo.create(task.id, parsed.data.title)
    if (req.userId) {
      try { commentRepo.create(task.id, req.userId, `— 新增子任务:${parsed.data.title} —`) } catch {
        // 忽略子任务评论创建失败
      }
    }
    res.status(201).json({ subtask })
  } catch (e) { next(e) }
})

// 更新子任务(标题/完成状态)
router.patch('/subtasks/:subtaskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      title: z.string().min(1).max(200).optional(),
      done: z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    subtaskRepo.update(req.params.subtaskId, parsed.data)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 删除子任务
router.delete('/subtasks/:subtaskId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    subtaskRepo.delete(req.params.subtaskId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ===== 任务依赖关系 =====
// 获取任务的依赖关系
router.get('/tasks/:taskId/dependencies', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const dependencies = dependencyRepo.findByTask(task.id)
    res.json({ dependencies })
  } catch (e) { next(e) }
})

// 添加依赖关系
router.post('/tasks/:taskId/dependencies', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = taskRepo.findById(req.params.taskId)
    if (!task) throw new ApiError(404, '任务不存在')
    const schema = z.object({
      dependsOnTaskId: z.string().min(1),
      type: z.enum(['fs', 'ss', 'ff', 'sf']).optional().default('fs'),
      lagDays: z.number().int().optional().default(0),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const targetTask = taskRepo.findById(parsed.data.dependsOnTaskId)
    if (!targetTask) throw new ApiError(400, '被依赖的任务不存在')
    if (targetTask.projectId !== task.projectId) throw new ApiError(400, '只能依赖同一项目的任务')
    if (parsed.data.dependsOnTaskId === task.id) throw new ApiError(400, '不能依赖自己')
    const dependency = dependencyRepo.create({
      taskId: task.id,
      dependsOnTaskId: parsed.data.dependsOnTaskId,
      type: parsed.data.type as 'fs' | 'ss' | 'ff' | 'sf',
      lagDays: parsed.data.lagDays,
    })
    res.status(201).json({ dependency })
  } catch (e) { next(e) }
})

// 更新依赖关系
router.patch('/dependencies/:depId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      type: z.enum(['fs', 'ss', 'ff', 'sf']),
      lagDays: z.number().int(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const updated = dependencyRepo.update(req.params.depId, {
      type: parsed.data.type,
      lagDays: parsed.data.lagDays,
    })
    if (!updated) throw new ApiError(404, '依赖关系不存在')
    res.json({ dependency: updated })
  } catch (e) { next(e) }
})

// 删除依赖关系
router.delete('/dependencies/:depId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    dependencyRepo.delete(req.params.depId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 批量获取项目所有依赖关系
router.get('/projects/:projectId/dependencies', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const dependencies = dependencyRepo.findByProject(project.id)
    res.json({ dependencies })
  } catch (e) { next(e) }
})

router.get('/history/audit', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.userRole !== 'admin') {
      return next(new ApiError(403, '仅管理员可查看审计日志'))
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const offset = req.query.offset ? Number(req.query.offset) : undefined
    const userId = req.query.user_id as string | undefined
    const action = req.query.action as string | undefined
    const since = req.query.since as string | undefined
    const result = historyRepo.listAudit({ limit, offset, userId, action, since })
    const rows = result.rows.map((r: AuditRow) => ({
      task_id: r.taskId,
      task_title: r.taskTitle,
      user_name: r.userName,
      action: r.action,
      detail: r.detail,
      created_at: r.createdAt,
    }))
    res.json({ rows, total: result.total })
  } catch (e) { next(e) }
})

// ===== 筛选方案 =====
// 获取用户的筛选方案列表
router.get('/projects/:projectId/filters', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filters = savedFilterRepo.findByUser(req.userId!, req.params.projectId)
    res.json({ filters })
  } catch (e) { next(e) }
})

// 保存筛选方案
router.post('/projects/:projectId/filters', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().min(1, '方案名称必填').max(50),
      filterConfig: z.object({
        status: z.array(z.enum(['todo', 'in_progress', 'review', 'done'])).optional(),
        assigneeId: z.string().nullable().optional(),
        priority: z.array(z.enum(['low', 'medium', 'high', 'urgent'])).optional(),
        labels: z.array(z.string()).optional(),
        startDateFrom: z.string().optional(),
        startDateTo: z.string().optional(),
        dueDateFrom: z.string().optional(),
        dueDateTo: z.string().optional(),
        keyword: z.string().optional(),
      }),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    const filter = savedFilterRepo.create({
      userId: req.userId!,
      projectId: req.params.projectId,
      name: parsed.data.name,
      filterConfig: parsed.data.filterConfig as TaskFilter,
    })
    res.status(201).json({ filter })
  } catch (e) { next(e) }
})

// 删除筛选方案
router.delete('/filters/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter = savedFilterRepo.findById(req.params.id)
    if (!filter) throw new ApiError(404, '筛选方案不存在')
    if (filter.userId !== req.userId) throw new ApiError(403, '无权删除此筛选方案')
    savedFilterRepo.delete(req.params.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default router

function parseMentions(content: string): string[] {
  const regex = /@(\S+)/g
  const names = new Set<string>()
  let match
  while ((match = regex.exec(content)) !== null) {
    names.add(match[1])
  }
  return [...names]
}