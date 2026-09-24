// 项目路由

import { Router, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import multer from 'multer'
import bcrypt from 'bcrypt'
import ExcelJS from 'exceljs'
import { projectRepo, userRepo, kanbanColumnRepo, projectTemplateRepo, taskRepo, budgetRepo, notificationRepo, historyRepo, activityLogRepo } from '../repository/repo.ts'
import { authRequired, requirePermission, type AuthRequest } from '../lib/auth.ts'
import { pushFeishuNotification } from '../lib/notifier.ts'
import { ApiError } from '../lib/utils.ts'
import { normalizeProjectType } from '../../shared/types.ts'
import type { Project, ProjectStatus, MemberRole, User } from '../../shared/types.ts'

const router = Router()
router.use(authRequired)

// 配置 multer 用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 限制 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls']
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'))
    if (allowedTypes.includes(ext)) {
      cb(null, true)
    } else {
      cb(new ApiError(400, '不支持的文件格式，请使用 CSV 或 Excel 文件'))
    }
  }
})

const PROJECT_TYPE_MSG = '项目类型必须是：运维项目/开发项目/咨询项目/实施项目/产品迭代/运维增强'

const createSchema = z.object({
  name: z.string().min(1, '项目名称必填').max(60),
  // v1.8.5 起新建项目必须先选择项目类型
  projectType: z.string({ required_error: '请选择项目类型' }).refine((v) => normalizeProjectType(v) !== null, PROJECT_TYPE_MSG),
  description: z.string().max(500).optional().default(''),
  status: z.enum(['planning', 'active', 'completed', 'archived']).optional().default('planning'),
  startDate: z.string().nullable().optional().default(null),
  dueDate: z.string().nullable().optional().default(null),
  ownerId: z.string().optional(),
  templateId: z.string().optional(), // 新增：模板ID
})

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  projectType: z.string().refine((v) => normalizeProjectType(v) !== null, PROJECT_TYPE_MSG).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['planning', 'active', 'completed', 'archived']).optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
})

// 列表
router.get('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = userRepo.findById(req.userId!)
    if (!user) throw new ApiError(404, '用户不存在')
    let list = projectRepo.findAll()
    list.forEach((p) => {
      if (p.startDate) {
        projectRepo.updateProgress(p.id)
      }
    })
    list = projectRepo.findAll()
    if (user.role !== 'admin') {
      list = list.filter((p) => p.members.some((m) => m.userId === user.id) || p.ownerId === user.id)
    }
    res.json({ projects: list })
  } catch (e) { next(e) }
})

// 待审批删除项目列表（管理员/项目核算人员）
router.get('/pending-deletions', requirePermission('project.approve_delete'), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ projects: projectRepo.findPendingDeletions() })
  } catch (e) { next(e) }
})

// 项目读取守卫（v1.9.2）：admin/finance 全局放行，其余须为项目负责人或项目成员。
// 供 tasks/budgets 等项目级 GET 路由复用，保证「概览可见、详情有权限」。
export function assertProjectReadAccess(user: User | undefined, projectId: string): Project {
  const project = projectRepo.findById(projectId)
  if (!project) throw new ApiError(404, '项目不存在')
  if (!user) throw new ApiError(401, '未登录')
  if (user.role === 'admin' || user.role === 'finance') return project
  if (project.ownerId === user.id) return project
  if (projectRepo.members(project.id).some((m) => m.userId === user.id)) return project
  throw new ApiError(403, '无权查看该项目')
}

// 详情
router.get('/:projectId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = assertProjectReadAccess(userRepo.findById(req.userId!), req.params.projectId)
    if (project.startDate) {
      projectRepo.updateProgress(project.id)
    }
    res.json({ project: projectRepo.findById(project.id)! })
  } catch (e) { next(e) }
})

