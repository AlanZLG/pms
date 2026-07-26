// 数据访问层

import db from '../db.ts'
import { genId, parseLabels } from '../lib/utils.ts'
import type {
  User, Project, ProjectMember, Task, Comment, TaskStatus,
  ProjectStatus, TaskPriority, MemberRole,
} from '../../shared/types.ts'

// ===== Users =====
export const userRepo = {
  findByEmail(email: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
    return row ? rowToUser(row) : null
  },
  findById(id: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
    return row ? rowToUser(row) : null
  },
  findAll(): User[] {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[]
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
}

// ===== Projects =====
export const projectRepo = {
  findAll(): Project[] {
    const rows = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      ORDER BY p.created_at DESC
    `).all() as any[]
    return rows.map(rowToProject)
  },
  findById(id: string): Project | null {
    const row = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(id) as any
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
    `).all(userId) as any[]
    return rows.map(rowToProject)
  },
  create(data: { name: string; description: string; status: ProjectStatus; ownerId: string; dueDate: string | null }): Project {
    const id = genId()
    db.prepare(
      'INSERT INTO projects (id, name, description, status, owner_id, progress, due_date, created_at) VALUES (?,?,?,?,0,?,?)',
    ).run(id, data.name, data.description, data.status, data.ownerId, data.dueDate, new Date().toISOString())
    // 创建者自动成为 owner 成员
    db.prepare(
      'INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)',
    ).run(genId(), id, data.ownerId, 'owner', new Date().toISOString())
    return this.findById(id)!
  },
  update(id: string, data: Partial<{ name: string; description: string; status: ProjectStatus; dueDate: string | null }>): void {
    const fields: string[] = []
    const values: any[] = []
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.dueDate !== undefined) { fields.push('due_date = ?'); values.push(data.dueDate) }
    if (!fields.length) return
    values.push(id)
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  },
  updateProgress(id: string): void {
    const row = db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as dones
       FROM tasks WHERE project_id = ?`,
    ).get(id) as { total: number; dones: number }
    const progress = row.total === 0 ? 0 : Math.round((row.dones / row.total) * 100)
    db.prepare('UPDATE projects SET progress = ? WHERE id = ?').run(progress, id)
  },
  members(projectId: string): ProjectMember[] {
    const rows = db.prepare('SELECT user_id, role, joined_at FROM project_members WHERE project_id = ?').all(projectId) as any[]
    return rows.map((r) => ({ userId: r.user_id, role: r.role as MemberRole, joinedAt: r.joined_at }))
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
  findByProject(projectId: string): Task[] {
    const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as any[]
    return rows.map(rowToTask)
  },
  findById(id: string): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
    return row ? rowToTask(row) : null
  },
  findByAssignee(userId: string): Task[] {
    const rows = db.prepare(`
      SELECT * FROM tasks
      WHERE assignee_id = ? AND status != 'done'
      ORDER BY due_date IS NULL, due_date ASC
    `).all(userId) as any[]
    return rows.map(rowToTask)
  },
  findByAssigneeAll(userId: string): Task[] {
    const rows = db.prepare('SELECT * FROM tasks WHERE assignee_id = ?').all(userId) as any[]
    return rows.map(rowToTask)
  },
  create(data: {
    projectId: string; title: string; description: string;
    status: TaskStatus; priority: TaskPriority;
    assigneeId: string | null; labels: string[]; dueDate: string | null;
  }): Task {
    const id = genId()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, labels, due_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, data.projectId, data.title, data.description, data.status, data.priority, data.assigneeId, JSON.stringify(data.labels), data.dueDate, now, now)
    return this.findById(id)!
  },
  update(id: string, data: Partial<{
    title: string; description: string; status: TaskStatus;
    priority: TaskPriority; assigneeId: string | null;
    labels: string[]; dueDate: string | null;
  }>): void {
    const fields: string[] = []
    const values: any[] = []
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.priority !== undefined) { fields.push('priority = ?'); values.push(data.priority) }
    if (data.assigneeId !== undefined) { fields.push('assignee_id = ?'); values.push(data.assigneeId) }
    if (data.labels !== undefined) { fields.push('labels = ?'); values.push(JSON.stringify(data.labels)) }
    if (data.dueDate !== undefined) { fields.push('due_date = ?'); values.push(data.dueDate) }
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
  countByStatus(projectId?: string): Record<string, number> {
    const where = projectId ? `WHERE project_id = ?` : ''
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
      WHERE created_at >= ?
      GROUP BY d ORDER BY d
    `).all(since) as { d: string; c: number }[]
    const doneRows = db.prepare(`
      SELECT DATE(updated_at) as d, COUNT(*) as c FROM tasks
      WHERE status = 'done' AND updated_at >= ?
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
    const tasks = db.prepare('SELECT created_at, updated_at, status FROM tasks WHERE project_id = ?').all(projectId) as any[]
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
    `).all(taskId) as any[]
    return rows.map(rowToComment)
  },
  create(taskId: string, userId: string, content: string): Comment {
    const id = genId()
    db.prepare('INSERT INTO comments (id, task_id, user_id, content, created_at) VALUES (?,?,?,?,?)')
      .run(id, taskId, userId, content, new Date().toISOString())
    return this.findByTask(taskId).find((c) => c.id === id)!
  },
}

// ===== 行映射 =====
function rowToUser(r: any): User {
  return {
    id: r.id, email: r.email, name: r.name, avatarColor: r.avatar_color,
    role: r.role, createdAt: r.created_at,
  }
}
function rowToProject(r: any): Project {
  return {
    id: r.id, name: r.name, description: r.description || '',
    status: r.status, ownerId: r.owner_id, progress: r.progress,
    dueDate: r.due_date, createdAt: r.created_at,
    members: projectRepo.members(r.id),
  }
}
function rowToTask(r: any): Task {
  return {
    id: r.id, projectId: r.project_id, title: r.title, description: r.description || '',
    status: r.status, priority: r.priority, assigneeId: r.assignee_id,
    labels: parseLabels(r.labels), dueDate: r.due_date,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
function rowToComment(r: any): Comment {
  return {
    id: r.id, taskId: r.task_id, userId: r.user_id,
    userName: r.user_name, avatarColor: r.avatar_color,
    content: r.content, createdAt: r.created_at,
  }
}