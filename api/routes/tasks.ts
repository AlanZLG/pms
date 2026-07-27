// 任务路由
// 路径说明:
//   - 项目内任务:   /projects/:projectId/tasks
//   - 单任务操作:   /tasks/:taskId
// 此 router 同时处理两类路径,挂在根 /api 下即可

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { taskRepo, projectRepo, commentRepo, subtaskRepo, userRepo, notificationRepo, attachmentRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'
import { sendMail, taskCompleteEmail } from '../lib/mail.ts'
import type { TaskStatus, TaskPriority } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

const createSchema = z.object({
  title: z.string().min(1, '任务标题必填').max(120),
  description: z.string().max(2000).optional().default(''),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).optional().default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  assigneeId: z.string().nullable().optional().default(null),
  labels: z.array(z.string()).optional().default([]),
  dueDate: z.string().nullable().optional().default(null),
})

const updateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().nullable().optional(),
})

// 列出某项目任务
router.get('/projects/:projectId/tasks', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const tasks = taskRepo.findByProject(project.id)
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
      dueDate: parsed.data.dueDate,
    })
    projectRepo.updateProgress(project.id)
    // 记录一条系统流水评论
    if (req.userId) {
      try { commentRepo.create(task.id, req.userId, '— 创建了任务 —') } catch {}
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
      } catch {}
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
    res.json({ task, comments, subtasks, attachments })
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
    taskRepo.update(task.id, parsed.data as any)
    projectRepo.updateProgress(task.projectId)
    const updated = taskRepo.findById(task.id)!
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
        } catch {}
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
        } catch {}
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
      } catch {}
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
        } catch {}
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
    taskRepo.remove(task.id)
    projectRepo.updateProgress(task.projectId)
    res.json({ ok: true })
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
      } catch {}
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
        } catch {}
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
      try { commentRepo.create(task.id, req.userId, `— 新增子任务:${parsed.data.title} —`) } catch {}
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