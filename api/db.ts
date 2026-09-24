// 数据库连接与初始化

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import bcrypt from 'bcrypt'
import crypto from 'crypto'

// 以 cwd(项目根)为基准存放数据库,避开 tsx 临时目录问题
// 可用 FORTUNE_DB_PATH 覆盖（e2e 集成测试用临时库，避免触碰生产数据）
const DB_PATH = path.resolve(process.cwd(), process.env.FORTUNE_DB_PATH || 'data/app.db')

// 自动创建目录
const dbDir = path.dirname(DB_PATH)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/**
 * SQLite 查询返回的原始行：字段名/类型动态，由各 rowTo* 映射函数负责收窄类型。
 * 这是数据库边界的唯一 any 出口，业务代码中请勿再使用 any。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqlRow = Record<string, any>

/** better-sqlite3 支持的绑定参数类型 */
export type SqlParam = string | number | bigint | boolean | null

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#6366F1',
  role TEXT NOT NULL CHECK(role IN ('admin','finance','owner','member','guest')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  category_id TEXT REFERENCES user_categories(id)
);

CREATE TABLE IF NOT EXISTS user_categories (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 0,
  is_outsourced INTEGER NOT NULL DEFAULT 0 CHECK(is_outsourced IN (0,1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('planning','active','completed','archived')),
  project_type TEXT,
  merged_into_project_id TEXT,
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
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  task_id TEXT,
  project_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  labels TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

CREATE TABLE IF NOT EXISTS saved_filters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter_config TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_saved_filters_user ON saved_filters(user_id);

CREATE TABLE IF NOT EXISTS project_kanban_columns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status_key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366F1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, status_key)
);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_project ON project_kanban_columns(project_id);