// 创建
router.post('/', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const user = userRepo.findById(req.userId!)
    if (!user) throw new ApiError(404, '用户不存在')
    // 非管理员不能指定其他人作为负责人
    let ownerId = req.userId!
    if (parsed.data.ownerId && parsed.data.ownerId !== req.userId) {
      if (user.role !== 'admin') {
        throw new ApiError(403, '无权指定他人为负责人')
      }
      if (!userRepo.findById(parsed.data.ownerId)) {
        throw new ApiError(400, '指定的负责人不存在')
      }
      ownerId = parsed.data.ownerId
    }
    const project = projectRepo.create({
      name: parsed.data.name,
      description: parsed.data.description,
      status: parsed.data.status as ProjectStatus,
      projectType: normalizeProjectType(parsed.data.projectType),
      ownerId,
      startDate: parsed.data.startDate,
      dueDate: parsed.data.dueDate,
    })
    // 自动添加负责人为成员
    projectRepo.addMember(project.id, ownerId, 'owner')

    // 如果指定了模板，复制模板数据到项目
    if (parsed.data.templateId) {
      const template = projectTemplateRepo.findByIdWithDetails(parsed.data.templateId)
      if (template) {
        // 复制模板任务到项目
        if (template.tasks && template.tasks.length > 0) {
          template.tasks.forEach((task) => {
            taskRepo.create({
              projectId: project.id,
              title: task.title,
              description: task.description,
              status: task.status,
              priority: task.priority,
              assigneeId: null,
              labels: task.labels,
              dueDate: null,
              startDate: null,
              plannedHours: task.plannedHours,
              progress: 0,
            })
          })
        }

        // 复制模板预算类别到项目
        if (template.budgets && template.budgets.length > 0) {
          template.budgets.forEach((budget) => {
            budgetRepo.create({
              projectId: project.id,
              category: budget.category,
              amount: 0, // 默认金额为0，需要用户后续设置
              description: budget.description,
              createdBy: req.userId!,
            })
          })
        }

        // 复制模板看板列配置到项目
        if (template.kanbanColumns && template.kanbanColumns.length > 0) {
          template.kanbanColumns.forEach((col) => {
            kanbanColumnRepo.create({
              projectId: project.id,
              statusKey: col.statusKey,
              label: col.label,
              color: col.color,
              sortOrder: col.sortOrder,
            })
          })
        }
      }
    }

    res.status(201).json({ project: projectRepo.findById(project.id)! })
  } catch (e) { next(e) }
})

// 更新
router.patch('/:projectId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权修改项目')
    }
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const { projectType, ...rest } = parsed.data
    projectRepo.update(project.id, {
      ...rest,
      ...(projectType !== undefined ? { projectType: normalizeProjectType(projectType) } : {}),
    })
    projectRepo.updateProgress(project.id)
    res.json({ project: projectRepo.findById(project.id)! })
  } catch (e) { next(e) }
})

// 管理员指派项目负责人：新负责人获得该项目全部管理权限，原负责人降为编辑成员
router.patch('/:projectId/owner', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const current = userRepo.findById(req.userId!)
    if (current?.role !== 'admin') throw new ApiError(403, '仅系统管理员可指派项目负责人')
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const parsed = z.object({ userId: z.string() }).safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const target = userRepo.findById(parsed.data.userId)
    if (!target) throw new ApiError(404, '用户不存在')
    if (target.id === project.ownerId) throw new ApiError(400, '该用户已是项目负责人')
    const updated = projectRepo.transferOwnership(project.id, target.id, project.ownerId)
    activityLogRepo.create(project.id, req.userId!, 'owner_transfer', `项目负责人: ${project.ownerName || '原负责人'} → ${target.name}`)
    res.json({ project: updated })
  } catch (e) { next(e) }
})

// 人员替换：把项目内原成员的所有任务/子任务指派一键转给新成员（负责人或管理员）
router.post('/:projectId/reassign', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const current = userRepo.findById(req.userId!)
    if (project.ownerId !== req.userId && current?.role !== 'admin') {
      throw new ApiError(403, '仅项目负责人或系统管理员可执行人员替换')
    }
    const parsed = z.object({ fromUserId: z.string(), toUserId: z.string() }).safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    const from = userRepo.findById(parsed.data.fromUserId)
    const to = userRepo.findById(parsed.data.toUserId)
    if (!from || !to) throw new ApiError(404, '用户不存在')
    if (from.id === to.id) throw new ApiError(400, '替换前后的成员不能相同')
    if (to.role === 'guest') throw new ApiError(400, '访客角色无任务指派资格，不能作为替换目标')

    const { taskIds, subtaskCount } = taskRepo.reassignProjectTasks(project.id, from.id, to.id)
    // 项目级操作日志：一条汇总留痕（任务级明细另见 task_history）
    activityLogRepo.create(project.id, req.userId!, 'reassign',
      `人员替换: ${from.name} → ${to.name}，涉及 ${taskIds.length} 个任务、${subtaskCount} 个子任务`)
    // 每个受影响任务写一条指派变更历史，保证任务时间线可追溯
    const label = `负责人: ${from.name} → ${to.name}（人员替换）`
    for (const taskId of taskIds) historyRepo.create(taskId, req.userId!, 'assignee_change', label)
    // 汇总通知：新成员接手 N 个任务、原成员任务已转派
    if (taskIds.length > 0) {
      try {
        if (to.id !== req.userId) {
          notificationRepo.create({ userId: to.id, type: 'assign', title: `你接手了 ${taskIds.length} 个任务`, body: `「${project.name}」中原「${from.name}」的任务已转给你`, projectId: project.id })
          pushFeishuNotification(to.id, 'assign', `你接手了 ${taskIds.length} 个任务`, `「${project.name}」中原「${from.name}」的任务已转给你`)
        }
        if (from.id !== req.userId) {
          notificationRepo.create({ userId: from.id, type: 'assign', title: `你的 ${taskIds.length} 个任务已转派`, body: `「${project.name}」中你的任务已转给「${to.name}」`, projectId: project.id })
          pushFeishuNotification(from.id, 'assign', `你的 ${taskIds.length} 个任务已转派`, `「${project.name}」中你的任务已转给「${to.name}」`)
        }
      } catch {
        // 忽略替换通知发送失败
      }
    }
    res.json({ replacedTasks: taskIds.length, replacedSubtasks: subtaskCount })
  } catch (e) { next(e) }
})

