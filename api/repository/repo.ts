// 数据访问层

import db, { type SqlRow, type SqlParam } from '../db.ts'
import { genId, parseLabels } from '../lib/utils.ts'
import type {
  User, Project, ProjectMember, Task, Comment, Subtask, Notification, Template, Attachment, TaskStatus,
  ProjectStatus, TaskPriority, MemberRole, ProjectBudget, ProjectExpense, TaskHours, BudgetCategory,
  UserCategory, TaskDependency, TaskHistory, SavedFilter, TaskFilter, KanbanColumn,
  ProjectTemplate, TemplateTask, TemplateBudget, TemplateKanbanColumn,
  CustomRole, Permission, PermissionCategory,
} from '../../shared/types.ts'

// ===== Users =====
export const userRepo = {
  findByEmail(email: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as SqlRow
    return row ? rowToUser(row) : null
  },
  findById(id: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as SqlRow
    return row ? rowToUser(row) : null
  },
  findByName(name: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE name = ?').get(name) as SqlRow
    return row ? rowToUser(row) : null
  },
  findAll(): User[] {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as SqlRow[]
    return rows.map(rowToUser)
  },
  create(data: { email: string; passwordHash: string; name: string; avatarColor: string; role: string }): User {
    const id = genId()
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, avatar_color, role, created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(id, data.email, data.passwordHash, data.name, data.avatarColor, data.role, new Date().toISOString())
    return this.findById(id)!
  },
  updateRole(id: string, role: string): void {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  },
  bindFeishu(id: string, openId: string, unionId: string): void {
    db.prepare(
      'UPDATE users SET feishu_open_id = ?, feishu_union_id = ?, feishu_bound_at = ? WHERE id = ?',
    ).run(openId, unionId, new Date().toISOString(), id)
  },
  unbindFeishu(id: string): void {
    db.prepare(
      'UPDATE users SET feishu_open_id = NULL, feishu_union_id = NULL, feishu_bound_at = NULL WHERE id = ?',
    ).run(id)
  },
  updateName(id: string, name: string): User | null {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id)
    return this.findById(id)
  },
  updateCost(id: string, data: { isOutsourced?: boolean; hourlyRate?: number | null; costCenter?: string | null; categoryId?: string | null }): User | null {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.isOutsourced !== undefined) { fields.push('is_outsourced = ?'); values.push(data.isOutsourced ? 1 : 0) }
    if (data.hourlyRate !== undefined) { fields.push('hourly_rate = ?'); values.push(data.hourlyRate) }
    if (data.costCenter !== undefined) { fields.push('cost_center = ?'); values.push(data.costCenter) }
    if (data.categoryId !== undefined) { fields.push('category_id = ?'); values.push(data.categoryId) }
    if (!fields.length) return this.findById(id)
    values.push(id)
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  },
  updateCustomRole(id: string, customRoleId: string | null): void {
    db.prepare('UPDATE users SET custom_role_id = ? WHERE id = ?').run(customRoleId, id)
  },
}

// ===== Projects =====
export const projectRepo = {
  findAll(): Project[] {
    const rows = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      ORDER BY p.created_at DESC
    `).all() as SqlRow[]
    return rows.map(rowToProject)
  },
  findById(id: string): Project | null {
    const row = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(id) as SqlRow
    return row ? rowToProject(row) : null
  },
  findByMember(userId: string): Project[] {
    const rows = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      JOIN project_members m ON m.project_id = p.id
      WHERE m.user_id = ?
      ORDER BY p.created_at DESC
    `).all(userId) as SqlRow[]
    return rows.map(rowToProject)
  },
  create(data: { name: string; description: string; status: ProjectStatus; ownerId: string; startDate?: string | null; dueDate: string | null }): Project {
    const id = genId()
    const progress = data.startDate ? this.calculateTimeProgress(data.startDate) : 0
    db.prepare(
      'INSERT INTO projects (id, name, description, status, owner_id, progress, start_date, due_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(id, data.name, data.description, data.status, data.ownerId, progress, data.startDate || null, data.dueDate, new Date().toISOString())
    db.prepare(
      'INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)',
    ).run(genId(), id, data.ownerId, 'owner', new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string; status: ProjectStatus; startDate: string | null; dueDate: string | null }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.startDate !== undefined) { fields.push('start_date = ?'); values.push(data.startDate) }
    if (data.dueDate !== undefined) { fields.push('due_date = ?'); values.push(data.dueDate) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  calculateTimeProgress(startDate: string): number {
    const start = new Date(startDate)
    const now = new Date()
    const elapsedDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    if (elapsedDays < 0) return 0
    const year = now.getFullYear()
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
    const totalDays = isLeapYear ? 366 : 365
    if (elapsedDays >= totalDays) return 100
    return Math.round((elapsedDays / totalDays) * 100)
  },
  updateProgress(id: string): void {
    const project = this.findById(id)
    if (!project) return
    const row = db.prepare(
      `SELECT
         COUNT(*) as total,
         AVG(COALESCE(progress, 0)) as avg_progress,
         SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as dones
       FROM tasks WHERE project_id = ?`,
    ).get(id) as { total: number; avg_progress: number | null; dones: number }
    if (row.total === 0) return
    const taskProgress = Math.round(row.avg_progress ?? 0)
    const doneProgress = row.total === 0 ? 0 : Math.round((row.dones / row.total) * 100)
    const progress = Math.max(taskProgress, doneProgress)
    db.prepare('UPDATE projects SET progress = ? WHERE id = ?').run(progress, id)
  },
  members(projectId: string): ProjectMember[] {
    const rows = db.prepare(`
      SELECT pm.user_id, pm.role, pm.joined_at,
             u.name as user_name, u.avatar_color, u.email
      FROM project_members pm JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? ORDER BY pm.joined_at ASC
    `).all(projectId) as SqlRow[]
    return rows.map((r) => ({
      userId: r.user_id,
      role: r.role as MemberRole,
      joinedAt: r.joined_at,
      user: { name: r.user_name, avatarColor: r.avatar_color, email: r.email },
    }))
  },
  addMember(projectId: string, userId: string, role: MemberRole): void {
    db.prepare('INSERT OR IGNORE INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)')
      .run(genId(), projectId, userId, role, new Date().toISOString())
  },
  updateMemberRole(projectId: string, userId: string, role: MemberRole): void {
    db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(role, projectId, userId)
  },
  removeMember(projectId: string, userId: string): void {
    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId)
  },
}

