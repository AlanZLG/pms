import { Router, type Response, type NextFunction } from 'express'
import { taskRepo, projectRepo, userRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'
import { ApiError } from '../lib/utils.ts'

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