// 项目操作日志（负责人转移、人员替换等项目维度操作），项目成员可查看
router.get('/:projectId/activities', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    res.json({ rows: activityLogRepo.findByProject(project.id) })
  } catch (e) { next(e) }
})

// v1.9.0 结项合并：把运维增强项目的台账/课题记录批量转绑到目标运维项目
router.post('/:projectId/merge', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const source = projectRepo.findById(req.params.projectId)
    if (!source) throw new ApiError(404, '项目不存在')
    if (source.deletedAt) throw new ApiError(400, '已删除的项目不能合并')
    if (source.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权合并项目')
    }
    if (source.projectType !== '运维增强') {
      throw new ApiError(400, '仅「运维增强」类型的项目支持合并到运维项目')
    }
    if (source.mergedIntoProjectId) throw new ApiError(400, '该项目已合并过，不能重复合并')

    const schema = z.object({ targetProjectId: z.string().min(1, '请选择目标运维项目') })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    if (parsed.data.targetProjectId === source.id) throw new ApiError(400, '不能合并到项目自身')
    const target = projectRepo.findById(parsed.data.targetProjectId)
    if (!target || target.deletedAt) throw new ApiError(404, '目标运维项目不存在')
    if (target.projectType !== '运维项目') throw new ApiError(400, '目标项目必须是「运维项目」类型')
    if (target.mergedIntoProjectId) throw new ApiError(400, '目标项目已合并到其他项目，不能作为合并目标')

    const result = projectRepo.mergeProject(source.id, target.id)
    res.json({ ...result, project: projectRepo.findById(source.id)! })
  } catch (e) { next(e) }
})

// 添加成员
router.post('/:projectId/members', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理成员')
    }
    const schema = z.object({ userId: z.string(), role: z.enum(['owner', 'editor', 'viewer']).optional().default('editor') })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    if (!userRepo.findById(parsed.data.userId)) throw new ApiError(404, '用户不存在')
    projectRepo.addMember(project.id, parsed.data.userId, parsed.data.role as MemberRole)
    res.json({ members: projectRepo.members(project.id) })
  } catch (e) { next(e) }
})

// 修改成员角色
router.patch('/:projectId/members/:userId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理成员')
    }
    const schema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    projectRepo.updateMemberRole(project.id, req.params.userId, parsed.data.role as MemberRole)
    res.json({ members: projectRepo.members(project.id) })
  } catch (e) { next(e) }
})

// 移除成员
router.delete('/:projectId/members/:userId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理成员')
    }
    projectRepo.removeMember(project.id, req.params.userId)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ===== 看板列配置 =====

// 获取看板列配置
router.get('/:projectId/kanban-columns', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = assertProjectReadAccess(userRepo.findById(req.userId!), req.params.projectId)

    // 检查是否已有配置，没有则初始化默认列
    let columns = kanbanColumnRepo.findByProject(project.id)
    if (columns.length === 0) {
      kanbanColumnRepo.initDefaultColumns(project.id)
      columns = kanbanColumnRepo.findByProject(project.id)
    }

    res.json({ columns })
  } catch (e) { next(e) }
})

// 添加看板列
router.post('/:projectId/kanban-columns', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理看板列')
    }

    const schema = z.object({
      statusKey: z.string().min(1),
      label: z.string().min(1).max(20),
      color: z.string().optional(),
      sortOrder: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    const column = kanbanColumnRepo.create({
      projectId: req.params.projectId,
      statusKey: parsed.data.statusKey,
      label: parsed.data.label,
      color: parsed.data.color,
      sortOrder: parsed.data.sortOrder,
    })
    res.status(201).json({ column })
  } catch (e) { next(e) }
})