// ===== Tasks =====
export const taskRepo = {
  search(keyword: string, projectIds: string[] | null): Task[] {
    const likeKeyword = `%${keyword}%`
    let sql = `
      SELECT * FROM tasks 
      WHERE deleted_at IS NULL 
      AND (title LIKE ? OR description LIKE ? OR labels LIKE ?)
    `
    const params: SqlParam[] = [likeKeyword, likeKeyword, likeKeyword]

    if (projectIds && projectIds.length > 0) {
      sql += ` AND project_id IN (${projectIds.map(() => '?').join(',')})`
      params.push(...projectIds)
    }

    sql += ` ORDER BY updated_at DESC LIMIT 100`

    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToTask)
  },

  findByProject(projectId: string, filter?: TaskFilter): Task[] {
    if (!filter || Object.keys(filter).length === 0) {
      const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at ASC').all(projectId) as SqlRow[]
      return rows.map(rowToTask)
    }

    const conditions: string[] = ['project_id = ?', 'deleted_at IS NULL']
    const values: SqlParam[] = [projectId]

    if (filter.status && filter.status.length > 0) {
      conditions.push(`status IN (${filter.status.map(() => '?').join(',')})`)
      values.push(...filter.status)
    }
    if (filter.assigneeId !== undefined) {
      if (filter.assigneeId === null) {
        conditions.push('assignee_id IS NULL')
      } else {
        conditions.push('assignee_id = ?')
        values.push(filter.assigneeId)
      }
    }
    if (filter.priority && filter.priority.length > 0) {
      conditions.push(`priority IN (${filter.priority.map(() => '?').join(',')})`)
      values.push(...filter.priority)
    }
    if (filter.labels && filter.labels.length > 0) {
      filter.labels.forEach((label) => {
        conditions.push('labels LIKE ?')
        values.push(`%${label}%`)
      })
    }
    if (filter.startDateFrom) {
      conditions.push('start_date >= ?')
      values.push(filter.startDateFrom)
    }
    if (filter.startDateTo) {
      conditions.push('start_date <= ?')
      values.push(filter.startDateTo)
    }
    if (filter.dueDateFrom) {
      conditions.push('due_date >= ?')
      values.push(filter.dueDateFrom)
    }
    if (filter.dueDateTo) {
      conditions.push('due_date <= ?')
      values.push(filter.dueDateTo)
    }
    if (filter.keyword) {
      conditions.push('(title LIKE ? OR description LIKE ?)')
      values.push(`%${filter.keyword}%`, `%${filter.keyword}%`)
    }

    const sql = `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`
    const rows = db.prepare(sql).all(...values) as SqlRow[]
    return rows.map(rowToTask)
  },
  findById(id: string): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as SqlRow
    return row ? rowToTask(row) : null
  },
  findByAssignee(userId: string): Task[] {
    const rows = db.prepare(`
      SELECT * FROM tasks
      WHERE assignee_id = ? AND status != 'done' AND deleted_at IS NULL
      ORDER BY due_date IS NULL, due_date ASC
    `).all(userId) as SqlRow[]
    return rows.map(rowToTask)
  },
  findByAssigneeAll(userId: string): Task[] {
    const rows = db.prepare('SELECT * FROM tasks WHERE assignee_id = ? AND deleted_at IS NULL').all(userId) as SqlRow[]
    return rows.map(rowToTask)
  },
  findTrash(projectId?: string): Task[] {
    const sql = projectId
      ? 'SELECT * FROM tasks WHERE deleted_at IS NOT NULL AND project_id = ? ORDER BY deleted_at DESC'
      : 'SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    const rows = db.prepare(sql).all(projectId) as SqlRow[]
    return rows.map(rowToTask)
  },
  create(data: {
    projectId: string; title: string; description: string;
    status: TaskStatus; priority: TaskPriority;
    assigneeId: string | null; labels: string[]; dueDate: string | null;
    startDate?: string | null; plannedHours?: number; progress?: number;
  }): Task {
    const id = genId()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, labels, due_date, start_date, planned_hours, progress, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, data.projectId, data.title, data.description, data.status, data.priority, data.assigneeId, JSON.stringify(data.labels), data.dueDate, data.startDate || null, data.plannedHours || null, data.progress ?? 0, now, now)
    return this.findById(id)!
  },
  update(id: string, data: Partial<{
    title: string; description: string; status: TaskStatus;
    priority: TaskPriority; assigneeId: string | null;
    labels: string[]; dueDate: string | null;
    startDate: string | null; plannedHours: number; progress: number;
  }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority) }
    if (data.assigneeId !== undefined) { fields.push('assignee_id = ?'); values.push(data.assigneeId) }
    if (data.labels !== undefined) { fields.push('labels = ?'); values.push(JSON.stringify(data.labels)) }
    if (data.dueDate !== undefined) { fields.push('due_date = ?'); values.push(data.dueDate) }
    if (data.startDate !== undefined) { fields.push('start_date = ?'); values.push(data.startDate) }
    if (data.plannedHours !== undefined) { fields.push('planned_hours = ?'); values.push(data.plannedHours) }
    if (data.progress !== undefined) { fields.push('progress = ?'); values.push(data.progress) }
    if (!fields.length) return
    fields.push('updated_at = ?'); values.push(new Date().toISOString())
    values.push(id)
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  updateStatus(id: string, status: TaskStatus): void {
    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id)
  },
  remove(id: string): void {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  },
  softDelete(id: string): void {
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  },
  restore(id: string): void {
    db.prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ?').run(id)
  },
  physicalDelete(id: string): void {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  },
  findByIdWithTrash(id: string): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as SqlRow
    return row ? rowToTask(row) : null
  },
  countByStatus(projectId?: string): Record<string, number> {
    const where = projectId ? `WHERE project_id = ? AND deleted_at IS NULL` : 'WHERE deleted_at IS NULL'
    const params = projectId ? [projectId] : []
    const rows = db.prepare(
      `SELECT status, COUNT(*) as c FROM tasks ${where} GROUP BY status`,
    ).all(...params) as { status: string; c: number }[]
    const result: Record<string, number> = { todo: 0, in_progress: 0, review: 0, done: 0 }
    rows.forEach((r) => { result[r.status] = r.c })
    return result
  },
  trendDaily(days = 14): { date: string; completed: number; created: number }[] {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const createdRows = db.prepare(`
      SELECT DATE(created_at) as d, COUNT(*) as c FROM tasks
      WHERE created_at >= ? AND deleted_at IS NULL
      GROUP BY d ORDER BY d
    `).all(since) as { d: string; c: number }[]
    const doneRows = db.prepare(`
      SELECT DATE(updated_at) as d, COUNT(*) as c FROM tasks
      WHERE status = 'done' AND updated_at >= ? AND deleted_at IS NULL
      GROUP BY d ORDER BY d
    `).all(since) as { d: string; c: number }[]
    const map: Record<string, { completed: number; created: number }> = {}
    createdRows.forEach((r) => { map[r.d] = { completed: 0, created: r.c } })
    doneRows.forEach((r) => {
      if (!map[r.d]) map[r.d] = { completed: 0, created: 0 }
      map[r.d].completed = r.c
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))
  },
  burndown(projectId: string): { dates: string[]; ideal: number[]; actual: number[] } {
    const tasks = db.prepare('SELECT created_at, updated_at, status FROM tasks WHERE project_id = ? AND deleted_at IS NULL').all(projectId) as SqlRow[]
    if (tasks.length === 0) return { dates: [], ideal: [], actual: [] }
    const startDate = tasks.map((t) => t.created_at).sort()[0]
    // 配套结束于最近一次完成
    const doneEvents = tasks.filter((t) => t.status === 'done').map((t) => t.updated_at).sort()
    const endDate = doneEvents.length ? doneEvents[doneEvents.length - 1] : new Date().toISOString()
    const start = new Date(startDate)
    const end = new Date(endDate)
    const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000))
    const total = tasks.length
    const dates: string[] = []
    const ideal: number[] = []
    const actual: number[] = []
    const completedByDate = new Map<string, number>()
    tasks.forEach((t) => {
      if (t.status === 'done') {
        const d = new Date(t.updated_at).toISOString().slice(0, 10)
        completedByDate.set(d, (completedByDate.get(d) || 0) + 1)
      }
    })
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(start.getTime() + i * 86400000)
      const key = d.toISOString().slice(0, 10)
      dates.push(key)
      ideal.push(Math.round(total * (1 - i / totalDays)))
    }
    let remaining = total
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(start.getTime() + i * 86400000)
      const key = d.toISOString().slice(0, 10)
      remaining -= completedByDate.get(key) || 0
      actual.push(Math.max(0, remaining))
    }
    return { dates, ideal, actual }
  },
}