-- 项目模板表
CREATE TABLE IF NOT EXISTS project_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 模板任务表
CREATE TABLE IF NOT EXISTS template_tasks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  planned_hours REAL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 模板预算类别表
CREATE TABLE IF NOT EXISTS template_budgets (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 模板看板列配置
CREATE TABLE IF NOT EXISTS template_kanban_columns (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  status_key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366F1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_template_tasks ON template_tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_template_budgets ON template_budgets(template_id);
CREATE INDEX IF NOT EXISTS idx_template_kanban ON template_kanban_columns(template_id);

-- 自定义角色表
CREATE TABLE IF NOT EXISTS custom_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 权限定义表（预置所有可用权限）
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 角色权限关联表
CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions ON role_permissions(role_id);
`)

try {
  const cols = (db.pragma('table_info(users)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('feishu_open_id')) {
    db.exec('ALTER TABLE users ADD COLUMN feishu_open_id TEXT')
    db.exec('ALTER TABLE users ADD COLUMN feishu_union_id TEXT')
    db.exec('ALTER TABLE users ADD COLUMN feishu_bound_at DATETIME')
    console.log('[db] 已添加飞书绑定字段到 users 表')
  }
  if (!cols.includes('is_outsourced')) {
    db.exec('ALTER TABLE users ADD COLUMN is_outsourced INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE users ADD COLUMN hourly_rate DECIMAL(10,2)')
    db.exec('ALTER TABLE users ADD COLUMN cost_center TEXT')
    console.log('[db] 已添加成本字段到 users 表')
  }
} catch {
  // 迁移已执行过，忽略重复添加字段错误
}

// 演示账号：与 seed 演示数据同受 FORTUNE_SEED_DEMO 开关控制，设为 0 时不补插（已删除不复活）
if (process.env.FORTUNE_SEED_DEMO !== '0') {
  try {
    db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, name, avatar_color, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run('finance', 'finance@pm.dev', bcrypt.hashSync('12345', 10), '项目核算人员', '#06B6D4', 'finance', new Date().toISOString())
    console.log('[db] 已创建项目核算人员账号')
  } catch {
    // 账号已存在
  }
}

try {
    const taskCols = (db.pragma('table_info(tasks)') as { name: string }[]).map(c => c.name)
    if (!taskCols.includes('planned_hours')) {
      db.exec('ALTER TABLE tasks ADD COLUMN planned_hours DECIMAL(8,2)')
      console.log('[db] 已添加计划工时字段到 tasks 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const budgetCols = (db.pragma('table_info(project_budgets)') as { name: string }[]).map(c => c.name)
    if (!budgetCols.includes('approval_status')) {
      db.exec('ALTER TABLE project_budgets ADD COLUMN approval_status TEXT NOT NULL DEFAULT \'pending\'')
      db.exec('ALTER TABLE project_budgets ADD COLUMN approved_by TEXT REFERENCES users(id)')
      db.exec('ALTER TABLE project_budgets ADD COLUMN approved_at DATETIME')
      db.exec('ALTER TABLE project_budgets ADD COLUMN approval_comment TEXT')
      console.log('[db] 已添加审批字段到 project_budgets 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const cols = (db.pragma('table_info(users)') as { name: string }[]).map(c => c.name)
    if (!cols.includes('category_id')) {
      db.exec('ALTER TABLE users ADD COLUMN category_id TEXT REFERENCES user_categories(id)')
      console.log('[db] 已添加 category_id 字段到 users 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const projCols = (db.pragma('table_info(projects)') as { name: string }[]).map(c => c.name)
    if (!projCols.includes('start_date')) {
      db.exec('ALTER TABLE projects ADD COLUMN start_date DATETIME')
      console.log('[db] 已添加 start_date 字段到 projects 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const projCols = (db.pragma('table_info(projects)') as { name: string }[]).map(c => c.name)
    if (!projCols.includes('project_type')) {
      db.exec('ALTER TABLE projects ADD COLUMN project_type TEXT')
      console.log('[db] 已添加 project_type 字段到 projects 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const projCols2 = (db.pragma('table_info(projects)') as { name: string }[]).map(c => c.name)
    if (!projCols2.includes('merged_into_project_id')) {
      db.exec('ALTER TABLE projects ADD COLUMN merged_into_project_id TEXT')
      console.log('[db] 已添加 merged_into_project_id 字段到 projects 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const tplCols = (db.pragma('table_info(project_templates)') as { name: string }[]).map(c => c.name)
    if (!tplCols.includes('category')) {
      db.exec('ALTER TABLE project_templates ADD COLUMN category TEXT')
      console.log('[db] 已添加 category 字段到 project_templates 表')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  try {
    const taskCols = (db.pragma('table_info(tasks)') as { name: string }[]).map(c => c.name)
    if (!taskCols.includes('start_date')) {
      db.exec('ALTER TABLE tasks ADD COLUMN start_date DATETIME')
      console.log('[db] 已添加 start_date 字段到 tasks 表')
    }
    if (!taskCols.includes('progress')) {
      db.exec('ALTER TABLE tasks ADD COLUMN progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100)')
      console.log('[db] 已添加 progress 字段到 tasks 表')
    }
    if (!taskCols.includes('actual_start_date')) {
      db.exec('ALTER TABLE tasks ADD COLUMN actual_start_date DATETIME')
      console.log('[db] 已添加 actual_start_date 字段到 tasks 表')
    }
    if (!taskCols.includes('actual_end_date')) {
      db.exec('ALTER TABLE tasks ADD COLUMN actual_end_date DATETIME')
      console.log('[db] 已添加 actual_end_date 字段到 tasks 表')
    }
    if (!taskCols.includes('deleted_at')) {
      db.exec('ALTER TABLE tasks ADD COLUMN deleted_at DATETIME')
      console.log('[db] 已添加 deleted_at 字段到 tasks 表')
    }
    if (!taskCols.includes('custom_status')) {
      db.exec('ALTER TABLE tasks ADD COLUMN custom_status TEXT')
      console.log('[db] 已添加 custom_status 字段到 tasks 表')
    }
    if (!taskCols.includes('sort_order')) {
      db.exec('ALTER TABLE tasks ADD COLUMN sort_order REAL NOT NULL DEFAULT 0')
      console.log('[db] 已添加 sort_order 字段到 tasks 表')
    }
  } catch {
    // 迁移已执行过，忽略重复添加字段错误
  }

  // 子任务负责人 + 工时计费字段
  try {
    const subCols = (db.pragma('table_info(subtasks)') as { name: string }[]).map(c => c.name)
    if (!subCols.includes('assignee_id')) {
      db.exec('ALTER TABLE subtasks ADD COLUMN assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL')
      console.log('[db] 已添加 assignee_id 字段到 subtasks 表')
    }
    if (!subCols.includes('sort_order')) {
      db.exec('ALTER TABLE subtasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
      // 按创建顺序回填排序号
      db.exec(`UPDATE subtasks SET sort_order = (
        SELECT COUNT(*) FROM subtasks s2
        WHERE s2.task_id = subtasks.task_id AND (s2.created_at < subtasks.created_at
          OR (s2.created_at = subtasks.created_at AND s2.id <= subtasks.id))
      )`)
      console.log('[db] 已添加 sort_order 字段到 subtasks 表并回填')
    }
  } catch {
    // 迁移已执行过，忽略重复添加字段错误
  }
  try {
    const hourCols = (db.pragma('table_info(task_hours)') as { name: string }[]).map(c => c.name)
    if (!hourCols.includes('billed_hours')) {
      db.exec('ALTER TABLE task_hours ADD COLUMN billed_hours DECIMAL(6,2) NOT NULL DEFAULT 0')
      console.log('[db] 已添加 billed_hours 字段到 task_hours 表')
    }
    // 工时单价快照：登记时冻结当时生效单价（个人价 > 类别价 > 角色默认价），改价不追溯历史
    if (!hourCols.includes('rate_snapshot')) {
      db.exec('ALTER TABLE task_hours ADD COLUMN rate_snapshot DECIMAL(10,2)')
      console.log('[db] 已添加 rate_snapshot 字段到 task_hours 表')
    }
    if (!hourCols.includes('rate_source')) {
      db.exec("ALTER TABLE task_hours ADD COLUMN rate_source TEXT")
      console.log('[db] 已添加 rate_source 字段到 task_hours 表')
    }
  } catch {
    // 迁移已执行过，忽略重复添加字段错误
  }

  // 数据修复：已完成任务进度统一为 100%，并按任务进度重算各项目整体进度
  try {
    const doneFixed = db.prepare(
      `UPDATE tasks SET progress = 100 WHERE status = 'done' AND deleted_at IS NULL AND (progress IS NULL OR progress < 100)`,
    ).run()
    // 有子任务的任务进度 = 子任务完成比例（与 recalcProgress 规则一致）
    const subFixed = db.prepare(`
      UPDATE tasks SET progress = CAST(ROUND(100.0 *
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = tasks.id AND s.done = 1) /
        (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = tasks.id)) AS INTEGER)
      WHERE deleted_at IS NULL AND status != 'done'
        AND EXISTS (SELECT 1 FROM subtasks WHERE task_id = tasks.id)
        AND progress != CAST(ROUND(100.0 *
          (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = tasks.id AND s.done = 1) /
          (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = tasks.id)) AS INTEGER)
    `).run()
    const projectsFixed = db.prepare(`
      UPDATE projects SET progress = CASE
        WHEN status = 'completed' THEN 100
        ELSE (
          SELECT MAX(
            CAST(ROUND(AVG(CASE WHEN status='done' THEN 100 ELSE COALESCE(progress, 0) END)) AS INTEGER),
            CAST(ROUND(100.0 * SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) / COUNT(*)) AS INTEGER)
          )
          FROM tasks WHERE tasks.project_id = projects.id AND tasks.deleted_at IS NULL
        )
      END
      WHERE status = 'completed'
         OR EXISTS (SELECT 1 FROM tasks WHERE tasks.project_id = projects.id AND tasks.deleted_at IS NULL)
    `).run()
    if (doneFixed.changes > 0 || projectsFixed.changes > 0 || subFixed.changes > 0) {
      console.log(`[db] 数据修复: ${doneFixed.changes} 个已完成任务进度置 100，${subFixed.changes} 个子任务进度重算，重算 ${projectsFixed.changes} 个项目进度`)
    }
    // 空项目进度归零（completed 除外），清理任务全部删除后的残留进度
    const emptyFixed = db.prepare(`
      UPDATE projects SET progress = 0
      WHERE status != 'completed' AND progress != 0
        AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.project_id = projects.id AND tasks.deleted_at IS NULL)
    `).run()
    if (emptyFixed.changes > 0) {
      console.log(`[db] 数据修复: ${emptyFixed.changes} 个无任务项目进度归零`)
    }
  } catch {
    // 修复失败不阻断启动
  }

  try {
    const catCols = (db.pragma('table_info(user_categories)') as { name: string }[])
    if (!catCols.length) {
      db.exec(`
        CREATE TABLE user_categories (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT,
          hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 0,
          is_outsourced INTEGER NOT NULL DEFAULT 0 CHECK(is_outsourced IN (0,1)),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
      console.log('[db] 已创建 user_categories 表')
      
      db.prepare(`INSERT INTO user_categories (id, name, description, hourly_rate, is_outsourced, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        'cat_internal_dev', '内部开发', '内部开发人员', 200, 0, new Date().toISOString()
      )
      db.prepare(`INSERT INTO user_categories (id, name, description, hourly_rate, is_outsourced, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        'cat_internal_design', '内部设计', '内部设计师', 180, 0, new Date().toISOString()
      )
      db.prepare(`INSERT INTO user_categories (id, name, description, hourly_rate, is_outsourced, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        'cat_internal_pm', '内部PM', '内部项目经理', 250, 0, new Date().toISOString()
      )
      db.prepare(`INSERT INTO user_categories (id, name, description, hourly_rate, is_outsourced, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        'cat_outsource_dev', '外包开发', '外包开发人员', 300, 1, new Date().toISOString()
      )
      db.prepare(`INSERT INTO user_categories (id, name, description, hourly_rate, is_outsourced, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        'cat_outsource_design', '外包设计', '外包设计师', 250, 1, new Date().toISOString()
      )
      console.log('[db] 已初始化默认人员类别')
    }
  } catch {
  // 迁移已执行过，忽略重复添加字段错误
}

  db.exec(`
CREATE TABLE IF NOT EXISTS project_budgets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('labor','outsource','hardware','software','other')),
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RMB',
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at DATETIME,
  approval_comment TEXT
);

CREATE TABLE IF NOT EXISTS project_expenses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  budget_id TEXT REFERENCES project_budgets(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK(category IN ('labor','outsource','hardware','software','other')),
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_hours (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  planned_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
  actual_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
  billed_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
  description TEXT,
  rate_snapshot DECIMAL(10,2),
  rate_source TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_budgets_project ON project_budgets(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON project_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_hours_task ON task_hours(task_id);
CREATE INDEX IF NOT EXISTS idx_hours_user ON task_hours(user_id);
CREATE INDEX IF NOT EXISTS idx_hours_date ON task_hours(date);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'fs' CHECK(type IN ('fs','ss','ff','sf')),
  lag_days INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_dep_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_dep_depends ON task_dependencies(depends_on_task_id);

CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON task_history(user_id);

-- 项目级操作日志：记录负责人转移、人员替换等项目维度操作（任务级明细在 task_history）
CREATE TABLE IF NOT EXISTS project_activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pactivity_project ON project_activity_log(project_id, created_at);

CREATE TABLE IF NOT EXISTS system_activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sactivity_created ON system_activity_log(created_at);

CREATE TABLE IF NOT EXISTS op_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
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

CREATE INDEX IF NOT EXISTS idx_oplogs_project ON op_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_oplogs_user ON op_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_oplogs_date ON op_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_oplogs_category ON op_logs(category);
CREATE INDEX IF NOT EXISTS idx_oplogs_status ON op_logs(status);

-- 台账向量缓存（AI 经验召回的 embedding 语义重排）：model 变更自动失效（按 model 过滤读取）
CREATE TABLE IF NOT EXISTS op_log_embeddings (
  log_id TEXT PRIMARY KEY REFERENCES op_logs(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  vector TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`)

// 种子数据: 分阶段插入，已存在的阶段会跳过
function seed() {
  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }).c

  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4']
  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()
  const pwd = bcrypt.hashSync('12345', 10)

  // Phase 1: 确保所有演示用户存在
  // 管理员账号始终确保存在（登录与 e2e 依赖）；其余演示账号与演示数据受
  // FORTUNE_SEED_DEMO 开关控制：设为 0 时不补插，已删除的演示账号不再复活
  const seedDemo = process.env.FORTUNE_SEED_DEMO !== '0'
  const neededUsers = [
    { name: 'Alan', email: 'leigang@creat-value.com', role: 'admin', color: colors[0] },
    { name: '负责人', email: 'owner@pm.dev', role: 'owner', color: colors[1] },
    { name: '成员甲', email: 'member1@pm.dev', role: 'member', color: colors[2] },
    { name: '成员乙', email: 'member2@pm.dev', role: 'member', color: colors[3] },
    { name: '项目核算人员', email: 'finance@pm.dev', role: 'finance', color: colors[4] },
    { name: '访客', email: 'guest@pm.dev', role: 'guest', color: colors[5] },
  ]
  const insertUser = db.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, name, avatar_color, role, created_at) VALUES (?,?,?,?,?,?,?)',
  )
  const userIds: Record<string, string> = {}
  const ensureUser = (u: (typeof neededUsers)[number]) => {
    // 查找已有用户，没有就创建
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email) as { id: string } | undefined
    if (existing) {
      userIds[u.email] = existing.id
    } else {
      const uid = id()
      insertUser.run(uid, u.email, pwd, u.name, u.color, u.role, now)
      userIds[u.email] = uid
    }
  }
  ensureUser(neededUsers[0])
  if (!seedDemo) return
  neededUsers.slice(1).forEach(ensureUser)

  if (projectCount > 0) return  // 已有项目就不补了

  const adminId = userIds['leigang@creat-value.com']
  const ownerId = userIds['owner@pm.dev']
  const member1Id = userIds['member1@pm.dev']
  const member2Id = userIds['member2@pm.dev']

  // Phase 2: 创建项目
  const projectDefs = [
    { name: 'Fortune 后台重构', desc: '将旧版后台迁移至新架构,提升可维护性与性能。', status: 'active', type: '开发项目', due: new Date(Date.now() + 14 * 86400000).toISOString() },
    { name: '项目管理系统', desc: '移动端核心体验升级,包含新首页与个人中心。', status: 'planning', type: '开发项目', due: new Date(Date.now() + 45 * 86400000).toISOString() },
    { name: '数据可视化平台', desc: '构建可配置的看板与报表系统。', status: 'active', type: '开发项目', due: new Date(Date.now() + 30 * 86400000).toISOString() },
    { name: '官网改版', desc: '已完成上线,归档备查。', status: 'completed', type: '实施项目', due: new Date(Date.now() - 10 * 86400000).toISOString() },
  ]
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, description, status, project_type, owner_id, progress, due_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)',
  )

  const projectIds: string[] = []
  projectDefs.forEach((p, idx) => {
    const pid = id()
    const progress = p.status === 'completed' ? 100 : [35, 10, 55, 100][idx]
    insertProject.run(pid, p.name, p.desc, p.status, p.type, ownerId, progress, p.due, now)
    projectIds.push(pid)
    // 项目成员
    insertMember.run(id(), pid, ownerId, 'owner', now)
    insertMember.run(id(), pid, member1Id, 'editor', now)
    insertMember.run(id(), pid, member2Id, 'editor', now)
    insertMember.run(id(), pid, adminId, 'viewer', now)
  })

  // Phase 3: 创建任务
  const taskDefs = [
    { title: '设计新版导航交互', status: 'done', priority: 'high', assignee: member1Id, labels: ['设计', 'UX'], due: -2 },
    { title: '搭建项目脚手架', status: 'done', priority: 'urgent', assignee: member2Id, labels: ['工程'], due: -1 },
    { title: '实现鉴权模块', status: 'in_progress', priority: 'high', assignee: member2Id, labels: ['后端', '安全'], due: 3 },
    { title: '看板拖拽组件开发', status: 'in_progress', priority: 'high', assignee: member1Id, labels: ['前端'], due: 5 },
    { title: '统计图表接入', status: 'review', priority: 'medium', assignee: member1Id, labels: ['前端', '图表'], due: 2 },
    { title: '编写用户接口文档', status: 'todo', priority: 'low', assignee: member2Id, labels: ['文档'], due: 7 },
    { title: '优化首屏加载性能', status: 'todo', priority: 'medium', assignee: member1Id, labels: ['性能'], due: 9 },
    { title: '移动端适配自测', status: 'todo', priority: 'medium', assignee: member2Id, labels: ['测试', '移动端'], due: 12 },
  ]
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, labels, due_date, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )

  projectIds.forEach((pid, pi) => {
    taskDefs.forEach((t, ti) => {
      const offset = (pi * 2 + ti) * 86400000
      const created = new Date(Date.now() - offset).toISOString()
      const due = new Date(Date.now() + t.due * 86400000).toISOString()
      insertTask.run(
        id(), pid, t.title,
        `针对「${projectDefs[pi].name}」中该任务的详细说明。`,
        t.status, t.priority, t.assignee,
        JSON.stringify(t.labels), due, created, created,
      )
    })
  })

  // 补充任务
  const statuses = ['todo', 'in_progress', 'review', 'done']
  const priorities = ['low', 'medium', 'high', 'urgent']
  const extraAssignees = [member1Id, member2Id, ownerId]
  for (let i = 0; i < 6; i++) {
    const pid = projectIds[i % projectIds.length]
    insertTask.run(
      id(), pid, `补充任务 #${i + 1}`,
      '用于演示看板与统计的填充任务。',
      statuses[i % statuses.length], priorities[i % priorities.length],
      extraAssignees[i % extraAssignees.length],
      JSON.stringify(['演示']),
      new Date(Date.now() + (i + 3) * 86400000).toISOString(),
      new Date(Date.now() - i * 3600000).toISOString(),
      new Date(Date.now() - i * 3600000).toISOString(),
    )
  }

  // Phase 4: 评论
  const insertComment = db.prepare(
    'INSERT INTO comments (id, task_id, user_id, content, created_at) VALUES (?,?,?,?,?)',
  )
  const tasks = db.prepare('SELECT id FROM tasks LIMIT 5').all() as { id: string }[]
  tasks.forEach((tk, idx) => {
    insertComment.run(id(), tk.id, member1Id, '这块我看了一下,需求上还需要再确认优先级。', new Date(Date.now() - idx * 3600000).toISOString())
    insertComment.run(id(), tk.id, ownerId, '已确认,按当前优先级推进即可。', new Date(Date.now() - idx * 3600000 + 1800000).toISOString())
  })
}

try {
  seed()
} catch (e) {
  console.error('[seed] error:', e)
}

// 初始化系统预设模板
function initSystemTemplates() {
  const templateCount = (db.prepare('SELECT COUNT(*) as c FROM project_templates WHERE is_system = 1').get() as { c: number }).c
  if (templateCount > 0) return

  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()

  // 新规开发模板（v1.9.2 由「网站开发模板」更名）
  const webDevTemplateId = id()
  db.prepare('INSERT INTO project_templates (id, name, description, category, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    webDevTemplateId, '新规开发模板', '适用于新规开发项目的标准流程模板', '开发项目', now
  )
  const webDevTasks = [
    { title: '需求分析与调研', description: '收集用户需求，进行竞品分析', status: 'todo', priority: 'high', labels: ['需求'], sortOrder: 0 },
    { title: '原型设计', description: '设计产品原型和交互流程', status: 'todo', priority: 'high', labels: ['设计'], sortOrder: 1 },
    { title: 'UI设计', description: '视觉设计和设计稿输出', status: 'todo', priority: 'high', labels: ['设计'], sortOrder: 2 },
    { title: '前端开发', description: '前端页面开发与交互实现', status: 'todo', priority: 'high', labels: ['前端'], sortOrder: 3 },
    { title: '后端开发', description: '后端API开发与数据库设计', status: 'todo', priority: 'high', labels: ['后端'], sortOrder: 4 },
    { title: '功能测试', description: '功能测试和Bug修复', status: 'todo', priority: 'medium', labels: ['测试'], sortOrder: 5 },
    { title: '性能优化', description: '性能优化和代码审查', status: 'todo', priority: 'medium', labels: ['优化'], sortOrder: 6 },
    { title: '上线部署', description: '部署上线和监控配置', status: 'todo', priority: 'high', labels: ['运维'], sortOrder: 7 },
  ]
  webDevTasks.forEach(task => {
    db.prepare(`INSERT INTO template_tasks (id, template_id, title, description, status, priority, labels, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id(), webDevTemplateId, task.title, task.description, task.status, task.priority, JSON.stringify(task.labels), task.sortOrder, now
    )
  })
  const webDevBudgets = [
    { category: 'labor', description: '人力成本' },
    { category: 'software', description: '软件工具' },
  ]
  webDevBudgets.forEach(budget => {
    db.prepare(`INSERT INTO template_budgets (id, template_id, category, description, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id(), webDevTemplateId, budget.category, budget.description, now
    )
  })
  const webDevColumns = [
    { statusKey: 'todo', label: '待办', color: '#94A3B8', sortOrder: 0 },
    { statusKey: 'in_progress', label: '进行中', color: '#F59E0B', sortOrder: 1 },
    { statusKey: 'review', label: '审核中', color: '#0EA5E9', sortOrder: 2 },
    { statusKey: 'done', label: '已完成', color: '#10B981', sortOrder: 3 },
  ]
  webDevColumns.forEach(col => {
    db.prepare(`INSERT INTO template_kanban_columns (id, template_id, status_key, label, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id(), webDevTemplateId, col.statusKey, col.label, col.color, col.sortOrder, now
    )
  })

  // 产品迭代模板
  const iterationTemplateId = id()
  db.prepare('INSERT INTO project_templates (id, name, description, category, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    iterationTemplateId, '产品迭代模板', '适用于产品迭代更新的敏捷开发模板', '产品迭代', now
  )
  const iterationTasks = [
    { title: '版本规划', description: '确定版本目标和功能范围', status: 'todo', priority: 'high', labels: ['规划'], sortOrder: 0 },
    { title: '功能开发', description: '新功能开发与实现', status: 'todo', priority: 'high', labels: ['开发'], sortOrder: 1 },
    { title: '功能测试', description: '新功能测试和回归测试', status: 'todo', priority: 'high', labels: ['测试'], sortOrder: 2 },
    { title: '灰度发布', description: '灰度发布和监控', status: 'todo', priority: 'medium', labels: ['发布'], sortOrder: 3 },
    { title: '全量发布', description: '全量发布和公告', status: 'todo', priority: 'medium', labels: ['发布'], sortOrder: 4 },
  ]
  iterationTasks.forEach(task => {
    db.prepare(`INSERT INTO template_tasks (id, template_id, title, description, status, priority, labels, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id(), iterationTemplateId, task.title, task.description, task.status, task.priority, JSON.stringify(task.labels), task.sortOrder, now
    )
  })
  const iterationBudgets = [
    { category: 'labor', description: '人力成本' },
  ]
  iterationBudgets.forEach(budget => {
    db.prepare(`INSERT INTO template_budgets (id, template_id, category, description, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id(), iterationTemplateId, budget.category, budget.description, now
    )
  })
  const iterationColumns = [
    { statusKey: 'todo', label: '待办', color: '#94A3B8', sortOrder: 0 },
    { statusKey: 'in_progress', label: '进行中', color: '#F59E0B', sortOrder: 1 },
    { statusKey: 'review', label: '审核中', color: '#0EA5E9', sortOrder: 2 },
    { statusKey: 'done', label: '已完成', color: '#10B981', sortOrder: 3 },
  ]
  iterationColumns.forEach(col => {
    db.prepare(`INSERT INTO template_kanban_columns (id, template_id, status_key, label, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id(), iterationTemplateId, col.statusKey, col.label, col.color, col.sortOrder, now
    )
  })

  // 客户支持模板
  const supportTemplateId = id()
  db.prepare('INSERT INTO project_templates (id, name, description, category, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    supportTemplateId, '客户支持模板', '适用于客户支持和问题处理的模板', '运维项目', now
  )
  const supportTasks = [
    { title: '问题接收', description: '接收客户问题和需求', status: 'todo', priority: 'high', labels: ['支持'], sortOrder: 0 },
    { title: '问题分析', description: '分析问题原因和解决方案', status: 'todo', priority: 'high', labels: ['分析'], sortOrder: 1 },
    { title: '方案实施', description: '实施解决方案', status: 'todo', priority: 'medium', labels: ['实施'], sortOrder: 2 },
    { title: '客户反馈', description: '收集客户反馈和确认', status: 'todo', priority: 'medium', labels: ['反馈'], sortOrder: 3 },
    { title: '问题关闭', description: '问题解决并关闭', status: 'todo', priority: 'low', labels: ['关闭'], sortOrder: 4 },
  ]
  supportTasks.forEach(task => {
    db.prepare(`INSERT INTO template_tasks (id, template_id, title, description, status, priority, labels, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id(), supportTemplateId, task.title, task.description, task.status, task.priority, JSON.stringify(task.labels), task.sortOrder, now
    )
  })
  const supportColumns = [
    { statusKey: 'todo', label: '待处理', color: '#94A3B8', sortOrder: 0 },
    { statusKey: 'in_progress', label: '处理中', color: '#F59E0B', sortOrder: 1 },
    { statusKey: 'review', label: '待确认', color: '#0EA5E9', sortOrder: 2 },
    { statusKey: 'done', label: '已关闭', color: '#10B981', sortOrder: 3 },
  ]
  supportColumns.forEach(col => {
    db.prepare(`INSERT INTO template_kanban_columns (id, template_id, status_key, label, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id(), supportTemplateId, col.statusKey, col.label, col.color, col.sortOrder, now
    )
  })

  console.log('[db] 已初始化系统预设模板')
}

// 咨询服务模板（v1.8.8）：按名称幂等——存量库已有系统模板时 count 守卫会跳过 initSystemTemplates，这里单独补插
function initConsultingTemplate() {
  const exists = db.prepare('SELECT COUNT(*) as c FROM project_templates WHERE is_system = 1 AND name = ?').get('咨询服务模板') as { c: number }
  if (exists.c > 0) return

  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()

  const consultingTemplateId = id()
  db.prepare('INSERT INTO project_templates (id, name, description, category, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    consultingTemplateId, '咨询服务模板', '适用于咨询服务类项目的标准流程模板', '咨询项目', now
  )
  const consultingTasks = [
    { title: '需求调研与诊断', description: '访谈调研，梳理业务现状与痛点', status: 'todo', priority: 'high', labels: ['调研'], sortOrder: 0 },
    { title: '方案框架设计', description: '设计咨询方案框架与交付物清单', status: 'todo', priority: 'high', labels: ['设计'], sortOrder: 1 },
    { title: '方案评审与确认', description: '与客户评审方案并确认调整', status: 'todo', priority: 'high', labels: ['评审'], sortOrder: 2 },
    { title: '咨询交付实施', description: '输出报告与方案，辅导落地', status: 'todo', priority: 'medium', labels: ['交付'], sortOrder: 3 },
    { title: '成果汇报验收', description: '成果汇报与客户验收', status: 'todo', priority: 'medium', labels: ['验收'], sortOrder: 4 },
    { title: '复盘与知识沉淀', description: '项目复盘，沉淀方法论与经验', status: 'todo', priority: 'low', labels: ['复盘'], sortOrder: 5 },
  ]
  consultingTasks.forEach(task => {
    db.prepare(`INSERT INTO template_tasks (id, template_id, title, description, status, priority, labels, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id(), consultingTemplateId, task.title, task.description, task.status, task.priority, JSON.stringify(task.labels), task.sortOrder, now
    )
  })
  const consultingBudgets = [
    { category: 'labor', description: '人力成本' },
    { category: 'outsource', description: '外部专家' },
  ]
  consultingBudgets.forEach(budget => {
    db.prepare(`INSERT INTO template_budgets (id, template_id, category, description, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id(), consultingTemplateId, budget.category, budget.description, now
    )
  })
  const consultingColumns = [
    { statusKey: 'todo', label: '待办', color: '#94A3B8', sortOrder: 0 },
    { statusKey: 'in_progress', label: '进行中', color: '#F59E0B', sortOrder: 1 },
    { statusKey: 'review', label: '评审中', color: '#0EA5E9', sortOrder: 2 },
    { statusKey: 'done', label: '已完成', color: '#10B981', sortOrder: 3 },
  ]
  consultingColumns.forEach(col => {
    db.prepare(`INSERT INTO template_kanban_columns (id, template_id, status_key, label, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id(), consultingTemplateId, col.statusKey, col.label, col.color, col.sortOrder, now
    )
  })

  console.log('[db] 已补插系统模板: 咨询服务模板')
}

// 实施交付模板（v1.8.9）：按名称幂等——存量库已有系统模板时 count 守卫会跳过 initSystemTemplates，这里单独补插
function initImplementationTemplate() {
  const exists = db.prepare('SELECT COUNT(*) as c FROM project_templates WHERE is_system = 1 AND name = ?').get('实施交付模板') as { c: number }
  if (exists.c > 0) return

  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()

  const implTemplateId = id()
  db.prepare('INSERT INTO project_templates (id, name, description, category, is_system, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    implTemplateId, '实施交付模板', '适用于项目实施交付的标准流程模板', '实施项目', now
  )
  const implTasks = [
    { title: '进场准备', description: '组建实施团队，确认进场计划与物料清单', status: 'todo', priority: 'high', labels: ['准备'], sortOrder: 0 },
    { title: '环境部署', description: '搭建生产/测试环境，完成系统安装配置', status: 'todo', priority: 'high', labels: ['部署'], sortOrder: 1 },
    { title: '数据迁移', description: '历史数据清洗、导入与核对', status: 'todo', priority: 'high', labels: ['数据'], sortOrder: 2 },
    { title: '用户培训', description: '培训管理员与最终用户，输出操作手册', status: 'todo', priority: 'medium', labels: ['培训'], sortOrder: 3 },
    { title: '试运行', description: '试运行期伴随保障，问题收集与处理', status: 'todo', priority: 'medium', labels: ['试运行'], sortOrder: 4 },
    { title: '上线切换', description: '正式切换上线，制定回滚预案', status: 'todo', priority: 'high', labels: ['上线'], sortOrder: 5 },
    { title: '验收移交', description: '验收签字，文档移交与结项', status: 'todo', priority: 'medium', labels: ['验收'], sortOrder: 6 },
  ]
  implTasks.forEach(task => {
    db.prepare(`INSERT INTO template_tasks (id, template_id, title, description, status, priority, labels, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id(), implTemplateId, task.title, task.description, task.status, task.priority, JSON.stringify(task.labels), task.sortOrder, now
    )
  })
  const implBudgets = [
    { category: 'labor', description: '人力成本' },
    { category: 'hardware', description: '硬件设备' },
  ]
  implBudgets.forEach(budget => {
    db.prepare(`INSERT INTO template_budgets (id, template_id, category, description, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id(), implTemplateId, budget.category, budget.description, now
    )
  })
  const implColumns = [
    { statusKey: 'todo', label: '待办', color: '#94A3B8', sortOrder: 0 },
    { statusKey: 'in_progress', label: '进行中', color: '#F59E0B', sortOrder: 1 },
    { statusKey: 'review', label: '待验收', color: '#0EA5E9', sortOrder: 2 },
    { statusKey: 'done', label: '已完成', color: '#10B981', sortOrder: 3 },
  ]
  implColumns.forEach(col => {
    db.prepare(`INSERT INTO template_kanban_columns (id, template_id, status_key, label, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id(), implTemplateId, col.statusKey, col.label, col.color, col.sortOrder, now
    )
  })

  console.log('[db] 已补插系统模板: 实施交付模板')
}

try {
  initSystemTemplates()
} catch (e) {
  console.error('[initSystemTemplates] error:', e)
}

try {
  initConsultingTemplate()
} catch (e) {
  console.error('[initConsultingTemplate] error:', e)
}

try {
  initImplementationTemplate()
} catch (e) {
  console.error('[initImplementationTemplate] error:', e)
}

// 补齐存量库系统模板的分类（v1.8.6：系统模板在历史库中已存在，seed 守卫会跳过重插，这里按名称回填分类）
try {
  const systemCategoryMap: Record<string, string> = {
    '新规开发模板': '开发项目',
    '网站开发模板': '开发项目', // 兼容更名前的历史库名称
    '产品迭代模板': '产品迭代',
    '客户支持模板': '运维项目',
  }
  for (const [name, category] of Object.entries(systemCategoryMap)) {
    db.prepare(
      "UPDATE project_templates SET category = ? WHERE is_system = 1 AND name = ? AND (category IS NULL OR category = '')",
    ).run(category, name)
  }
} catch (e) {
  console.error('[db] 补齐系统模板分类失败:', e)
}

// 初始化权限定义
function initPermissions() {
  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()

  const permissions = [
    // 项目管理
    { key: 'project.view', name: '查看项目', category: '项目管理' },
    { key: 'project.create', name: '创建项目', category: '项目管理' },
    { key: 'project.edit', name: '编辑项目', category: '项目管理' },
    { key: 'project.delete', name: '删除项目', category: '项目管理' },
    { key: 'project.manage_members', name: '管理项目成员', category: '项目管理' },
    { key: 'project.manage_columns', name: '管理看板列', category: '项目管理' },
    { key: 'project.approve_delete', name: '审批项目删除申请', category: '项目管理' },

    // 任务管理
    { key: 'task.view', name: '查看任务', category: '任务管理' },
    { key: 'task.create', name: '创建任务', category: '任务管理' },
    { key: 'task.edit', name: '编辑任务', category: '任务管理' },
    { key: 'task.delete', name: '删除任务', category: '任务管理' },
    { key: 'task.assign', name: '指派任务', category: '任务管理' },
    { key: 'task.restore', name: '从回收站恢复任务', category: '任务管理' },
    { key: 'task.purge', name: '彻底删除任务', category: '任务管理' },

    // 预算管理
    { key: 'budget.view', name: '查看预算', category: '预算管理' },
    { key: 'budget.create', name: '创建预算', category: '预算管理' },
    { key: 'budget.approve', name: '审批预算', category: '预算管理' },
    { key: 'budget.edit', name: '编辑预算', category: '预算管理' },
    { key: 'budget.delete', name: '删除预算', category: '预算管理' },

    // 支出管理
    { key: 'expense.view', name: '查看支出', category: '支出管理' },
    { key: 'expense.create', name: '登记支出', category: '支出管理' },
    { key: 'expense.edit', name: '编辑支出', category: '支出管理' },
    { key: 'expense.delete', name: '删除支出', category: '支出管理' },

    // 工时管理
    { key: 'hours.view', name: '查看工时', category: '工时管理' },
    { key: 'hours.create', name: '登记工时', category: '工时管理' },
    { key: 'hours.view_all', name: '查看所有人工时', category: '工时管理' },

    // 成本管理
    { key: 'cost.view', name: '查看成本数据', category: '成本管理' },
    { key: 'cost.edit', name: '编辑成本设置', category: '成本管理' },

    // 团队管理
    { key: 'team.view', name: '查看团队成员', category: '团队管理' },
    { key: 'team.manage_role', name: '修改成员角色', category: '团队管理' },
    { key: 'team.create', name: '新建成员', category: '团队管理' },
    { key: 'team.edit_profile', name: '维护成员资料', category: '团队管理' },
    { key: 'team.reset_password', name: '重置成员密码', category: '团队管理' },

    // 系统管理
    { key: 'system.backup', name: '数据库备份/恢复', category: '系统管理' },
    { key: 'system.manage_roles', name: '管理自定义角色', category: '系统管理' },
    { key: 'system.audit', name: '查看审计日志', category: '系统管理' },
    { key: 'system.manage_templates', name: '管理项目模板', category: '系统管理' },
    { key: 'data.export', name: '导出项目数据', category: '系统管理' },

    // 运维台账
    { key: 'oplog.view', name: '查看运维台账', category: '运维台账' },
    { key: 'oplog.manage', name: '管理运维台账（新增/编辑/删除/导入导出）', category: '运维台账' },
  ]

  // 按 key 幂等插入：老库升级时只补缺失的权限点
  let added = 0
  permissions.forEach((perm) => {
    const exists = db.prepare('SELECT 1 AS ok FROM permissions WHERE key = ?').get(perm.key)
    if (exists) return
    db.prepare(
      'INSERT INTO permissions (id, key, name, category, description, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id(), perm.key, perm.name, perm.category, '', now)
    added++
  })

  if (added > 0) console.log(`[db] 权限定义已就绪（本次新增 ${added} 个权限点）`)
}

// 系统角色默认权限（key 列表，initSystemRoles 与存量库补齐共用）
const FINANCE_PERM_KEYS = [
  'project.view', 'project.approve_delete', 'task.view',
  'budget.view', 'budget.create', 'budget.edit', 'budget.delete', 'budget.approve',
  'expense.view', 'expense.create', 'expense.edit', 'expense.delete',
  'hours.view', 'hours.view_all',
  'cost.view', 'cost.edit',
  'team.view',
  'oplog.view',
]
const OWNER_PERM_KEYS = [
  'project.view', 'project.edit', 'project.manage_members', 'project.manage_columns',
  'task.view', 'task.create', 'task.edit', 'task.delete', 'task.assign', 'task.restore', 'task.purge',
  'budget.view',
  'expense.view',
  'hours.view', 'hours.create',
  'team.view',
  'data.export',
  // 台账列表对全员开放（侧边栏入口 + 项目详情页内嵌），详情/AI 端点同样校验 oplog.view，避免「看得到列表打不开详情」
  'oplog.view',
]
const MEMBER_PERM_KEYS = [
  'project.view',
  'task.view', 'task.create', 'task.edit',
  'hours.view', 'hours.create',
  'oplog.view',
]
const GUEST_PERM_KEYS = ['project.view', 'task.view', 'hours.view', 'oplog.view']

// 初始化系统角色
function initSystemRoles() {
  const roleCount = (db.prepare('SELECT COUNT(*) as c FROM custom_roles WHERE is_system = 1').get() as { c: number }).c
  if (roleCount > 0) return

  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()

  // 获取所有权限
  const allPerms = db.prepare('SELECT id, key FROM permissions').all() as { id: string; key: string }[]
  const permMap = new Map(allPerms.map((p) => [p.key, p.id]))

  // 创建管理员角色（拥有所有权限）
  const adminRoleId = id()
  db.prepare('INSERT INTO custom_roles (id, name, description, is_system, created_at) VALUES (?, ?, ?, 1, ?)').run(
    adminRoleId, '系统管理员', '拥有所有权限的系统管理员角色', now
  )
  allPerms.forEach((perm) => {
    db.prepare('INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)').run(
      id(), adminRoleId, perm.id, now
    )
  })

  // 创建项目核算角色（预算审批、支出查看、成本查看）
  const financeRoleId = id()
  db.prepare('INSERT INTO custom_roles (id, name, description, is_system, created_at) VALUES (?, ?, ?, 1, ?)').run(
    financeRoleId, '项目核算人员', '负责预算审批和成本管理', now
  )
  FINANCE_PERM_KEYS.forEach((key) => {
    const permId = permMap.get(key)
    if (permId) {
      db.prepare('INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)').run(
        id(), financeRoleId, permId, now
      )
    }
  })

  // 创建负责人角色（项目编辑、任务管理、成员管理）
  const ownerRoleId = id()
  db.prepare('INSERT INTO custom_roles (id, name, description, is_system, created_at) VALUES (?, ?, ?, 1, ?)').run(
    ownerRoleId, '项目负责人', '负责项目管理和任务分配', now
  )
  OWNER_PERM_KEYS.forEach((key) => {
    const permId = permMap.get(key)
    if (permId) {
      db.prepare('INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)').run(
        id(), ownerRoleId, permId, now
      )
    }
  })

  // 创建团队成员角色（基础权限）
  const memberRoleId = id()
  db.prepare('INSERT INTO custom_roles (id, name, description, is_system, created_at) VALUES (?, ?, ?, 1, ?)').run(
    memberRoleId, '团队成员', '普通团队成员基础权限', now
  )
  MEMBER_PERM_KEYS.forEach((key) => {
    const permId = permMap.get(key)
    if (permId) {
      db.prepare('INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)').run(
        id(), memberRoleId, permId, now
      )
    }
  })

  // 创建访客角色（只读权限）
  const guestRoleId = id()
  db.prepare('INSERT INTO custom_roles (id, name, description, is_system, created_at) VALUES (?, ?, ?, 1, ?)').run(
    guestRoleId, '访客', '只读访问权限', now
  )
  GUEST_PERM_KEYS.forEach((key) => {
    const permId = permMap.get(key)
    if (permId) {
      db.prepare('INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)').run(
        id(), guestRoleId, permId, now
      )
    }
  })

  console.log('[db] 已初始化系统角色')
}

// 兼容更名：存量库的系统角色/演示账号旧名「财务人员」统一更名为「项目核算人员」
function renameLegacyFinanceRole() {
  const renamedRole = db.prepare(
    "UPDATE custom_roles SET name = '项目核算人员' WHERE is_system = 1 AND name = '财务人员'"
  ).run()
  if (renamedRole.changes > 0) console.log('[db] 已将系统角色「财务人员」更名为「项目核算人员」')

  const renamedUser = db.prepare(
    "UPDATE users SET name = '项目核算人员' WHERE email = 'finance@pm.dev' AND name = '财务人员'"
  ).run()
  if (renamedUser.changes > 0) console.log('[db] 已将演示账号「财务人员」更名为「项目核算人员」')
}

// 存量库补齐：为系统角色追加缺失的默认权限（只增不删，保留管理员的自定义调整）
function ensureSystemRolePermissions() {
  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()
  const allPerms = db.prepare('SELECT id, key FROM permissions').all() as { id: string; key: string }[]
  const permMap = new Map(allPerms.map((p) => [p.key, p.id]))

  const roleDefaults: Array<{ names: string[]; keys: string[] | '*' }> = [
    { names: ['系统管理员'], keys: '*' },
    { names: ['项目核算人员', '财务人员'], keys: FINANCE_PERM_KEYS },
    { names: ['项目负责人'], keys: OWNER_PERM_KEYS },
    { names: ['团队成员'], keys: MEMBER_PERM_KEYS },
    { names: ['访客'], keys: GUEST_PERM_KEYS },
  ]

  let added = 0
  for (const { names, keys } of roleDefaults) {
    let role: { id: string } | undefined
    for (const name of names) {
      role = db.prepare('SELECT id FROM custom_roles WHERE is_system = 1 AND name = ?').get(name) as { id: string } | undefined
      if (role) break
    }
    if (!role) continue
    const targetKeys = keys === '*' ? allPerms.map((p) => p.key) : keys
    for (const key of targetKeys) {
      const permId = permMap.get(key)
      if (!permId) continue
      const exists = db.prepare('SELECT 1 AS ok FROM role_permissions WHERE role_id = ? AND permission_id = ?').get(role.id, permId)
      if (exists) continue
      db.prepare('INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES (?, ?, ?, ?)').run(
        id(), role.id, permId, now
      )
      added++
    }
  }
  if (added > 0) console.log(`[db] 已为系统角色补齐 ${added} 条默认权限`)
}

try {
  initPermissions()
  initSystemRoles()
  renameLegacyFinanceRole()
  ensureSystemRolePermissions()
} catch (e) {
  console.error('[initPermissions/initSystemRoles] error:', e)
}

// 添加 custom_role_id 字段到 users 表
try {
  const cols = (db.pragma('table_info(users)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('custom_role_id')) {
    db.exec('ALTER TABLE users ADD COLUMN custom_role_id TEXT')
    console.log('[db] 已添加 custom_role_id 字段到 users 表')
  }
} catch (e) {
  console.error('[db] 添加 custom_role_id 字段失败:', e)
}

// 添加 token_version 字段到 users 表（改密吊销旧 token）
try {
  const cols = (db.pragma('table_info(users)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
    console.log('[db] 已添加 token_version 字段到 users 表')
  }
} catch (e) {
  console.error('[db] 添加 token_version 字段失败:', e)
}

// 去掉 task_hours 表的 (task_id, user_id, date) 唯一约束（允许重复登记，累加处理）
// SQLite 不支持直接 DROP CONSTRAINT，需重建表
try {
  const indexes = db.pragma('index_list(task_hours)') as { name: string; unique: number; origin: string }[]
  const hasUnique = indexes.some((idx) => idx.unique && idx.origin === 'u')
  if (hasUnique) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE task_hours_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        date DATE NOT NULL,
        planned_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        actual_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        billed_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        description TEXT,
        rate_snapshot DECIMAL(10,2),
        rate_source TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO task_hours_new (id, task_id, user_id, date, planned_hours, actual_hours, billed_hours, description, rate_snapshot, rate_source, created_at)
        SELECT id, task_id, user_id, date, planned_hours, actual_hours, COALESCE(billed_hours, 0), description, rate_snapshot, rate_source, created_at FROM task_hours;
      DROP TABLE task_hours;
      ALTER TABLE task_hours_new RENAME TO task_hours;
      CREATE INDEX IF NOT EXISTS idx_hours_task ON task_hours(task_id);
      CREATE INDEX IF NOT EXISTS idx_hours_user ON task_hours(user_id);
      CREATE INDEX IF NOT EXISTS idx_hours_date ON task_hours(date);
      PRAGMA foreign_keys = ON;
    `)
    console.log('[db] 已重建 task_hours 表，移除唯一约束')
  }
} catch (e) {
  console.error('[db] 重建 task_hours 表失败:', e)
}

// 历史工时单价一次性冻结回填：按当前生效口径（个人价 > 类别价 > 角色默认价 owner=200/外包=125/成员=150）
// 为快照为空的工时补写单价与来源，此后改价只影响新登记工时（幂等：仅处理 rate_snapshot IS NULL 的行）
try {
  const backfilled = db.prepare(`
    UPDATE task_hours SET rate_snapshot = COALESCE(
      (SELECT u.hourly_rate FROM users u WHERE u.id = task_hours.user_id),
      (SELECT uc.hourly_rate FROM users u LEFT JOIN user_categories uc ON u.category_id = uc.id WHERE u.id = task_hours.user_id),
      (SELECT CASE WHEN pm.role = 'owner' THEN 200
                   WHEN COALESCE((SELECT u.is_outsourced FROM users u WHERE u.id = task_hours.user_id),
                                 (SELECT uc.is_outsourced FROM users u LEFT JOIN user_categories uc ON u.category_id = uc.id WHERE u.id = task_hours.user_id), 0) = 1
                   THEN 125 ELSE 150 END
       FROM tasks t
       LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = task_hours.user_id
       WHERE t.id = task_hours.task_id LIMIT 1),
      0)
    WHERE rate_snapshot IS NULL
  `).run()
  db.prepare(`
    UPDATE task_hours SET rate_source = CASE
      WHEN EXISTS(SELECT 1 FROM users u WHERE u.id = task_hours.user_id AND u.hourly_rate IS NOT NULL) THEN 'user'
      WHEN EXISTS(SELECT 1 FROM users u JOIN user_categories uc ON u.category_id = uc.id WHERE u.id = task_hours.user_id AND uc.hourly_rate IS NOT NULL) THEN 'category'
      WHEN EXISTS(SELECT 1 FROM tasks t JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = task_hours.user_id WHERE t.id = task_hours.task_id AND pm.role = 'owner') THEN 'role_owner'
      WHEN COALESCE((SELECT u.is_outsourced FROM users u WHERE u.id = task_hours.user_id),
                    (SELECT uc.is_outsourced FROM users u LEFT JOIN user_categories uc ON u.category_id = uc.id WHERE u.id = task_hours.user_id), 0) = 1 THEN 'role_outsourced'
      ELSE 'role_member' END
    WHERE rate_snapshot IS NOT NULL AND rate_source IS NULL
  `).run()
  if (backfilled.changes > 0) console.log(`[db] 已冻结回填 ${backfilled.changes} 条历史工时的单价快照`)
} catch (e) {
  console.error('[db] 历史工时单价回填失败:', e)
}

// 添加 deleted_at 字段到 projects 表（软删除）
try {
  const cols = (db.pragma('table_info(projects)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('deleted_at')) {
    db.exec('ALTER TABLE projects ADD COLUMN deleted_at DATETIME')
    console.log('[db] 已添加 deleted_at 字段到 projects 表')
  }
} catch (e) {
  console.error('[db] 添加 projects.deleted_at 字段失败:', e)
}

// 添加项目删除审批字段到 projects 表
try {
  const cols = (db.pragma('table_info(projects)') as { name: string }[]).map(c => c.name)
  let added = false
  if (!cols.includes('delete_requested_by')) {
    db.exec('ALTER TABLE projects ADD COLUMN delete_requested_by TEXT REFERENCES users(id)')
    db.exec('ALTER TABLE projects ADD COLUMN delete_requested_at DATETIME')
    added = true
  }
  if (!cols.includes('delete_reject_comment')) {
    db.exec('ALTER TABLE projects ADD COLUMN delete_reject_comment TEXT')
    added = true
  }
  if (added) console.log('[db] 已添加项目删除审批字段到 projects 表')
} catch (e) {
  console.error('[db] 添加项目删除审批字段失败:', e)
}

// 数据库维护：WAL checkpoint + 可选 VACUUM
export function checkpoint(mode: 'PASSIVE' | 'FULL' = 'PASSIVE') {
  try {
    db.pragma(`wal_checkpoint(${mode})`)
    return true
  } catch { return false }
}

export function vacuum() {
  try {
    db.exec('VACUUM')
    return true
  } catch { return false }
}

export function dbSizeInfo() {
  const page_size = (db.pragma('page_size') as { page_size: number }[])[0]?.page_size ?? 4096
  const page_count = (db.pragma('page_count') as { page_count: number }[])[0]?.page_count ?? 0
  const freelist = (db.pragma('freelist_count') as { freelist_count: number }[])[0]?.freelist_count ?? 0
  return { pageSize: page_size, pageCount: page_count, freelistPages: freelist, totalBytes: page_size * page_count, wastedBytes: page_size * freelist }
}

export default db