// 更新看板列
router.patch('/kanban-columns/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const column = kanbanColumnRepo.findById(req.params.id)
    if (!column) throw new ApiError(404, '看板列不存在')

    const project = projectRepo.findById(column.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理看板列')
    }

    const schema = z.object({
      label: z.string().min(1).max(20).optional(),
      color: z.string().optional(),
      sortOrder: z.number().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    kanbanColumnRepo.update(req.params.id, parsed.data)
    res.json({ column: kanbanColumnRepo.findById(req.params.id)! })
  } catch (e) { next(e) }
})

// 删除看板列
router.delete('/kanban-columns/:id', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const column = kanbanColumnRepo.findById(req.params.id)
    if (!column) throw new ApiError(404, '看板列不存在')

    const project = projectRepo.findById(column.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理看板列')
    }

    kanbanColumnRepo.delete(req.params.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 排序看板列
router.post('/:projectId/kanban-columns/reorder', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权管理看板列')
    }

    const schema = z.object({
      columnIds: z.array(z.string()).min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)

    // 更新排序
    parsed.data.columnIds.forEach((id, index) => {
      kanbanColumnRepo.update(id, { sortOrder: index })
    })

    res.json({ columns: kanbanColumnRepo.findByProject(req.params.projectId) })
  } catch (e) { next(e) }
})

// ===== 项目成员批量导入 =====

// 邮箱格式校验
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// 生成随机临时密码
function genTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

// 生成随机头像颜色
function genAvatarColor(): string {
  const colors = ['#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399', '#22D3EE', '#818CF8', '#E879F9', '#F472B6']
  return colors[Math.floor(Math.random() * colors.length)]
}

// 解析成员导入文件
async function parseMemberFile(file: Express.Multer.File): Promise<{ email: string; name: string; role?: string }[]> {
  const extension = file.originalname.split('.').pop()?.toLowerCase()

  if (extension === 'csv') {
    // 解析 CSV
    const content = file.buffer.toString('utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    // 跳过标题行
    return lines.slice(1).map(line => {
      const [email, name, role] = line.split(',').map(s => s.trim().replace(/"/g, ''))
      return { email, name, role }
    })
  } else if (extension === 'xlsx' || extension === 'xls') {
    // 使用 ExcelJS 解析 Excel
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file.buffer as unknown as Buffer)
    const worksheet = workbook.worksheets[0]
    const members: { email: string; name: string; role?: string }[] = []

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return // 跳过标题行
      const email = row.getCell(1).value?.toString() || ''
      const name = row.getCell(2).value?.toString() || ''
      const role = row.getCell(3).value?.toString()
      members.push({ email, name, role })
    })

    return members
  }

  throw new ApiError(400, '不支持的文件格式，请使用 CSV 或 Excel 文件')
}

// 批量导入项目成员
router.post('/:projectId/members/import', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')

    // 权限检查：只有项目负责人和管理员可以导入
    const currentUser = userRepo.findById(req.userId!)
    if (project.ownerId !== req.userId && currentUser?.role !== 'admin') {
      throw new ApiError(403, '只有项目负责人或管理员可以导入成员')
    }

    if (!req.file) {
      throw new ApiError(400, '请上传文件')
    }

    // 解析文件
    const members = await parseMemberFile(req.file)

    // 导入结果
    const results = {
      success: [] as { email: string; name: string; role: string }[],
      skipped: [] as { email: string; reason: string }[],
      errors: [] as { row: number; email?: string; error: string }[]
    }

    for (let i = 0; i < members.length; i++) {
      const member = members[i]
      const rowNumber = i + 2 // Excel 行号从2开始（第1行是标题）

      // 校验邮箱格式
      if (!member.email || !isValidEmail(member.email)) {
        results.errors.push({ row: rowNumber, email: member.email, error: `邮箱格式无效: ${member.email || '(空)'}` })
        continue
      }

      // 查找或创建用户
      let user = userRepo.findByEmail(member.email)
      if (!user) {
        // 创建新用户（随机密码）
        const tempPassword = genTempPassword()
        const passwordHash = await bcrypt.hash(tempPassword, 10)
        user = userRepo.create({
          email: member.email,
          name: member.name || member.email.split('@')[0],
          passwordHash,
          avatarColor: genAvatarColor(),
          role: 'member'
        })
      }

      // 检查是否已经是项目成员
      const existingMember = projectRepo.members(project.id).find(m => m.userId === user!.id)
      if (existingMember) {
        results.skipped.push({ email: member.email, reason: '已是项目成员' })
        continue
      }

      // 添加为项目成员
      const memberRole = (member.role as MemberRole) || 'viewer'
      projectRepo.addMember(project.id, user.id, memberRole)
      results.success.push({ email: member.email, name: user.name, role: memberRole })
    }

    res.json({ results })
  } catch (e) { next(e) }
})