// ===== Comments =====
export const commentRepo = {
  findByTask(taskId: string): Comment[] {
    const rows = db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar_color
      FROM comments c JOIN users u ON c.user_id = u.id
      WHERE c.task_id = ?
      ORDER BY c.created_at ASC
    `).all(taskId) as SqlRow[]
    return rows.map(rowToComment)
  },
  create(taskId: string, userId: string, content: string): Comment {
    const id = genId()
    db.prepare('INSERT INTO comments (id, task_id, user_id, content, created_at) VALUES (?,?,?,?,?)')
      .run(id, taskId, userId, content, new Date().toISOString())
    return this.findByTask(taskId).find((c) => c.id === id)!
  },
}

// ===== Task History =====
export const historyRepo = {
  create(taskId: string, userId: string, action: string, detail?: string): void {
    const id = genId()
    db.prepare(
      'INSERT INTO task_history (id, task_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?,?)',
    ).run(id, taskId, userId, action, detail || null, new Date().toISOString())
  },
  findByTask(taskId: string, limit = 20): TaskHistory[] {
    const rows = db.prepare(`
      SELECT h.*, u.name as user_name
      FROM task_history h
      JOIN users u ON h.user_id = u.id
      WHERE h.task_id = ?
      ORDER BY h.created_at DESC
      LIMIT ?
    `).all(taskId, limit) as SqlRow[]
    return rows.map((r) => ({
      id: r.id, taskId: r.task_id, userId: r.user_id,
      userName: r.user_name, action: r.action, detail: r.detail,
      createdAt: r.created_at,
    }))
  },
  listAudit(opts: { limit?: number; offset?: number; userId?: string; action?: string; since?: string }): { rows: AuditRow[]; total: number } {
    const where: string[] = []
    const values: SqlParam[] = []
    if (opts.userId) { where.push('h.user_id = ?'); values.push(opts.userId) }
    if (opts.action) { where.push('h.action = ?'); values.push(opts.action) }
    if (opts.since) { where.push('h.created_at >= ?'); values.push(opts.since) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) as c FROM task_history h ${whereSql}`).get(...values) as { c: number }).c
    const limit = Math.min(1000, opts.limit ?? 100)
    const offset = opts.offset ?? 0
    const rows = db.prepare(`
      SELECT h.id, h.task_id, h.action, h.detail, h.created_at,
             t.title as task_title,
             u.name as user_name
      FROM task_history h
      JOIN tasks t ON h.task_id = t.id
      JOIN users u ON h.user_id = u.id
      ${whereSql}
      ORDER BY h.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as SqlRow[]
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        taskTitle: r.task_title,
        userName: r.user_name,
        action: r.action,
        detail: r.detail,
        createdAt: r.created_at,
      })),
    }
  },
}

// ===== Subtasks =====
export const subtaskRepo = {
  findByTask(taskId: string): Subtask[] {
    const rows = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as SqlRow[]
    return rows.map(rowToSubtask)
  },
  create(taskId: string, title: string): Subtask {
    const id = genId()
    db.prepare('INSERT INTO subtasks (id, task_id, title, done, created_at) VALUES (?,?,?,?,?)')
      .run(id, taskId, title, 0, new Date().toISOString())
    return this.findByTask(taskId).find((s) => s.id === id)!
  },
  update(id: string, data: { title?: string; done?: boolean }): void {
    if (data.title !== undefined) {
      db.prepare('UPDATE subtasks SET title = ? WHERE id = ?').run(data.title, id)
    }
    if (data.done !== undefined) {
      db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(data.done ? 1 : 0, id)
    }
  },
  delete(id: string): void {
    db.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
  },
}

// ===== Notifications =====
export const notificationRepo = {
  findByUser(userId: string, limit = 50, type?: string): Notification[] {
    const rows = type
      ? db.prepare(
          'SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?',
        ).all(userId, type, limit) as SqlRow[]
      : db.prepare(
          'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        ).all(userId, limit) as SqlRow[]
    return rows.map(rowToNotification)
  },
  unreadCount(userId: string, type?: string): number {
    const r = type
      ? db.prepare(
          'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0 AND type = ?',
        ).get(userId, type) as { c: number }
      : db.prepare(
          'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0',
        ).get(userId) as { c: number }
    return r.c
  },
  create(data: {
    userId: string
    type: 'assign' | 'status' | 'comment' | 'system'
    title: string
    body: string
    taskId?: string | null
    projectId?: string | null
  }): Notification {
    const id = genId()
    db.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, task_id, project_id, read, created_at) VALUES (?,?,?,?,?,?,?,0,?)',
    ).run(
      id, data.userId, data.type, data.title, data.body,
      data.taskId || null, data.projectId || null, new Date().toISOString(),
    )
    return this.findByUser(data.userId).find((n) => n.id === id)!
  },
  markRead(id: string): void {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id)
  },
  markAllRead(userId: string): void {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM notifications WHERE id = ?').run(id)
  },
  findNewerThan(userId: string, since: Date): Notification[] {
    const rows = db.prepare(
      `SELECT * FROM notifications WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 50`
    ).all(userId, since.toISOString()) as SqlRow[]
    return rows.map(rowToNotification)
  },
}

// ===== Templates =====
export const templateRepo = {
  findAll(): Template[] {
    const rows = db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all() as SqlRow[]
    return rows.map(rowToTemplate)
  },
  create(data: {
    name: string
    title: string
    description: string
    priority: string
    labels: string[]
  }): Template {
    const id = genId()
    db.prepare(
      'INSERT INTO templates (id, name, title, description, priority, labels, created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      id, data.name, data.title, data.description, data.priority,
      data.labels.join(','), new Date().toISOString(),
    )
    return this.findById(id)!
  },
  update(id: string, data: { name?: string; title?: string; description?: string; priority?: string; labels?: string[] }): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority) }
    if (data.labels !== undefined) { fields.push('labels = ?'); values.push(data.labels.join(',')) }
    if (fields.length === 0) return
    values.push(id)
    db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  },
  findById(id: string): Template | null {
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as SqlRow
    return row ? rowToTemplate(row) : null
  },
}

// ===== Attachments =====
export const attachmentRepo = {
  findByTask(taskId: string): Attachment[] {
    const rows = db.prepare(`
      SELECT a.*, u.name as user_name
      FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.task_id = ?
      ORDER BY a.created_at DESC
    `).all(taskId) as SqlRow[]
    return rows.map(rowToAttachment)
  },
  findById(id: string): Attachment | null {
    const row = db.prepare(`
      SELECT a.*, u.name as user_name
      FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.id = ?
    `).get(id) as SqlRow
    return row ? rowToAttachment(row) : null
  },
  create(data: {
    taskId: string; userId: string; filename: string;
    originalName: string; size: number; mimeType: string;
  }): Attachment {
    const id = genId()
    db.prepare(
      `INSERT INTO attachments (id, task_id, user_id, filename, original_name, size, mime_type, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, data.taskId, data.userId, data.filename, data.originalName, data.size, data.mimeType, new Date().toISOString())
    return this.findById(id)!
  },
  delete(id: string): void {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
  },
}

