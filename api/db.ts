// 数据库连接与初始化

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import bcrypt from 'bcrypt'
import crypto from 'crypto'

// 以 cwd(项目根)为基准存放数据库,避开 tsx 临时目录问题
const DB_PATH = path.resolve(process.cwd(), 'data/app.db')

// 自动创建目录
const dbDir = path.dirname(DB_PATH)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#6366F1',
  role TEXT NOT NULL CHECK(role IN ('admin','owner','member','guest')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('planning','active','completed','archived')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  due_date DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
`)

// 种子数据:若无用户则插入演示账号
function seed() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  if (count.c > 0) return

  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4']
  const now = new Date().toISOString()
  const id = () => crypto.randomUUID()

  const users = [
    { name: '管理员', email: 'admin@pm.dev', role: 'admin', color: colors[0] },
    { name: '负责人', email: 'owner@pm.dev', role: 'owner', color: colors[1] },
    { name: '成员甲', email: 'member1@pm.dev', role: 'member', color: colors[2] },
    { name: '成员乙', email: 'member2@pm.dev', role: 'member', color: colors[3] },
    { name: '访客', email: 'guest@pm.dev', role: 'guest', color: colors[4] },
  ]
  const pwd = bcrypt.hashSync('123456', 10)

  const insertUser = db.prepare(
    'INSERT INTO users (id, email, password_hash, name, avatar_color, role, created_at) VALUES (?,?,?,?,?,?,?)',
  )
  const userIds = users.map((u) => {
    const uid = id()
    insertUser.run(uid, u.email, pwd, u.name, u.color, u.role, now)
    return uid
  })

  // 项目
  const projectDefs = [
    { name: 'Atlas 后台重构', desc: '将旧版后台迁移至新架构,提升可维护性与性能。', status: 'active', due: new Date(Date.now() + 14 * 86400000).toISOString() },
    { name: '星河 App 2.0', desc: '移动端核心体验升级,包含新首页与个人中心。', status: 'planning', due: new Date(Date.now() + 45 * 86400000).toISOString() },
    { name: '数据可视化平台', desc: '构建可配置的看板与报表系统。', status: 'active', due: new Date(Date.now() + 30 * 86400000).toISOString() },
    { name: '官网改版', desc: '已完成上线,归档备查。', status: 'completed', due: new Date(Date.now() - 10 * 86400000).toISOString() },
  ]
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, description, status, owner_id, progress, due_date, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
  const insertMember = db.prepare(
    'INSERT INTO project_members (id, project_id, user_id, role, joined_at) VALUES (?,?,?,?,?)',
  )

  const projectIds = projectDefs.map((p, idx) => {
    const pid = id()
    const ownerId = userIds[1] // owner 账号
    const progress = p.status === 'completed' ? 100 : [35, 10, 55, 100][idx]
    insertProject.run(pid, p.name, p.desc, p.status, ownerId, progress, p.due, now)
    insertMember.run(id(), pid, ownerId, 'owner', now)
    // 加入其他成员
    insertMember.run(id(), pid, userIds[2], 'editor', now)
    insertMember.run(id(), pid, userIds[3], 'editor', now)
    return pid
  })

  // 任务
  const taskDefs = [
    { title: '设计新版导航交互', status: 'done', priority: 'high', assignee: 2, labels: ['设计', 'UX'], due: -2 },
    { title: '搭建项目脚手架', status: 'done', priority: 'urgent', assignee: 3, labels: ['工程'], due: -1 },
    { title: '实现鉴权模块', status: 'in_progress', priority: 'high', assignee: 3, labels: ['后端', '安全'], due: 3 },
    { title: '看板拖拽组件开发', status: 'in_progress', priority: 'high', assignee: 2, labels: ['前端'], due: 5 },
    { title: '统计图表接入', status: 'review', priority: 'medium', assignee: 2, labels: ['前端', '图表'], due: 2 },
    { title: '编写用户接口文档', status: 'todo', priority: 'low', assignee: 3, labels: ['文档'], due: 7 },
    { title: '优化首屏加载性能', status: 'todo', priority: 'medium', assignee: 2, labels: ['性能'], due: 9 },
    { title: '移动端适配自测', status: 'todo', priority: 'medium', assignee: 3, labels: ['测试', '移动端'], due: 12 },
  ]
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, labels, due_date, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const statuses = ['todo', 'in_progress', 'review', 'done'] as const
  const priorities = ['low', 'medium', 'high', 'urgent'] as const

  projectIds.forEach((pid, pi) => {
    taskDefs.forEach((t, ti) => {
      const offset = (pi * 2 + ti) * 86400000
      const created = new Date(Date.now() - offset).toISOString()
      const due = new Date(Date.now() + t.due * 86400000).toISOString()
      insertTask.run(
        id(),
        pid,
        t.title,
        `针对「${projectDefs[pi].name}」中该任务的详细说明。`,
        t.status,
        t.priority,
        userIds[t.assignee],
        JSON.stringify(t.labels),
        due,
        created,
        created,
      )
    })
  })

  // 额外补充一些任务让看板更丰富
  for (let i = 0; i < 6; i++) {
    const pid = projectIds[i % projectIds.length]
    insertTask.run(
      id(),
      pid,
      `补充任务 #${i + 1}`,
      '用于演示看板与统计的填充任务。',
      statuses[i % statuses.length],
      priorities[i % priorities.length],
      userIds[(i % 3) + 2],
      JSON.stringify(['演示']),
      new Date(Date.now() + (i + 3) * 86400000).toISOString(),
      new Date(Date.now() - i * 3600000).toISOString(),
      new Date(Date.now() - i * 3600000).toISOString(),
    )
  }

  // 评论
  const insertComment = db.prepare(
    'INSERT INTO comments (id, task_id, user_id, content, created_at) VALUES (?,?,?,?,?)',
  )
  const tasks = db.prepare('SELECT id FROM tasks LIMIT 5').all() as { id: string }[]
  tasks.forEach((tk, idx) => {
    insertComment.run(id(), tk.id, userIds[2], '这块我看了一下,需求上还需要再确认优先级。', new Date(Date.now() - idx * 3600000).toISOString())
    insertComment.run(id(), tk.id, userIds[1], '已确认,按当前优先级推进即可。', new Date(Date.now() - idx * 3600000 + 1800000).toISOString())
  })
}

try {
  seed()
} catch (e) {
  console.error('[seed] error:', e)
}

export default db