// 下载导入模板
router.get('/:projectId/members/import/template', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')

    // 权限检查
    const currentUser = userRepo.findById(req.userId!)
    if (project.ownerId !== req.userId && currentUser?.role !== 'admin') {
      throw new ApiError(403, '只有项目负责人或管理员可以下载模板')
    }

    // 创建 Excel 工作簿
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('成员导入模板')

    // 设置列头
    worksheet.columns = [
      { header: '邮箱', key: 'email', width: 30 },
      { header: '姓名', key: 'name', width: 20 },
      { header: '角色', key: 'role', width: 15 }
    ]

    // 添加示例数据
    worksheet.addRow({
      email: 'example@email.com',
      name: '张三',
      role: 'viewer'
    })
    worksheet.addRow({
      email: 'developer@email.com',
      name: '李四',
      role: 'editor'
    })

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="member_import_template.xlsx"')

    // 发送文件
    workbook.xlsx.write(res).then(() => {
      res.end()
    }).catch(err => {
      next(err)
    })
  } catch (e) { next(e) }
})

// 删除项目：管理员直接删除；项目负责人本人提交删除申请，经管理员/项目核算审批后删除；其他人无权删除
router.delete('/:projectId', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findByIdWithTrash(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    const user = userRepo.findById(req.userId!)
    if (project.ownerId !== req.userId && user?.role !== 'admin') {
      throw new ApiError(403, '仅项目创建者或管理员可以删除项目')
    }
    // 管理员直接删除
    if (user?.role === 'admin') {
      projectRepo.softDelete(project.id)
      projectRepo.cancelDeletion(project.id)
      return res.json({ ok: true })
    }
    // 项目负责人本人 → 提交删除申请，等待审批
    if (project.deleteRequestedBy) {
      return res.json({ ok: true, pendingApproval: true, message: '删除申请已在审批中，请耐心等待' })
    }
    projectRepo.requestDeletion(project.id, req.userId!)
    res.json({ ok: true, pendingApproval: true, message: '已提交删除申请，等待管理员或项目核算人员审批' })
  } catch (e) { next(e) }
})

// 批准删除申请（管理员/项目核算人员）
router.post('/:projectId/deletion/approve', requirePermission('project.approve_delete'), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (!project.deleteRequestedBy) throw new ApiError(400, '该项目没有待审批的删除申请')
    projectRepo.softDelete(project.id)
    projectRepo.cancelDeletion(project.id)
    // 通知申请人
    notificationRepo.create({
      userId: project.deleteRequestedBy,
      type: 'system',
      title: `项目「${project.name}」删除申请已批准`,
      body: '你提交的项目删除申请已获批准，项目及其任务已移入回收站',
      projectId: project.id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 驳回删除申请（管理员/项目核算人员），可附驳回原因并通知申请人
const rejectDeletionSchema = z.object({
  comment: z.string().max(200, '驳回原因最多 200 字').optional().default(''),
})

router.post('/:projectId/deletion/reject', requirePermission('project.approve_delete'), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findById(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (!project.deleteRequestedBy) throw new ApiError(400, '该项目没有待审批的删除申请')
    const parsed = rejectDeletionSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message)
    projectRepo.rejectDeletion(project.id, parsed.data.comment)
    // 通知申请人（附驳回原因）
    notificationRepo.create({
      userId: project.deleteRequestedBy,
      type: 'system',
      title: `项目「${project.name}」删除申请被驳回`,
      body: parsed.data.comment ? `驳回原因：${parsed.data.comment}` : '管理员或项目核算人员驳回了该项目的删除申请',
      projectId: project.id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// 恢复已删除项目（级联恢复其下任务）
router.post('/:projectId/restore', (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = projectRepo.findByIdWithTrash(req.params.projectId)
    if (!project) throw new ApiError(404, '项目不存在')
    if (project.ownerId !== req.userId && userRepo.findById(req.userId!)?.role !== 'admin') {
      throw new ApiError(403, '无权恢复此项目')
    }
    projectRepo.restore(project.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default router