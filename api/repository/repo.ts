// 数据访问层

import db, { type SqlRow, type SqlParam } from '../db.ts'
import { genId, parseLabels } from '../lib/utils.ts'
import { rankRecallHits, type RecallHit } from '../lib/recall.ts'
import type {
  User, Project, ProjectMember, Task, Comment, Subtask, Notification, Template, Attachment, TaskStatus,
  ProjectStatus, TaskPriority, MemberRole, ProjectBudget, ProjectExpense, TaskHours, BudgetCategory,
  UserCategory, TaskDependency, TaskHistory, SavedFilter, TaskFilter, KanbanColumn,
  ProjectTemplate, TemplateTask, TemplateBudget, TemplateKanbanColumn,
  CustomRole, Permission, PermissionCategory, OpLog,
} from '../../shared/types.ts'
import type { ProjectType, TemplateCategory } from '../../shared/types.ts'

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
  updateProfile(id: string, data: { name?: string; email?: string; avatarColor?: string }): User | null {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email) }
    if (data.avatarColor !== undefined) { fields.push('avatar_color = ?'); values.push(data.avatarColor) }
    if (!fields.length) return this.findById(id)
    values.push(id)
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  },
  updatePassword(id: string, passwordHash: string): void {
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(passwordHash, id)
  },
  getTokenVersion(id: string): number {
    const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(id) as { token_version: number } | undefined
    return row?.token_version ?? 0
  },
  // 名下业务流水计数（删除成员前守卫：工时/台账/支出/附件属业务数据，需先处理而非随账号删除）
  businessRecordCounts(id: string): { hours: number; opLogs: number; expenses: number; attachments: number } {
    const c = (sql: string) => (db.prepare(sql).get(id) as { c: number }).c
    return {
      hours: c('SELECT COUNT(*) as c FROM task_hours WHERE user_id = ?'),
      opLogs: c('SELECT COUNT(*) as c FROM op_logs WHERE user_id = ?'),
      expenses: c('SELECT COUNT(*) as c FROM project_expenses WHERE created_by = ?'),
      attachments: c('SELECT COUNT(*) as c FROM attachments WHERE user_id = ?'),
    }
  },
  // 删除用户并清理关联数据（事务）：名下项目负责人转移给 adminId 并补 owner 成员行；
  // 成员关系/评论/通知/筛选器/操作历史清理；任务与子任务指派置空；预算创建人转移（项目资产不随人删）
  deleteWithCleanup(id: string, adminId: string): { transferredProjects: number; unassignedTasks: number } {
    const tx = db.transaction(() => {
      const owned = db.prepare('SELECT id FROM projects WHERE owner_id = ?').all(id) as SqlRow[]
      db.prepare('UPDATE projects SET owner_id = ? WHERE owner_id = ?').run(adminId, id)
      for (const p of owned) {
        db.prepare('INSERT OR IGNORE INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)')
          .run(genId(), p.id, adminId, 'owner', new Date().toISOString())
      }
      const unassignedTasks = db.prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?').run(id).changes
      db.prepare('UPDATE subtasks SET assignee_id = NULL WHERE assignee_id = ?').run(id)
      db.prepare('DELETE FROM project_members WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM comments WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM saved_filters WHERE user_id = ?').run(id)
      db.prepare('DELETE FROM task_history WHERE user_id = ?').run(id)
      db.prepare('UPDATE project_budgets SET created_by = ? WHERE created_by = ?').run(adminId, id)
      db.prepare('DELETE FROM users WHERE id = ?').run(id)
      return { transferredProjects: owned.length, unassignedTasks }
    })
    return tx()
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
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `).all() as SqlRow[]
    return rows.map(rowToProject)
  },
  findById(id: string): Project | null {
    const row = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `).get(id) as SqlRow
    return row ? rowToProject(row) : null
  },
  findByIdWithTrash(id: string): Project | null {
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
      WHERE m.user_id = ? AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `).all(userId) as SqlRow[]
    return rows.map(rowToProject)
  },
  findTrash(): Project[] {
    const rows = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.deleted_at IS NOT NULL
      ORDER BY p.deleted_at DESC
    `).all() as SqlRow[]
    return rows.map(rowToProject)
  },
  softDelete(id: string): void {
    const now = new Date().toISOString()
    db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').run(now, id)
    // 级联软删该项目下所有任务
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE project_id = ? AND deleted_at IS NULL').run(now, id)
  },
  restore(id: string): void {
    db.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ?').run(id)
    // 恢复该项目下所有任务
    db.prepare('UPDATE tasks SET deleted_at = NULL WHERE project_id = ?').run(id)
  },
  // 项目负责人发起删除申请（等待管理员/项目核算审批），同时清除上次的驳回原因
  requestDeletion(id: string, userId: string): void {
    db.prepare('UPDATE projects SET delete_requested_by = ?, delete_requested_at = ?, delete_reject_comment = NULL WHERE id = ?').run(
      userId, new Date().toISOString(), id
    )
  },
  // 清除删除申请标记（批准后调用，连带清除驳回原因）
  cancelDeletion(id: string): void {
    db.prepare('UPDATE projects SET delete_requested_by = NULL, delete_requested_at = NULL, delete_reject_comment = NULL WHERE id = ?').run(id)
  },
  // 驳回删除申请：清除申请标记，保留驳回原因供申请人查看
  rejectDeletion(id: string, comment: string): void {
    db.prepare('UPDATE projects SET delete_requested_by = NULL, delete_requested_at = NULL, delete_reject_comment = ? WHERE id = ?').run(
      comment, id
    )
  },
  findPendingDeletions(): Project[] {
    const rows = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.deleted_at IS NULL AND p.delete_requested_by IS NOT NULL
      ORDER BY p.delete_requested_at DESC
    `).all() as SqlRow[]
    return rows.map(rowToProject)
  },
  // v1.9.0 结项合并：把源项目的台账/课题记录批量转绑到目标运维项目，并标记合并去向（事务）
  mergeProject(sourceId: string, targetId: string): { movedOpLogs: number; targetName: string } {
    const tx = db.transaction(() => {
      const moved = db.prepare('UPDATE op_logs SET project_id = ? WHERE project_id = ?').run(targetId, sourceId)
      db.prepare('UPDATE projects SET merged_into_project_id = ? WHERE id = ?').run(targetId, sourceId)
      const target = db.prepare('SELECT name FROM projects WHERE id = ?').get(targetId) as { name: string } | undefined
      return { movedOpLogs: moved.changes, targetName: target?.name || '' }
    })
    return tx()
  },
  create(data: { name: string; description: string; status: ProjectStatus; ownerId: string; startDate?: string | null; dueDate: string | null; projectType?: ProjectType | null }): Project {
    const id = genId()
    const progress = data.startDate ? this.calculateTimeProgress(data.startDate) : 0
    db.prepare(
      'INSERT INTO projects (id, name, description, status, project_type, owner_id, progress, start_date, due_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(id, data.name, data.description, data.status, data.projectType || null, data.ownerId, progress, data.startDate || null, data.dueDate, new Date().toISOString())
    db.prepare(
      'INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)',
    ).run(genId(), id, data.ownerId, 'owner', new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string; status: ProjectStatus; startDate: string | null; dueDate: string | null; projectType: ProjectType | null }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.projectType !== undefined) { fields.push('project_type = ?'); values.push(data.projectType || null) }
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
    // 已完结项目进度固定 100%
    if (project.status === 'completed') {
      db.prepare('UPDATE projects SET progress = 100 WHERE id = ?').run(id)
      return
    }
    // 已完成任务一律按 100% 计入平均，避免历史进度数据拉低整体进度
    const row = db.prepare(
      `SELECT
         COUNT(*) as total,
         AVG(CASE WHEN status='done' THEN 100 ELSE COALESCE(progress, 0) END) as avg_progress,
         SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as dones
       FROM tasks WHERE project_id = ? AND deleted_at IS NULL`,
    ).get(id) as { total: number; avg_progress: number | null; dones: number }
    if (row.total === 0) {
      // 无任务（或任务全被删除）时进度归零，避免残留历史值
      db.prepare('UPDATE projects SET progress = 0 WHERE id = ?').run(id)
      return
    }
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
  findByAssigneeAll(userId: string, projectId?: string): Task[] {
    const where = projectId
      ? 'WHERE assignee_id = ? AND project_id = ? AND deleted_at IS NULL'
      : 'WHERE assignee_id = ? AND deleted_at IS NULL'
    const rows = db.prepare(`SELECT * FROM tasks ${where}`).all(...(projectId ? [userId, projectId] : [userId])) as SqlRow[]
    return rows.map(rowToTask)
  },
  findTrash(projectId?: string): Task[] {
    if (projectId) {
      const rows = db.prepare('SELECT * FROM tasks WHERE deleted_at IS NOT NULL AND project_id = ? ORDER BY deleted_at DESC').all(projectId) as SqlRow[]
      return rows.map(rowToTask)
    }
    const rows = db.prepare('SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as SqlRow[]
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
    // 新任务排在所在项目列末尾
    const orderRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE project_id = ?').get(data.projectId) as { m: number }
    const sortOrder = (orderRow.m || 0) + 1
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, labels, due_date, start_date, planned_hours, progress, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, data.projectId, data.title, data.description, data.status, data.priority, data.assigneeId, JSON.stringify(data.labels), data.dueDate, data.startDate || null, data.plannedHours || null, data.progress ?? 0, sortOrder, now, now)
    return this.findById(id)!
  },
  /** 按传入顺序持久化列内排序（sort_order = 数组下标） */
  reorder(taskIds: string[]): void {
    const stmt = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?')
    const tx = db.transaction((ids: string[]) => {
      ids.forEach((tid, i) => stmt.run(i, tid))
    })
    tx(taskIds)
  },
  update(id: string, data: Partial<{
    title: string; description: string; status: TaskStatus;
    priority: TaskPriority; assigneeId: string | null;
    labels: string[]; dueDate: string | null;
    startDate: string | null; plannedHours: number; progress: number;
    actualStartDate: string | null; actualEndDate: string | null;
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
    if (data.actualStartDate !== undefined) { fields.push('actual_start_date = ?'); values.push(data.actualStartDate) }
    if (data.actualEndDate !== undefined) { fields.push('actual_end_date = ?'); values.push(data.actualEndDate) }
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
  /**
   * 根据完成情况重算任务进度：
   * - 任务整体标记 done → 100
   * - 有子任务 → 进度 = 子任务完成比例
   * - 无子任务 → todo=0 / 其他保持手动值
   * 返回重算后的进度
   */
  recalcProgress(taskId: string): number {
    const task = this.findById(taskId)
    if (!task) return 0
    const subs = subtaskRepo.findByTask(taskId)
    let progress = task.progress ?? 0
    if (task.status === 'done') {
      progress = 100
    } else if (subs.length > 0) {
      progress = Math.round((subs.filter((s) => s.done).length / subs.length) * 100)
    } else if (task.status === 'todo') {
      progress = 0
    }
    if (progress !== (task.progress ?? 0)) {
      db.prepare('UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?')
        .run(progress, new Date().toISOString(), taskId)
    }
    return progress
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
  // projectIds: 允许可见的项目集合；undefined = 不限制；[] = 无可见项目（返回全 0，绝不回退全量）
  countByStatus(projectIds?: string[], since?: string): Record<string, number> {
    const result: Record<string, number> = { todo: 0, in_progress: 0, review: 0, done: 0 }
    if (projectIds && projectIds.length === 0) return result
    const ph = projectIds?.length ? ` AND project_id IN (${projectIds.map(() => '?').join(',')})` : ''
    // since：只统计窗口内有动态（updated_at >= since）的任务，与成员工作量口径一致
    const sh = since ? ' AND updated_at >= ?' : ''
    const rows = db.prepare(
      `SELECT status, COUNT(*) as c FROM tasks WHERE deleted_at IS NULL${ph}${sh} GROUP BY status`,
    ).all(...(projectIds?.length ? projectIds : []), ...(since ? [since] : [])) as { status: string; c: number }[]
    rows.forEach((r) => { result[r.status] = r.c })
    return result
  },
  trendDaily(days = 14, projectIds?: string[]): { date: string; completed: number; created: number }[] {
    if (projectIds && projectIds.length === 0) return []
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const projectWhere = projectIds?.length ? ` AND project_id IN (${projectIds.map(() => '?').join(',')})` : ''
    const projectParams = projectIds?.length ? projectIds : []
    const createdRows = db.prepare(`
      SELECT DATE(created_at) as d, COUNT(*) as c FROM tasks
      WHERE created_at >= ? AND deleted_at IS NULL${projectWhere}
      GROUP BY d ORDER BY d
    `).all(since, ...projectParams) as { d: string; c: number }[]
    const doneRows = db.prepare(`
      SELECT DATE(updated_at) as d, COUNT(*) as c FROM tasks
      WHERE status = 'done' AND updated_at >= ? AND deleted_at IS NULL${projectWhere}
      GROUP BY d ORDER BY d
    `).all(since, ...projectParams) as { d: string; c: number }[]
    const map: Record<string, { completed: number; created: number }> = {}
    createdRows.forEach((r) => { map[r.d] = { completed: 0, created: r.c } })
    doneRows.forEach((r) => {
      if (!map[r.d]) map[r.d] = { completed: 0, created: 0 }
      map[r.d].completed = r.c
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))
  },
  burndown(projectIds?: string[], days = 0): { dates: string[]; ideal: number[]; actual: number[] } {
    if (projectIds && projectIds.length === 0) return { dates: [], ideal: [], actual: [] }
    const ph = projectIds?.length ? ` AND project_id IN (${projectIds.map(() => '?').join(',')})` : ''
    const tasks = db.prepare(`SELECT created_at, updated_at, status FROM tasks WHERE deleted_at IS NULL${ph}`).all(...(projectIds?.length ? projectIds : [])) as SqlRow[]
    if (tasks.length === 0) return { dates: [], ideal: [], actual: [] }
    const startDate = tasks.map((t) => t.created_at).sort()[0]
    // 配套结束于最近一次完成
    const doneEvents = tasks.filter((t) => t.status === 'done').map((t) => t.updated_at).sort()
    const endDate = doneEvents.length ? doneEvents[doneEvents.length - 1] : new Date().toISOString()
    const start = new Date(startDate)
    // 窗口视图：时间轴延伸到今天，理想线锚定不变，实际剩余在窗口内可见
    let end = new Date(endDate)
    if (days > 0 && end.getTime() < Date.now()) end = new Date()
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
    // 窗口视图：只返回最近 N+1 天（含今天）的切片
    if (days > 0 && dates.length > days + 1) {
      const cut = dates.length - (days + 1)
      return { dates: dates.slice(cut), ideal: ideal.slice(cut), actual: actual.slice(cut) }
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
    const rows = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC').all(taskId) as SqlRow[]
    return rows.map(rowToSubtask)
  },
  create(taskId: string, title: string, assigneeId?: string | null): Subtask {
    const id = genId()
    const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM subtasks WHERE task_id = ?').get(taskId) as SqlRow | undefined
    const nextOrder = ((maxRow?.m as number) ?? -1) + 1
    db.prepare('INSERT INTO subtasks (id, task_id, title, done, assignee_id, sort_order, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, taskId, title, 0, assigneeId || null, nextOrder, new Date().toISOString())
    return this.findByTask(taskId).find((s) => s.id === id)!
  },
  update(id: string, data: { title?: string; done?: boolean; assigneeId?: string | null; sortOrder?: number }): void {
    if (data.title !== undefined) {
      db.prepare('UPDATE subtasks SET title = ? WHERE id = ?').run(data.title, id)
    }
    if (data.done !== undefined) {
      db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(data.done ? 1 : 0, id)
    }
    if (data.assigneeId !== undefined) {
      db.prepare('UPDATE subtasks SET assignee_id = ? WHERE id = ?').run(data.assigneeId || null, id)
    }
    if (data.sortOrder !== undefined) {
      db.prepare('UPDATE subtasks SET sort_order = ? WHERE id = ?').run(data.sortOrder, id)
    }
  },
  // 批量重排：按传入的 id 顺序写回 sort_order
  reorder(taskId: string, ids: string[]): void {
    const stmt = db.prepare('UPDATE subtasks SET sort_order = ? WHERE id = ? AND task_id = ?')
    const tx = db.transaction(() => {
      ids.forEach((id, i) => stmt.run(i, id, taskId))
    })
    tx()
  },
  delete(id: string): void {
    db.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
  },
  // 将某任务下所有子任务标记为已完成
  markAllDone(taskId: string): void {
    db.prepare('UPDATE subtasks SET done = 1 WHERE task_id = ? AND done = 0').run(taskId)
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
    done: !!r.done, assigneeId: r.assignee_id || null, createdAt: r.created_at,
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
    status: r.status, projectType: (r.project_type as ProjectType) || null,
    mergedIntoProjectId: r.merged_into_project_id || null,
    ownerId: r.owner_id, progress: r.progress,
    startDate: r.start_date || null, dueDate: r.due_date, createdAt: r.created_at,
    deletedAt: r.deleted_at || null,
    deleteRequestedBy: r.delete_requested_by || null,
    deleteRequestedAt: r.delete_requested_at || null,
    deleteRejectComment: r.delete_reject_comment || null,
    members: projectRepo.members(r.id),
  }
}
function rowToTask(r: SqlRow): Task {
  return {
    id: r.id, projectId: r.project_id, title: r.title, description: r.description || '',
    status: r.status, priority: r.priority, assigneeId: r.assignee_id,
    labels: parseLabels(r.labels), dueDate: r.due_date,
    startDate: r.start_date || null,
    actualStartDate: r.actual_start_date || null,
    actualEndDate: r.actual_end_date || null,
    progress: r.progress ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
    plannedHours: r.planned_hours || null,
    deletedAt: r.deleted_at || null,
    customStatus: r.custom_status || null,
    sortOrder: r.sort_order ?? 0,
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
  create(data: { taskId: string; userId: string; date: string; plannedHours?: number; actualHours?: number; billedHours?: number; description?: string }): TaskHours {
    // 同任务同用户同一天 → 累加工时到已有记录
    const existing = db.prepare(
      'SELECT * FROM task_hours WHERE task_id = ? AND user_id = ? AND date = ?',
    ).get(data.taskId, data.userId, data.date) as SqlRow | undefined
    if (existing) {
      const newPlanned = (Number(existing.planned_hours) || 0) + (data.plannedHours || 0)
      const newActual = (Number(existing.actual_hours) || 0) + (data.actualHours || 0)
      const newBilled = (Number(existing.billed_hours) || 0) + (data.billedHours || 0)
      const newDesc = data.description ? `${existing.description || ''}\n${data.description}`.trim() : (existing.description || '')
      db.prepare(
        'UPDATE task_hours SET planned_hours = ?, actual_hours = ?, billed_hours = ?, description = ? WHERE id = ?',
      ).run(newPlanned, newActual, newBilled, newDesc, existing.id)
      return this.findById(existing.id as string)!
    }
    const id = genId()
    db.prepare(
      'INSERT INTO task_hours (id, task_id, user_id, date, planned_hours, actual_hours, billed_hours, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(id, data.taskId, data.userId, data.date, data.plannedHours || 0, data.actualHours || 0, data.billedHours || 0, data.description || '', new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ plannedHours: number; actualHours: number; billedHours: number; description: string }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.plannedHours !== undefined) { fields.push('planned_hours = ?'); values.push(data.plannedHours) }
    if (data.actualHours !== undefined) { fields.push('actual_hours = ?'); values.push(data.actualHours) }
    if (data.billedHours !== undefined) { fields.push('billed_hours = ?'); values.push(data.billedHours) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE task_hours SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  delete(id: string): void {
    db.prepare('DELETE FROM task_hours WHERE id = ?').run(id)
  },
}

// 工时报表：任务计划工时汇总（来自 tasks.planned_hours）
// scope: undefined = 不限制（admin）；[] = 无可见项目（返回 0）；数组 = 可见项目集合
// total: userId 传入时只统计该人负责的任务，否则为范围内全部
// unassigned: 范围内未指派负责人的任务计划工时（人员筛选时用于「另有 X 小时未指派」提示）
export function taskPlannedSummary(scope: string[] | undefined, userId?: string): { total: number; unassigned: number } {
  const base = 'SELECT COALESCE(SUM(planned_hours), 0) as total FROM tasks WHERE deleted_at IS NULL'
  const scoped = (extra: string, params: SqlParam[] = []): { q: string; params: SqlParam[] } => {
    let q = base
    const all: SqlParam[] = []
    if (scope) {
      q += ` AND project_id IN (${scope.map(() => '?').join(',')})`
      all.push(...scope)
    }
    return { q: q + extra, params: [...all, ...params] }
  }
  const mine = scoped(userId ? ' AND assignee_id = ?' : '', userId ? [userId] : [])
  const un = scoped(' AND assignee_id IS NULL')
  const total = Number((db.prepare(mine.q).get(...mine.params) as SqlRow).total) || 0
  const unassigned = Number((db.prepare(un.q).get(...un.params) as SqlRow).total) || 0
  return { total, unassigned }
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
    actualHours: Number(r.actual_hours), billedHours: Number(r.billed_hours) || 0, description: r.description || '',
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
    const rows = db.prepare(`
      SELECT * FROM project_kanban_columns
      WHERE project_id = ?
      ORDER BY sort_order ASC
    `).all(projectId) as SqlRow[]
    return rows.map(rowToKanbanColumn)
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
  create(data: { name: string; description?: string; category?: TemplateCategory | null; isSystem?: boolean; createdBy?: string }): ProjectTemplate {
    const id = genId()
    db.prepare(
      'INSERT INTO project_templates (id, name, description, category, is_system, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, data.name, data.description || '', data.category || null, data.isSystem ? 1 : 0, data.createdBy || null, new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string; category: TemplateCategory | null }>): void {
    const fields: string[] = []
    const values: SqlParam[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category || null) }
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
    category: (r.category as TemplateCategory) || null,
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
        'project.view', 'project.approve_delete', 'task.view',
        'budget.view', 'budget.create', 'budget.edit', 'budget.delete', 'budget.approve',
        'expense.view', 'expense.create', 'expense.edit', 'expense.delete',
        'hours.view', 'hours.view_all',
        'cost.view', 'cost.edit',
        'team.view',
        'oplog.view',
      ],
      owner: [
        'project.view', 'project.edit', 'project.manage_members', 'project.manage_columns',
        'task.view', 'task.create', 'task.edit', 'task.delete', 'task.assign', 'task.restore', 'task.purge',
        'budget.view',
        'expense.view',
        'hours.view', 'hours.create',
        'team.view',
        'data.export',
        // 台账列表对全员开放（侧边栏入口 + 项目详情页内嵌），详情同样放行，避免「看得到列表打不开详情」
        'oplog.view',
      ],
      member: [
        'project.view',
        'task.view', 'task.create', 'task.edit',
        'hours.view', 'hours.create',
        'oplog.view',
      ],
      guest: ['project.view', 'task.view', 'hours.view', 'oplog.view'],
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

// ===== Op Logs（运维台账）=====
export interface OpLogInput {
  projectId?: string | null
  category?: string
  status?: string
  proposer?: string
  system?: string
  department?: string
  logDate?: string
  recorder?: string
  problem: string
  completionDate?: string | null
  hours?: number
  detail?: string
  cause?: string
  solution?: string
  extraFields?: Record<string, string>
  /** 登记时间（导入时可指定，缺省为当前时间） */
  createdAt?: string
}

export interface OpLogFilter {
  projectId?: string | null
  /** 项目集合限定（数据作用域）：null = 无可见项目（返回空集）；undefined = 不限制 */
  projectIds?: string[] | null
  category?: string
  status?: string
  system?: string
  department?: string
  keyword?: string
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

// projectIds 作用域拼 SQL 片段；返回 null 表示「无可见项目」（调用方直接返回空集）
function scopeClause(projectIds: string[] | null | undefined): string | null {
  if (projectIds === null) return null
  if (!projectIds) return ''
  if (projectIds.length === 0) return null
  return ` AND project_id IN (${projectIds.map(() => '?').join(',')})`
}

// 排序白名单：key 为前端传入的 sortBy 值，value 为 SQL 列/表达式（防注入）
const OPLOG_SORT_FIELDS: Record<string, string> = {
  logDate: 'log_date',
  completionDate: 'completion_date',
  hours: 'hours',
  // 状态按业务顺序排序：待处理 → 处理中 → 已完成 → 已关闭
  status: "CASE status WHEN '待处理' THEN 0 WHEN '处理中' THEN 1 WHEN '已完成' THEN 2 WHEN '已关闭' THEN 3 ELSE 4 END",
  category: 'category',
  system: 'system',
  department: 'department',
  proposer: 'proposer',
  recorder: 'recorder',
  createdAt: 'created_at',
}

function rowToOpLog(r: SqlRow): OpLog {
  let extra: Record<string, string> = {}
  try {
    extra = r.extra_fields ? JSON.parse(r.extra_fields as string) : {}
  } catch {
    extra = {}
  }
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    category: r.category || '其他',
    status: r.status || '待处理',
    proposer: r.proposer || '',
    system: r.system || '',
    department: r.department || '',
    logDate: r.log_date ? String(r.log_date).slice(0, 10) : '',
    recorder: r.recorder || '',
    problem: r.problem || '',
    completionDate: r.completion_date ? String(r.completion_date).slice(0, 10) : '',
    hours: r.hours == null ? 0 : Number(r.hours),
    detail: r.detail || '',
    cause: r.cause || '',
    solution: r.solution || '',
    extraFields: extra,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export const opLogRepo = {
  find(filter: OpLogFilter = {}): OpLog[] {
    const sc = scopeClause(filter.projectIds)
    if (sc === null) return []
    let sql = 'SELECT * FROM op_logs WHERE deleted_at IS NULL'
    const params: SqlParam[] = []

    if (filter.projectId === 'none') {
      sql += ' AND project_id IS NULL'
    } else if (filter.projectId) {
      sql += ' AND project_id = ?'
      params.push(filter.projectId)
    } else if (sc) {
      sql += sc
      params.push(...(filter.projectIds as string[]))
    }
    if (filter.category) { sql += ' AND category = ?'; params.push(filter.category) }
    if (filter.status) { sql += ' AND status = ?'; params.push(filter.status) }
    if (filter.system) { sql += ' AND system = ?'; params.push(filter.system) }
    if (filter.department) { sql += ' AND department = ?'; params.push(filter.department) }
    if (filter.dateFrom) { sql += ' AND log_date >= ?'; params.push(filter.dateFrom) }
    if (filter.dateTo) { sql += ' AND log_date <= ?'; params.push(filter.dateTo) }
    if (filter.keyword) {
      sql += ' AND (problem LIKE ? OR detail LIKE ? OR cause LIKE ? OR solution LIKE ? OR system LIKE ? OR proposer LIKE ?)'
      const kw = `%${filter.keyword}%`
      params.push(kw, kw, kw, kw, kw, kw)
    }
    // 排序：白名单字段 + 方向；默认按日期降序（新建在前）
    const sortExpr = (filter.sortBy && OPLOG_SORT_FIELDS[filter.sortBy]) || 'log_date'
    const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC'
    sql += ` ORDER BY ${sortExpr} ${sortDir}, created_at DESC`

    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map(rowToOpLog)
  },

  findById(id: string): OpLog | null {
    const row = db.prepare('SELECT * FROM op_logs WHERE id = ? AND deleted_at IS NULL').get(id) as SqlRow | undefined
    return row ? rowToOpLog(row) : null
  },

  /**
   * 经验召回：从已闭环（已完成/已关闭）台账中检索与关键词相关的相似案例。
   * P1 双路召回：
   *  ① 候选集（同项目优先 + 近况窗口）——保底覆盖最近与本项目经验；
   *  ② 关键词 LIKE 全文扩展——跨项目/跨时间补回相关案例。
   * 评分逻辑见 lib/recall.ts；可选的向量重排由路由层配合 LLM_EMBED_* 完成。
   * 注：未引入 FTS5——unicode61 把连续中文串当一个 token、trigram 对 2 字中文词不命中，台账量级下 LIKE 足够且零依赖。
   */
  recall(opts: {
    keywords: string[]
    projectId?: string
    system?: string
    category?: string
    limit?: number
  }): RecallHit[] {
    const keywords = opts.keywords.filter(Boolean)
    if (keywords.length === 0) return []
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 30)
    const base = "deleted_at IS NULL AND status IN ('已完成','已关闭')"

    // 候选集：同项目优先（不足时补全量候选，跨项目经验也有参考价值，评分时同项目有加成）
    const candidates: SqlRow[] = []
    const seen = new Set<string>()
    const pull = (sql: string, params: SqlParam[]) => {
      for (const r of db.prepare(sql).all(...params) as SqlRow[]) {
        if (!seen.has(String(r.id))) {
          seen.add(String(r.id))
          candidates.push(r)
        }
      }
    }
    if (opts.projectId) {
      pull(`SELECT * FROM op_logs WHERE ${base} AND project_id = ? ORDER BY log_date DESC LIMIT 300`, [opts.projectId])
      if (candidates.length < 100) {
        pull(`SELECT * FROM op_logs WHERE ${base} ORDER BY log_date DESC LIMIT 300`, [])
      }
    } else {
      pull(`SELECT * FROM op_logs WHERE ${base} ORDER BY log_date DESC LIMIT 400`, [])
    }

    // ② 全文扩展召回：任一关键词命中 problem/detail/cause/solution 即入候选（全局，不受项目与时间窗口限制）
    const terms = keywords.slice(0, 6)
    if (terms.length > 0) {
      const like = terms
        .map(() => `(IFNULL(problem,'') LIKE ? ESCAPE '\\' OR IFNULL(detail,'') LIKE ? ESCAPE '\\' OR IFNULL(cause,'') LIKE ? ESCAPE '\\' OR IFNULL(solution,'') LIKE ? ESCAPE '\\')`)
        .join(' OR ')
      const params: SqlParam[] = []
      for (const k of terms) {
        const p = `%${k.replace(/[\\%_]/g, (m) => '\\' + m)}%`
        params.push(p, p, p, p)
      }
      pull(`SELECT * FROM op_logs WHERE ${base} AND (${like}) ORDER BY log_date DESC LIMIT 200`, params)
    }

    const hits = rankRecallHits(candidates.map(rowToOpLog), keywords, {
      projectId: opts.projectId,
      system: opts.system,
      category: opts.category,
    })
    return hits.slice(0, limit)
  },

  /** 读取台账向量缓存（仅返回 model 匹配的行；模型换版自动失效） */
  getEmbeddings(logIds: string[], model: string): Map<string, number[]> {
    const map = new Map<string, number[]>()
    if (logIds.length === 0) return map
    const placeholders = logIds.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT log_id, vector FROM op_log_embeddings WHERE model = ? AND log_id IN (${placeholders})`)
      .all(model, ...logIds) as Array<{ log_id: string; vector: string }>
    for (const r of rows) {
      try {
        map.set(r.log_id, JSON.parse(r.vector) as number[])
      } catch {
        // 缓存行损坏时忽略，由调用方现算重建
      }
    }
    return map
  },

  /** 批量写入/覆盖台账向量缓存 */
  saveEmbeddings(items: Array<{ logId: string; model: string; vector: number[] }>): void {
    const stmt = db.prepare(
      `INSERT INTO op_log_embeddings (log_id, model, vector, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(log_id) DO UPDATE SET model = excluded.model, vector = excluded.vector, updated_at = excluded.updated_at`,
    )
    const now = new Date().toISOString()
    for (const it of items) stmt.run(it.logId, it.model, JSON.stringify(it.vector), now)
  },

  /** 清除台账向量缓存（内容变更/删除时调用，由下次召回现算重建） */
  invalidateEmbedding(logId: string): void {
    db.prepare('DELETE FROM op_log_embeddings WHERE log_id = ?').run(logId)
  },

  create(userId: string, data: OpLogInput): OpLog {
    const id = genId()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO op_logs (id, project_id, user_id, category, status, proposer, system, department, log_date, recorder, problem, completion_date, hours, detail, cause, solution, extra_fields, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.projectId || null,
      userId,
      data.category || '其他',
      data.status || '待处理',
      data.proposer || '',
      data.system || '',
      data.department || '',
      data.logDate || now.slice(0, 10),
      data.recorder || '',
      data.problem,
      data.completionDate || null,
      data.hours || 0,
      data.detail || '',
      data.cause || '',
      data.solution || '',
      JSON.stringify(data.extraFields || {}),
      data.createdAt || now,
      now,
    )
    return this.findById(id)
  },

  update(id: string, data: Partial<OpLogInput>): OpLog | null {
    const existing = this.findById(id)
    if (!existing) return null
    const now = new Date().toISOString()
    const merged = {
      projectId: data.projectId !== undefined ? data.projectId : existing.projectId,
      category: data.category !== undefined ? data.category : existing.category,
      status: data.status !== undefined ? data.status : existing.status,
      proposer: data.proposer !== undefined ? data.proposer : existing.proposer,
      system: data.system !== undefined ? data.system : existing.system,
      department: data.department !== undefined ? data.department : existing.department,
      logDate: data.logDate !== undefined ? data.logDate : existing.logDate,
      recorder: data.recorder !== undefined ? data.recorder : existing.recorder,
      problem: data.problem !== undefined ? data.problem : existing.problem,
      completionDate: data.completionDate !== undefined ? data.completionDate : existing.completionDate,
      hours: data.hours !== undefined ? data.hours : existing.hours,
      detail: data.detail !== undefined ? data.detail : existing.detail,
      cause: data.cause !== undefined ? data.cause : existing.cause,
      solution: data.solution !== undefined ? data.solution : existing.solution,
      extraFields: data.extraFields !== undefined ? data.extraFields : existing.extraFields,
    }
    db.prepare(`
      UPDATE op_logs SET project_id=?, category=?, status=?, proposer=?, system=?, department=?, log_date=?, recorder=?, problem=?, completion_date=?, hours=?, detail=?, cause=?, solution=?, extra_fields=?, updated_at=?
      WHERE id=?
    `).run(
      merged.projectId || null,
      merged.category,
      merged.status,
      merged.proposer,
      merged.system,
      merged.department,
      merged.logDate,
      merged.recorder,
      merged.problem,
      merged.completionDate || null,
      merged.hours,
      merged.detail,
      merged.cause,
      merged.solution,
      JSON.stringify(merged.extraFields || {}),
      now,
      id,
    )
    // 内容可能已变化，向量缓存失效，由下次召回现算重建
    this.invalidateEmbedding(id)
    return this.findById(id)
  },

  softDelete(id: string): boolean {
    const r = db.prepare('UPDATE op_logs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), id)
    if (r.changes > 0) this.invalidateEmbedding(id)
    return r.changes > 0
  },

  distinct(column: 'category' | 'system' | 'department', projectId?: string, projectIds?: string[] | null): string[] {
    const sc = scopeClause(projectIds)
    if (sc === null) return []
    let sql = `SELECT DISTINCT ${column} FROM op_logs WHERE deleted_at IS NULL AND ${column} IS NOT NULL AND ${column} != ''`
    const params: SqlParam[] = []
    if (projectId === 'none') {
      sql += ' AND project_id IS NULL'
    } else if (projectId) {
      sql += ' AND project_id = ?'
      params.push(projectId)
    } else if (sc) {
      sql += sc
      params.push(...(projectIds as string[]))
    }
    sql += ` ORDER BY ${column}`
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map((r) => String(r[column]))
  },

  /** 按月+分类分组统计条数与工时合计（支持项目隔离及筛选条件） */
  stats(filter: OpLogFilter = {}): Array<{ month: string; category: string; count: number; hours: number }> {
    // 使用 SUBSTR 提取 YYYY-MM，兼容 TEXT 和 DATE 类型的 log_date
    let sql = `SELECT
      SUBSTR(CAST(log_date AS TEXT), 1, 7) AS month,
      COALESCE(category, '其他') AS category,
      COUNT(*) AS count,
      COALESCE(SUM(hours), 0) AS hours
    FROM op_logs WHERE deleted_at IS NULL AND log_date IS NOT NULL`
    const sc = scopeClause(filter.projectIds)
    if (sc === null) return []
    const params: SqlParam[] = []

    if (filter.projectId === 'none') {
      sql += ' AND project_id IS NULL'
    } else if (filter.projectId) {
      sql += ' AND project_id = ?'
      params.push(filter.projectId)
    } else if (sc) {
      sql += sc
      params.push(...(filter.projectIds as string[]))
    }
    if (filter.category) { sql += ' AND category = ?'; params.push(filter.category) }
    if (filter.status) { sql += ' AND status = ?'; params.push(filter.status) }
    if (filter.system) { sql += ' AND system = ?'; params.push(filter.system) }
    if (filter.department) { sql += ' AND department = ?'; params.push(filter.department) }
    if (filter.dateFrom) { sql += ' AND log_date >= ?'; params.push(filter.dateFrom) }
    if (filter.dateTo) { sql += ' AND log_date <= ?'; params.push(filter.dateTo) }
    if (filter.keyword) {
      sql += ' AND (problem LIKE ? OR detail LIKE ? OR cause LIKE ? OR solution LIKE ? OR system LIKE ? OR proposer LIKE ?)'
      const kw = `%${filter.keyword}%`
      params.push(kw, kw, kw, kw, kw, kw)
    }

    sql += ' GROUP BY month, category ORDER BY month DESC, category ASC'
    const rows = db.prepare(sql).all(...params) as SqlRow[]
    return rows.map((r) => ({
      month: String(r.month),
      category: String(r.category),
      count: Number(r.count),
      hours: Number(r.hours) || 0,
    }))
  },
}