// ===== Task Dependencies =====
export const dependencyRepo = {
  findByTask(taskId: string): TaskDependency[] {
    const rows = db.prepare('SELECT * FROM task_dependencies WHERE task_id = ?').all(taskId) as SqlRow[]
    return rows.map(rowToDependency)
  },
  findByProject(projectId: string): TaskDependency[] {
    const rows = db.prepare(`
      SELECT td.* FROM task_dependencies td
      JOIN tasks t ON td.task_id = t.id
      WHERE t.project_id = ?
    `).all(projectId) as SqlRow[]
    return rows.map(rowToDependency)
  },
  create(data: {
    taskId: string; dependsOnTaskId: string; type: 'fs' | 'ss' | 'ff' | 'sf'; lagDays?: number;
  }): TaskDependency {
    const id = genId()
    db.prepare(
      `INSERT INTO task_dependencies (id, task_id, depends_on_task_id, type, lag_days, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, data.taskId, data.dependsOnTaskId, data.type, data.lagDays || 0, new Date().toISOString())
    return this.findById(id)!
  },
  findById(id: string): TaskDependency | null {
    const row = db.prepare('SELECT * FROM task_dependencies WHERE id = ?').get(id) as SqlRow
    return row ? rowToDependency(row) : null
  },
  update(id: string, data: { type: 'fs' | 'ss' | 'ff' | 'sf'; lagDays: number }): TaskDependency | null {
    db.prepare(
      'UPDATE task_dependencies SET type = ?, lag_days = ? WHERE id = ?',
    ).run(data.type, data.lagDays, id)
    return this.findById(id)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM task_dependencies WHERE id = ?').run(id)
  },
  deleteByTask(taskId: string): void {
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?').run(taskId, taskId)
  },
}

// ===== 行映射 =====

/** 操作审计日志行（listAudit 查询结果） */
export interface AuditRow {
  id: string
  taskId: string
  taskTitle: string
  userName: string
  action: string
  detail: string
  createdAt: string
}

function rowToSubtask(r: SqlRow): Subtask {
  return {
    id: r.id, taskId: r.task_id, title: r.title,
    done: !!r.done, createdAt: r.created_at,
  }
}
function rowToNotification(r: SqlRow): Notification {
  return {
    id: r.id, userId: r.user_id, type: r.type,
    title: r.title, body: r.body || '',
    taskId: r.task_id, projectId: r.project_id,
    read: !!r.read, createdAt: r.created_at,
  }
}
function rowToUser(r: SqlRow): User {
  return {
    id: r.id, email: r.email, name: r.name, avatarColor: r.avatar_color,
    role: r.role, createdAt: r.created_at,
    feishuOpenId: r.feishu_open_id || null,
    feishuUnionId: r.feishu_union_id || null,
    feishuBoundAt: r.feishu_bound_at || null,
    isOutsourced: !!r.is_outsourced,
    hourlyRate: r.hourly_rate || null,
    costCenter: r.cost_center || null,
    categoryId: r.category_id || null,
    customRoleId: r.custom_role_id || null,
  }
}
function rowToProject(r: SqlRow): Project {
  return {
    id: r.id, name: r.name, description: r.description || '',
    status: r.status, ownerId: r.owner_id, progress: r.progress,
    startDate: r.start_date || null, dueDate: r.due_date, createdAt: r.created_at,
    members: projectRepo.members(r.id),
  }
}
function rowToTask(r: SqlRow): Task {
  return {
    id: r.id, projectId: r.project_id, title: r.title, description: r.description || '',
    status: r.status, priority: r.priority, assigneeId: r.assignee_id,
    labels: parseLabels(r.labels), dueDate: r.due_date,
    startDate: r.start_date || null,
    progress: r.progress ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
    plannedHours: r.planned_hours || null,
    deletedAt: r.deleted_at || null,
    customStatus: r.custom_status || null,
  }
}
function rowToDependency(r: SqlRow): TaskDependency {
  return {
    id: r.id, taskId: r.task_id, dependsOnTaskId: r.depends_on_task_id,
    type: r.type, lagDays: r.lag_days, createdAt: r.created_at,
  }
}
function rowToComment(r: SqlRow): Comment {
  return {
    id: r.id, taskId: r.task_id, userId: r.user_id,
    userName: r.user_name, avatarColor: r.avatar_color,
    content: r.content, createdAt: r.created_at,
  }
}
function rowToTemplate(r: SqlRow): Template {
  return {
    id: r.id, name: r.name, title: r.title, description: r.description || '',
    priority: r.priority, labels: parseLabels(r.labels), createdAt: r.created_at,
  }
}
function rowToAttachment(r: SqlRow): Attachment {
  return {
    id: r.id, taskId: r.task_id, userId: r.user_id, userName: r.user_name,
    filename: r.filename, originalName: r.original_name,
    size: r.size, mimeType: r.mime_type, createdAt: r.created_at,
  }
}

// ===== User Categories =====
export const categoryRepo = {
  findAll(): UserCategory[] {
    const rows = db.prepare('SELECT * FROM user_categories ORDER BY created_at DESC').all() as SqlRow[]
    return rows.map(rowToCategory)
  },
  findById(id: string): UserCategory | null {
    const row = db.prepare('SELECT * FROM user_categories WHERE id = ?').get(id) as SqlRow
    return row ? rowToCategory(row) : null
  },
  findByName(name: string): UserCategory | null {
    const row = db.prepare('SELECT * FROM user_categories WHERE name = ?').get(name) as SqlRow
    return row ? rowToCategory(row) : null
  },
  create(data: { name: string; description?: string; hourlyRate: number; isOutsourced: boolean }): UserCategory {
    const id = genId()
    db.prepare(
      'INSERT INTO user_categories (id, name, description, hourly_rate, is_outsourced, created_at) VALUES (?,?,?,?,?,?)',
    ).run(id, data.name, data.description || '', data.hourlyRate, data.isOutsourced ? 1 : 0, new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string; hourlyRate: number; isOutsourced: boolean }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.hourlyRate !== undefined) { fields.push('hourly_rate = ?'); values.push(data.hourlyRate) }
    if (data.isOutsourced !== undefined) { fields.push('is_outsourced = ?'); values.push(data.isOutsourced ? 1 : 0) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE user_categories SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM user_categories WHERE id = ?').run(id)
  },
}

// ===== Project Budgets =====
export const budgetRepo = {
  findByProject(projectId: string): ProjectBudget[] {
    const rows = db.prepare('SELECT * FROM project_budgets WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as SqlRow[]
    return rows.map(rowToBudget)
  },
  findById(id: string): ProjectBudget | null {
    const row = db.prepare('SELECT * FROM project_budgets WHERE id = ?').get(id) as SqlRow
    return row ? rowToBudget(row) : null
  },
  findPending(projectId?: string): ProjectBudget[] {
    const where = projectId ? 'WHERE project_id = ?' : ''
    const and = projectId ? ' AND' : 'WHERE'
    const params = projectId ? [projectId] : []
    const rows = db.prepare(`SELECT * FROM project_budgets ${where} ${and} approval_status = 'pending' ORDER BY created_at DESC`).all(...params) as SqlRow[]
    return rows.map(rowToBudget)
  },
  create(data: { projectId: string; category: BudgetCategory; amount: number; currency?: string; description?: string; createdBy: string }): ProjectBudget {
    const id = genId()
    db.prepare(
      'INSERT INTO project_budgets (id, project_id, category, amount, currency, description, created_by, created_at, approval_status) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(id, data.projectId, data.category, data.amount, data.currency || 'RMB', data.description || '', data.createdBy, new Date().toISOString(), 'pending')
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ category: BudgetCategory; amount: number; currency: string; description: string }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
    if (data.amount !== undefined) { fields.push('amount = ?'); values.push(data.amount) }
    if (data.currency !== undefined) { fields.push('currency = ?'); values.push(data.currency) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE project_budgets SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  approve(id: string, approverId: string, comment?: string): void {
    db.prepare(
      'UPDATE project_budgets SET approval_status = ?, approved_by = ?, approved_at = ?, approval_comment = ? WHERE id = ?',
    ).run('approved', approverId, new Date().toISOString(), comment || null, id)
  },
  reject(id: string, approverId: string, comment?: string): void {
    db.prepare(
      'UPDATE project_budgets SET approval_status = ?, approved_by = ?, approved_at = ?, approval_comment = ? WHERE id = ?',
    ).run('rejected', approverId, new Date().toISOString(), comment || null, id)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM project_budgets WHERE id = ?').run(id)
  },
}

// ===== Project Expenses =====
export const expenseRepo = {
  findByProject(projectId: string): ProjectExpense[] {
    const rows = db.prepare('SELECT * FROM project_expenses WHERE project_id = ? ORDER BY date DESC, created_at DESC').all(projectId) as SqlRow[]
    return rows.map(rowToExpense)
  },
  findById(id: string): ProjectExpense | null {
    const row = db.prepare('SELECT * FROM project_expenses WHERE id = ?').get(id) as SqlRow
    return row ? rowToExpense(row) : null
  },
  create(data: { projectId: string; budgetId?: string | null; category: BudgetCategory; amount: number; description?: string; date: string; createdBy: string }): ProjectExpense {
    const id = genId()
    db.prepare(
      'INSERT INTO project_expenses (id, project_id, budget_id, category, amount, description, date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(id, data.projectId, data.budgetId || null, data.category, data.amount, data.description || '', data.date, data.createdBy, new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ budgetId: string | null; category: BudgetCategory; amount: number; description: string; date: string }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.budgetId !== undefined) { fields.push('budget_id = ?'); values.push(data.budgetId) }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
    if (data.amount !== undefined) { fields.push('amount = ?'); values.push(data.amount) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.date !== undefined) { fields.push('date = ?'); values.push(data.date) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE project_expenses SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM project_expenses WHERE id = ?').run(id)
  },
}

// ===== Task Hours =====
export const hoursRepo = {
  findByTask(taskId: string): TaskHours[] {
    const rows = db.prepare('SELECT * FROM task_hours WHERE task_id = ? ORDER BY date DESC').all(taskId) as SqlRow[]
    return rows.map(rowToHours)
  },
  findByUser(userId: string): TaskHours[] {
    const rows = db.prepare('SELECT * FROM task_hours WHERE user_id = ? ORDER BY date DESC').all(userId) as SqlRow[]
    return rows.map(rowToHours)
  },
  findById(id: string): TaskHours | null {
    const row = db.prepare('SELECT * FROM task_hours WHERE id = ?').get(id) as SqlRow
    return row ? rowToHours(row) : null
  },
  create(data: { taskId: string; userId: string; date: string; plannedHours?: number; actualHours?: number; description?: string }): TaskHours {
    const id = genId()
    db.prepare(
      'INSERT INTO task_hours (id, task_id, user_id, date, planned_hours, actual_hours, description, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, data.taskId, data.userId, data.date, data.plannedHours || 0, data.actualHours || 0, data.description || '', new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ plannedHours: number; actualHours: number; description: string }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.plannedHours !== undefined) { fields.push('planned_hours = ?'); values.push(data.plannedHours) }
    if (data.actualHours !== undefined) { fields.push('actual_hours = ?'); values.push(data.actualHours) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE task_hours SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM task_hours WHERE id = ?').run(id)
  },
}

function rowToBudget(r: SqlRow): ProjectBudget {
  return {
    id: r.id, projectId: r.project_id, category: r.category,
    amount: Number(r.amount), currency: r.currency,
    description: r.description || '', createdBy: r.created_by, createdAt: r.created_at,
    approvalStatus: r.approval_status || 'pending',
    approvedBy: r.approved_by || null,
    approvedAt: r.approved_at || null,
    approvalComment: r.approval_comment || null,
  }
}

function rowToExpense(r: SqlRow): ProjectExpense {
  return {
    id: r.id, projectId: r.project_id, budgetId: r.budget_id || null,
    category: r.category, amount: Number(r.amount),
    description: r.description || '', date: r.date,
    createdBy: r.created_by, createdAt: r.created_at,
  }
}

function rowToHours(r: SqlRow): TaskHours {
  return {
    id: r.id, taskId: r.task_id, userId: r.user_id,
    date: r.date, plannedHours: Number(r.planned_hours),
    actualHours: Number(r.actual_hours), description: r.description || '',
    createdAt: r.created_at,
  }
}

function rowToCategory(r: SqlRow): UserCategory {
  return {
    id: r.id, name: r.name, description: r.description || '',
    hourlyRate: Number(r.hourly_rate), isOutsourced: !!r.is_outsourced,
    createdAt: r.created_at,
  }
}

// ===== Saved Filters =====
export const savedFilterRepo = {
  findByUser(userId: string, projectId?: string): SavedFilter[] {
    const where = projectId ? 'WHERE user_id = ? AND (project_id = ? OR project_id IS NULL)' : 'WHERE user_id = ?'
    const params = projectId ? [userId, projectId] : [userId]
    const rows = db.prepare(`SELECT * FROM saved_filters ${where} ORDER BY created_at DESC`).all(...params) as SqlRow[]
    return rows.map(rowToSavedFilter)
  },
  findById(id: string): SavedFilter | null {
    const row = db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(id) as SqlRow
    return row ? rowToSavedFilter(row) : null
  },
  create(data: { userId: string; projectId: string | null; name: string; filterConfig: TaskFilter }): SavedFilter {
    const id = genId()
    db.prepare(
      'INSERT INTO saved_filters (id, user_id, project_id, name, filter_config, created_at) VALUES (?,?,?,?,?,?)',
    ).run(id, data.userId, data.projectId, data.name, JSON.stringify(data.filterConfig), new Date().toISOString())
    return this.findById(id)!
  },
  delete(id: string): void {
    db.prepare('DELETE FROM saved_filters WHERE id = ?').run(id)
  },
}

function rowToSavedFilter(r: SqlRow): SavedFilter {
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    name: r.name,
    filterConfig: JSON.parse(r.filter_config),
    createdAt: r.created_at,
  }
}

// ===== Kanban Columns =====
export const kanbanColumnRepo = {
  findByProject(projectId: string): KanbanColumn[] {
    return db.prepare(`
      SELECT * FROM project_kanban_columns
      WHERE project_id = ?
      ORDER BY sort_order ASC
    `).all(projectId) as KanbanColumn[]
  },

  findById(id: string): KanbanColumn | null {
    const row = db.prepare('SELECT * FROM project_kanban_columns WHERE id = ?').get(id) as SqlRow
    return row ? rowToKanbanColumn(row) : null
  },

  create(data: { projectId: string; statusKey: string; label: string; color?: string; sortOrder?: number }): KanbanColumn {
    const id = genId()
    db.prepare(`
      INSERT INTO project_kanban_columns (id, project_id, status_key, label, color, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.projectId, data.statusKey, data.label, data.color || '#6366F1', data.sortOrder || 0, new Date().toISOString())
    return this.findById(id)!
  },

  update(id: string, data: { label?: string; color?: string; sortOrder?: number }): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.label !== undefined) { fields.push('label = ?'); values.push(data.label) }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color) }
    if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(data.sortOrder) }
    if (fields.length === 0) return
    values.push(id)
    db.prepare(`UPDATE project_kanban_columns SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },

  delete(id: string): void {
    db.prepare('DELETE FROM project_kanban_columns WHERE id = ?').run(id)
  },

  deleteByProject(projectId: string): void {
    db.prepare('DELETE FROM project_kanban_columns WHERE project_id = ?').run(projectId)
  },

  initDefaultColumns(projectId: string): void {
    const defaults = [
      { statusKey: 'todo', label: '待办', color: '#94A3B8', sortOrder: 0 },
      { statusKey: 'in_progress', label: '进行中', color: '#F59E0B', sortOrder: 1 },
      { statusKey: 'review', label: '审核中', color: '#0EA5E9', sortOrder: 2 },
      { statusKey: 'done', label: '已完成', color: '#10B981', sortOrder: 3 },
    ]
    for (const col of defaults) {
      this.create({ projectId, ...col })
    }
  }
}

function rowToKanbanColumn(r: SqlRow): KanbanColumn {
  return {
    id: r.id,
    projectId: r.project_id,
    statusKey: r.status_key,
    label: r.label,
    color: r.color,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

// ===== Project Templates =====
export const projectTemplateRepo = {
  findAll(): ProjectTemplate[] {
    const rows = db.prepare('SELECT * FROM project_templates ORDER BY created_at DESC').all() as SqlRow[]
    return rows.map(rowToProjectTemplate)
  },
  findById(id: string): ProjectTemplate | null {
    const row = db.prepare('SELECT * FROM project_templates WHERE id = ?').get(id) as SqlRow
    return row ? rowToProjectTemplate(row) : null
  },
  findByIdWithDetails(id: string): ProjectTemplate | null {
    const template = this.findById(id)
    if (!template) return null
    return {
      ...template,
      tasks: templateTaskRepo.findByTemplate(id),
      budgets: templateBudgetRepo.findByTemplate(id),
      kanbanColumns: templateKanbanColumnRepo.findByTemplate(id),
    }
  },
  create(data: { name: string; description?: string; isSystem?: boolean; createdBy?: string }): ProjectTemplate {
    const id = genId()
    db.prepare(
      'INSERT INTO project_templates (id, name, description, is_system, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, data.name, data.description || '', data.isSystem ? 1 : 0, data.createdBy || null, new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE project_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM project_templates WHERE id = ?').run(id)
  },
}

// ===== Template Tasks =====
export const templateTaskRepo = {
  findByTemplate(templateId: string): TemplateTask[] {
    const rows = db.prepare('SELECT * FROM template_tasks WHERE template_id = ? ORDER BY sort_order ASC').all(templateId) as SqlRow[]
    return rows.map(rowToTemplateTask)
  },
  findById(id: string): TemplateTask | null {
    const row = db.prepare('SELECT * FROM template_tasks WHERE id = ?').get(id) as SqlRow
    return row ? rowToTemplateTask(row) : null
  },
  create(data: {
    templateId: string
    title: string
    description?: string
    status?: TaskStatus
    priority?: TaskPriority
    labels?: string[]
    sortOrder?: number
    plannedHours?: number
  }): TemplateTask {
    const id = genId()
    db.prepare(
      `INSERT INTO template_tasks (id, template_id, title, description, status, priority, labels, sort_order, planned_hours, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, data.templateId, data.title, data.description || '',
      data.status || 'todo', data.priority || 'medium',
      JSON.stringify(data.labels || []), data.sortOrder || 0, data.plannedHours || null,
      new Date().toISOString()
    )
    return this.findById(id)!
  },
  update(id: string, data: Partial<{
    title: string
    description: string
    status: TaskStatus
    priority: TaskPriority
    labels: string[]
    sortOrder: number
    plannedHours: number
  }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority) }
    if (data.labels !== undefined) { fields.push('labels = ?'); values.push(JSON.stringify(data.labels)) }
    if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(data.sortOrder) }
    if (data.plannedHours !== undefined) { fields.push('planned_hours = ?'); values.push(data.plannedHours) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE template_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM template_tasks WHERE id = ?').run(id)
  },
  deleteByTemplate(templateId: string): void {
    db.prepare('DELETE FROM template_tasks WHERE template_id = ?').run(templateId)
  },
}

