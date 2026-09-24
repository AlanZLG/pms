import Database from 'better-sqlite3'
import bcrypt from 'bcrypt'
import crypto from 'crypto'

export type SqlRow = Record<string, unknown>

/**
 * 创建内存数据库，包含测试所需的全部表结构。
 * 表结构与 api/db.ts 保持一致（仅保留测试涉及的字段）。
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#6366F1',
      role TEXT NOT NULL CHECK(role IN ('admin','finance','owner','member','guest')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      category_id TEXT,
      token_version INTEGER NOT NULL DEFAULT 0,
      feishu_open_id TEXT,
      feishu_union_id TEXT,
      feishu_bound_at DATETIME,
      is_outsourced INTEGER NOT NULL DEFAULT 0,
      hourly_rate DECIMAL(10,2),
      cost_center TEXT,
      custom_role_id TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL CHECK(status IN ('planning','active','completed','archived')),
      owner_id TEXT NOT NULL REFERENCES users(id),
      progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
      start_date DATETIME,
      due_date DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL CHECK(status IN ('todo','in_progress','review','done')),
      priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','urgent')),
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      labels TEXT NOT NULL DEFAULT '',
      due_date DATETIME,
      start_date DATETIME,
      progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      custom_status TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      planned_hours DECIMAL(6,2)
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS op_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '其他',
      status TEXT NOT NULL DEFAULT '待处理' CHECK(status IN ('待处理','处理中','已完成','已关闭')),
      proposer TEXT,
      system TEXT,
      department TEXT,
      log_date TEXT NOT NULL,
      recorder TEXT,
      problem TEXT NOT NULL,
      completion_date TEXT,
      hours REAL NOT NULL DEFAULT 0,
      detail TEXT,
      cause TEXT,
      solution TEXT,
      extra_fields TEXT NOT NULL DEFAULT '{}',
      deleted_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS op_log_embeddings (
      log_id TEXT PRIMARY KEY REFERENCES op_logs(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      vector TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      task_id TEXT,
      project_id TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS saved_filters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      filter_config TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_history (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_activity_log (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_hours (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date DATE NOT NULL,
      planned_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
      actual_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
      billed_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
      description TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_budgets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('labor','outsource','hardware','software','other')),
      amount DECIMAL(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RMB',
      description TEXT,
      created_by TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_expenses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      budget_id TEXT,
      category TEXT NOT NULL CHECK(category IN ('labor','outsource','hardware','software','other')),
      amount DECIMAL(12,2) NOT NULL,
      description TEXT,
      date DATE NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  return db
}

export function genId(): string {
  return crypto.randomUUID()
}

/** 插入测试用户，返回 userId */
export function seedUser(db: Database.Database, opts: { id?: string; email?: string; name?: string; role?: string; password?: string } = {}): string {
  const id = opts.id || genId()
  const email = opts.email || `test-${id}@pm.dev`
  const hash = bcrypt.hashSync(opts.password || '12345', 10)
  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, avatar_color, role, created_at, token_version) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, email, hash, opts.name || '测试用户', '#6366F1', opts.role || 'admin', new Date().toISOString(), 0)
  return id
}

/** 插入测试项目，返回 projectId */
export function seedProject(db: Database.Database, ownerId: string, opts: { id?: string; name?: string; status?: string } = {}): string {
  const id = opts.id || genId()
  db.prepare(
    'INSERT INTO projects (id, name, description, status, owner_id, progress, created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(id, opts.name || '测试项目', '', opts.status || 'active', ownerId, 0, new Date().toISOString())
  return id
}

/** 插入测试任务，返回 taskId */
export function seedTask(
  db: Database.Database,
  projectId: string,
  opts: { id?: string; title?: string; status?: string; priority?: string; plannedHours?: number; assigneeId?: string; startDate?: string; dueDate?: string } = {},
): string {
  const id = opts.id || genId()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, labels, progress, created_at, updated_at, sort_order, planned_hours, start_date, due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id, projectId, opts.title || '测试任务', '', opts.status || 'todo', opts.priority || 'medium',
    opts.assigneeId || null, '[]', 0, now, now, 0, opts.plannedHours ?? null,
    opts.startDate || null, opts.dueDate || null,
  )
  return id
}

/** 插入测试子任务，返回 subtaskId */
export function seedSubtask(db: Database.Database, taskId: string, opts: { id?: string; title?: string; done?: boolean } = {}): string {
  const id = opts.id || genId()
  db.prepare(
    'INSERT INTO subtasks (id, task_id, title, done, sort_order, created_at) VALUES (?,?,?,?,?,?)',
  ).run(id, taskId, opts.title || '子任务', opts.done ? 1 : 0, 0, new Date().toISOString())
  return id
}

/** 插入测试运维台账，返回 opLogId */
export function seedOpLog(
  db: Database.Database,
  userId: string,
  opts: {
    id?: string
    projectId?: string | null
    status?: string
    problem?: string
    detail?: string
    cause?: string
    solution?: string
    system?: string
    category?: string
    logDate?: string
  } = {},
): string {
  const id = opts.id || genId()
  db.prepare(
    'INSERT INTO op_logs (id, project_id, user_id, category, status, system, log_date, problem, detail, cause, solution) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    opts.projectId ?? null,
    userId,
    opts.category || '其他',
    opts.status || '已完成',
    opts.system || '',
    opts.logDate || new Date().toISOString().slice(0, 10),
    opts.problem || '测试问题',
    opts.detail || '',
    opts.cause || '',
    opts.solution || '',
  )
  return id
}