// ===== Template Budgets =====
export const templateBudgetRepo = {
  findByTemplate(templateId: string): TemplateBudget[] {
    const rows = db.prepare('SELECT * FROM template_budgets WHERE template_id = ? ORDER BY created_at DESC').all(templateId) as SqlRow[]
    return rows.map(rowToTemplateBudget)
  },
  findById(id: string): TemplateBudget | null {
    const row = db.prepare('SELECT * FROM template_budgets WHERE id = ?').get(id) as SqlRow
    return row ? rowToTemplateBudget(row) : null
  },
  create(data: { templateId: string; category: BudgetCategory; description?: string }): TemplateBudget {
    const id = genId()
    db.prepare(
      'INSERT INTO template_budgets (id, template_id, category, description, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, data.templateId, data.category, data.description || '', new Date().toISOString())
    return this.findById(id)!
  },
  delete(id: string): void {
    db.prepare('DELETE FROM template_budgets WHERE id = ?').run(id)
  },
  deleteByTemplate(templateId: string): void {
    db.prepare('DELETE FROM template_budgets WHERE template_id = ?').run(templateId)
  },
}

// ===== Template Kanban Columns =====
export const templateKanbanColumnRepo = {
  findByTemplate(templateId: string): TemplateKanbanColumn[] {
    const rows = db.prepare('SELECT * FROM template_kanban_columns WHERE template_id = ? ORDER BY sort_order ASC').all(templateId) as SqlRow[]
    return rows.map(rowToTemplateKanbanColumn)
  },
  findById(id: string): TemplateKanbanColumn | null {
    const row = db.prepare('SELECT * FROM template_kanban_columns WHERE id = ?').get(id) as SqlRow
    return row ? rowToTemplateKanbanColumn(row) : null
  },
  create(data: { templateId: string; statusKey: string; label: string; color?: string; sortOrder?: number }): TemplateKanbanColumn {
    const id = genId()
    db.prepare(
      'INSERT INTO template_kanban_columns (id, template_id, status_key, label, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, data.templateId, data.statusKey, data.label, data.color || '#6366F1', data.sortOrder || 0, new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ label: string; color: string; sortOrder: number }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.label !== undefined) { fields.push('label = ?'); values.push(data.label) }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color) }
    if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(data.sortOrder) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE template_kanban_columns SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM template_kanban_columns WHERE id = ?').run(id)
  },
  deleteByTemplate(templateId: string): void {
    db.prepare('DELETE FROM template_kanban_columns WHERE template_id = ?').run(templateId)
  },
}

// ===== Row Mappers for Templates =====
function rowToProjectTemplate(r: SqlRow): ProjectTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    isSystem: !!r.is_system,
    createdBy: r.created_by || null,
    createdAt: r.created_at,
  }
}

function rowToTemplateTask(r: SqlRow): TemplateTask {
  return {
    id: r.id,
    templateId: r.template_id,
    title: r.title,
    description: r.description || '',
    status: r.status,
    priority: r.priority,
    labels: parseLabels(r.labels),
    sortOrder: r.sort_order,
    plannedHours: r.planned_hours || null,
    createdAt: r.created_at,
  }
}

function rowToTemplateBudget(r: SqlRow): TemplateBudget {
  return {
    id: r.id,
    templateId: r.template_id,
    category: r.category,
    description: r.description || '',
    createdAt: r.created_at,
  }
}

function rowToTemplateKanbanColumn(r: SqlRow): TemplateKanbanColumn {
  return {
    id: r.id,
    templateId: r.template_id,
    statusKey: r.status_key,
    label: r.label,
    color: r.color,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

// ===== Custom Roles =====
export const customRoleRepo = {
  findAll(): CustomRole[] {
    const rows = db.prepare(`
      SELECT cr.*, COUNT(rp.permission_id) as permission_count
      FROM custom_roles cr
      LEFT JOIN role_permissions rp ON cr.id = rp.role_id
      GROUP BY cr.id
      ORDER BY cr.is_system DESC, cr.created_at DESC
    `).all() as SqlRow[]
    return rows.map(rowToCustomRole)
  },
  findById(id: string): CustomRole | null {
    const row = db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(id) as SqlRow
    return row ? rowToCustomRole(row) : null
  },
  findByIdWithPermissions(id: string): CustomRole | null {
    const role = this.findById(id)
    if (!role) return null
    const perms = rolePermissionRepo.findByRole(id)
    return {
      ...role,
      permissions: perms,
    }
  },
  findByName(name: string): CustomRole | null {
    const row = db.prepare('SELECT * FROM custom_roles WHERE name = ?').get(name) as SqlRow
    return row ? rowToCustomRole(row) : null
  },
  create(data: { name: string; description?: string; isSystem?: boolean; createdBy?: string }): CustomRole {
    const id = genId()
    db.prepare(
      'INSERT INTO custom_roles (id, name, description, is_system, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, data.name, data.description || '', data.isSystem ? 1 : 0, data.createdBy || null, new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE custom_roles SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM custom_roles WHERE id = ?').run(id)
  },
}

function rowToCustomRole(r: SqlRow): CustomRole {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    isSystem: !!r.is_system,
    createdBy: r.created_by || null,
    createdAt: r.created_at,
    permissionCount: r.permission_count || 0,
  }
}

// ===== Permissions =====
export const permissionRepo = {
  findAll(): Permission[] {
    const rows = db.prepare('SELECT * FROM permissions ORDER BY category, key').all() as SqlRow[]
    return rows.map(rowToPermission)
  },
  findById(id: string): Permission | null {
    const row = db.prepare('SELECT * FROM permissions WHERE id = ?').get(id) as SqlRow
    return row ? rowToPermission(row) : null
  },
  findByKey(key: string): Permission | null {
    const row = db.prepare('SELECT * FROM permissions WHERE key = ?').get(key) as SqlRow
    return row ? rowToPermission(row) : null
  },
  findByCategory(): PermissionCategory[] {
    const rows = db.prepare('SELECT * FROM permissions ORDER BY category, key').all() as SqlRow[]
    const categories = new Map<string, Permission[]>()
    rows.forEach((r) => {
      const perm = rowToPermission(r)
      if (!categories.has(perm.category)) {
        categories.set(perm.category, [])
      }
      categories.get(perm.category)!.push(perm)
    })
    return Array.from(categories.entries()).map(([category, permissions]) => ({
      category,
      permissions,
    }))
  },
}

function rowToPermission(r: SqlRow): Permission {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    category: r.category,
    description: r.description || '',
    createdAt: r.created_at,
  }
}

// ===== Role Permissions =====
export const rolePermissionRepo = {
  findByRole(roleId: string): Permission[] {
    const rows = db.prepare(`
      SELECT p.* FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.category, p.key
    `).all(roleId) as SqlRow[]
    return rows.map(rowToPermission)
  },
  hasPermission(roleId: string, permissionKey: string): boolean {
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = ? AND p.key = ?
    `).get(roleId, permissionKey) as { c: number }
    return row.c > 0
  },
  userHasPermission(userId: string, permissionKey: string): boolean {
    const user = userRepo.findById(userId)
    if (!user) return false

    // 管理员拥有所有权限
    if (user.role === 'admin') return true

    // 检查自定义角色权限
    if (user.customRoleId) {
      const hasPerm = this.hasPermission(user.customRoleId, permissionKey)
      if (hasPerm) return true
    }

    // 检查系统角色隐式权限
    return this.checkImplicitPermission(user.role, permissionKey)
  },
  checkImplicitPermission(role: string, permissionKey: string): boolean {
    // 系统角色隐式权限映射
    const implicitPermissions: Record<string, string[]> = {
      admin: ['*'], // 管理员拥有所有权限
      finance: [
        'project.view', 'task.view',
        'budget.view', 'budget.create', 'budget.approve',
        'expense.view', 'expense.create',
        'hours.view', 'hours.view_all',
        'cost.view', 'cost.edit',
        'team.view',
      ],
      owner: [
        'project.view', 'project.edit', 'project.manage_members',
        'task.view', 'task.create', 'task.edit', 'task.delete', 'task.assign',
        'budget.view',
        'expense.view',
        'hours.view', 'hours.create',
        'team.view',
      ],
      member: [
        'project.view',
        'task.view', 'task.create', 'task.edit',
        'hours.view', 'hours.create',
      ],
      guest: ['project.view', 'task.view', 'hours.view'],
    }

    const perms = implicitPermissions[role] || []
    return perms.includes('*') || perms.includes(permissionKey)
  },
  setPermissions(roleId: string, permissionIds: string[]): void {
    // 删除现有权限
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)

    // 插入新权限
    const now = new Date().toISOString()
    permissionIds.forEach((permId) => {
      db.prepare(
        'INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)',
      ).run(genId(), roleId, permId, now)
    })
  },
  addPermission(roleId: string, permissionId: string): void {
    try {
      db.prepare(
        'INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)',
      ).run(genId(), roleId, permissionId, new Date().toISOString())
    } catch {
      // 已存在，忽略
    }
  },
  removePermission(roleId: string, permissionId: string): void {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?').run(roleId, permissionId)
  },
}