/**
 * 跨模块端到端集成测试（真实 HTTP 服务 + 临时 SQLite 库）
 *
 * 复现 2026-09-22 模块结合集成测试链路：认证 → 项目 → 任务 → 工时 → 台账 →
 * 台账权限(oplog.view) → 搜索 → 统计 → 回收站。
 *
 * 机制：
 *  - 子进程启动 api/server.ts（tsx），注入 FORTUNE_DB_PATH=临时目录/e2e.db 与随机端口，
 *    生产数据库零接触；SMTP 置空强制跳过邮件外发。
 *  - 结束后终止子进程并清理临时目录。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawn, execFileSync, type ChildProcess } from 'child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

const PORT = 21000 + Math.floor(Math.random() * 20000)
const BASE = `http://localhost:${PORT}/api`

let server: ChildProcess | null = null
let tmpDir = ''

/**
 * 防残留守护（上一轮清扫）：
 *  1. 强杀上一轮因测试中断（如 Ctrl+C/SIGKILL）遗留的守护包装器进程，
 *     包装器已按孤儿检测自行终止其服务子进程；本轮启动前再兜底清一次
 *  2. 清扫极端情况（包装器自身被强杀）遗留的孤儿服务进程——
 *     仅杀 ppid=1 且 FORTUNE_DB_PATH 指向 fortune-e2e-* 临时库的进程，绝不误伤生产服务
 *  3. 清理超过 1 小时的陈旧临时库目录（保留可能仍在运行的并发实例）
 */
function readProcessEnv(pid: string): string {
  try {
    return execFileSync('ps', ['-wwE', '-p', pid], { encoding: 'utf8' })
  } catch {
    // macOS ps -E 失败时尝试 Linux /proc
  }
  try {
    return fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
  } catch {
    return ''
  }
}

function sweepOrphanServers() {
  let out = ''
  try {
    out = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  } catch {
    return
  }
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    const [, pid, ppid, cmd] = m
    if (ppid !== '1' || !cmd.includes('api/server.ts')) continue
    const env = readProcessEnv(pid)
    if (env.includes('FORTUNE_DB_PATH') && env.includes('fortune-e2e-')) {
      try {
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        // 已退出，忽略
      }
    }
  }
}

function sweepStaleRunners() {
  try {
    // execFileSync 直调（不经 shell），避免 pkill -f 模式串出现在 sh -c 命令行中被自身匹配
    execFileSync('pkill', ['-KILL', '-f', 'e2e/server-guard[.]mjs'], { stdio: 'ignore' })
  } catch {
    // 无匹配进程时 pkill 返回非零，属正常
  }
  sweepOrphanServers()
  const tmpRoot = os.tmpdir()
  for (const d of fs.readdirSync(tmpRoot)) {
    if (!d.startsWith('fortune-e2e-')) continue
    const full = path.join(tmpRoot, d)
    try {
      if (Date.now() - fs.statSync(full).mtimeMs > 60 * 60 * 1000) {
        fs.rmSync(full, { recursive: true, force: true })
      }
    } catch {
      // 目录可能已被并发实例使用或移除，忽略
    }
  }
}

async function waitForHealth(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      // 服务未就绪，继续等待
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`服务在 ${timeoutMs}ms 内未就绪`)
}

async function req(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

beforeAll(async () => {
  sweepStaleRunners()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fortune-e2e-'))
  // 经 server-guard.mjs 包装器启动：父进程死亡/Ctrl+C/强杀时服务自动终止，不留孤儿进程
  server = spawn(process.execPath, [path.join(PROJECT_ROOT, 'tests/e2e/server-guard.mjs')], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      FORTUNE_DB_PATH: path.join(tmpDir, 'e2e.db'),
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`))
  server.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`))
  await waitForHealth()
}, 90_000)

afterAll(async () => {
  if (server) {
    // 对包装器发 SIGTERM，由其转发为对服务的 SIGKILL（直接 SIGKILL 包装器会绕过转发逻辑）
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        server?.kill('SIGKILL')
        resolve()
      }, 3000)
      server?.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('跨模块端到端集成（临时库 + 真实服务）', () => {
  // 新装库启动时 seed 预置演示用户（admin = leigang@creat-value.com / 12345）与演示项目
  const member = { email: `e2e-member-${Date.now()}@pm.dev`, password: 'e2e-pass-123', name: 'E2E成员' }
  let adminToken = ''
  let memberToken = ''
  let memberId = ''
  let projectId = ''
  let taskId = ''
  let opLogId = ''
  let consultProjectId = ''
  let sourceMergeId = ''
  const movedLogIds: string[] = []
  let adminId = ''
  let tempEmail = ''
  let tempUserId = ''
  let tempProjectId = ''

  it('种子管理员登录 → token + /auth/me 回读 admin 身份', async () => {
    const r = await req('POST', '/auth/login', { email: 'leigang@creat-value.com', password: '12345' })
    expect(r.status).toBe(200)
    adminToken = (r.json as { token: string }).token
    const me = await req('GET', '/auth/me', undefined, adminToken)
    expect(me.status).toBe(200)
    expect((me.json.user as { role: string }).role).toBe('admin')
    adminId = (me.json.user as { id: string }).id
  })

  it('注册新用户 → 普通成员（全新库下 register 不再授予 admin）', async () => {
    const r2 = await req('POST', '/auth/register', member)
    expect(r2.status).toBe(201)
    expect((r2.json.user as { role: string }).role).toBe('member')
    memberToken = (r2.json as { token: string }).token
    memberId = (r2.json.user as { id: string }).id
  })

  it('新建项目缺 projectType → 400（类型硬校验）', async () => {
    const r = await req('POST', '/projects', { name: 'E2E无类型项目' }, adminToken)
    expect(r.status).toBe(400)
  })

  it('合法类型创建项目 → 201，回读类型正确', async () => {
    const r = await req('POST', '/projects', {
      name: 'E2E集成项目',
      projectType: '运维项目',
      status: 'active',
      startDate: '2026-09-01',
      dueDate: '2026-12-31',
    }, adminToken)
    expect(r.status).toBe(201)
    const p = r.json.project as { id: string; projectType: string }
    projectId = p.id
    expect(p.projectType).toBe('运维项目')
  })

  it('项目列表回带负责人姓名与头像色（ownerName/ownerAvatar）', async () => {
    const r = await req('GET', '/projects', undefined, adminToken)
    expect(r.status).toBe(200)
    const list = r.json.projects as Array<{ id: string; ownerName?: string; ownerAvatar?: string }>
    const target = list.find((x) => x.id === projectId)
    expect(target?.ownerName).toBeTruthy()
    expect(target?.ownerAvatar).toBeTruthy()
  })

  it('添加成员到项目 → 200', async () => {
    const r = await req('POST', `/projects/${projectId}/members`, { userId: memberId, role: 'editor' }, adminToken)
    expect(r.status).toBe(200)
  })

  it('创建任务（指派成员，含计划工时）→ 201', async () => {
    const r = await req('POST', `/projects/${projectId}/tasks`, {
      title: 'E2E修复磁盘告警',
      status: 'in_progress',
      priority: 'high',
      assigneeId: memberId,
      plannedHours: 8,
    }, adminToken)
    expect(r.status).toBe(201)
    taskId = (r.json.task as { id: string }).id
  })

  it('登记工时 → 201，回读计划/实际工时正确', async () => {
    const r = await req('POST', `/tasks/${taskId}/hours`, {
      date: '2026-09-23',
      plannedHours: 8,
      actualHours: 5,
      billedHours: 0,
      description: 'E2E 工时登记',
    }, memberToken)
    expect(r.status).toBe(201)
    const list = await req('GET', `/tasks/${taskId}/hours`, undefined, memberToken)
    expect(list.status).toBe(200)
    const hours = list.json.hours as Array<{ actualHours: number; plannedHours: number }>
    expect(hours.length).toBe(1)
    expect(hours[0].actualHours).toBe(5)
    expect(hours[0].plannedHours).toBe(8)
  })

  it('成员登记台账（关联项目 + 已完成经验三字段）→ 201', async () => {
    const r = await req('POST', '/op-logs', {
      projectId,
      category: '故障处理',
      status: '已完成',
      system: 'E2E系统',
      logDate: '2026-09-23',
      problem: 'E2E磁盘空间不足',
      detail: '清理日志并扩容',
      cause: '日志未轮转',
      solution: '配置logrotate',
      hours: 1.5,
      completionDate: '2026-09-23',
    }, memberToken)
    expect(r.status).toBe(201)
    opLogId = (r.json.log as { id: string }).id
  })

  it('台账列表作用域：成员可见 1 条，台账详情 oplog.view 放行 → 200', async () => {
    const list = await req('GET', `/op-logs?projectId=${projectId}`, undefined, memberToken)
    expect(list.status).toBe(200)
    const logs = list.json.logs as Array<{ id: string }>
    expect(logs.map((l) => l.id)).toContain(opLogId)

    // v1.9.1 权限口径统一回归：member 已在权限矩阵补授 oplog.view，详情不再「看得到列表打不开详情」
    const detail = await req('GET', `/op-logs/${opLogId}`, undefined, memberToken)
    expect(detail.status).toBe(200)
    expect((detail.json.log as { problem: string }).problem).toBe('E2E磁盘空间不足')
  })

  it('台账统计端点可用且含数据', async () => {
    const r = await req('GET', `/op-logs/stats?projectId=${projectId}`, undefined, memberToken)
    expect(r.status).toBe(200)
    const stats = r.json.stats as Array<{ count: number }>
    expect(stats.reduce((s, x) => s + x.count, 0)).toBeGreaterThanOrEqual(1)
  })

  it('全局搜索命中任务与项目', async () => {
    const r = await req('GET', '/search?q=磁盘告警', undefined, memberToken)
    expect(r.status).toBe(200)
    const tasks = r.json.tasks as Array<{ id: string }>
    expect(tasks.map((t) => t.id)).toContain(taskId)
  })

  it('成员统计作用域：仅见参与项目与任务', async () => {
    const r = await req('GET', '/stats/overview', undefined, memberToken)
    expect(r.status).toBe(200)
    const ov = r.json as { totalProjects: number; tasksByStatus: Record<string, number> }
    expect(ov.totalProjects).toBe(1)
    expect(Object.values(ov.tasksByStatus).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('软删任务 → 回收站可见 → 恢复 → 回读存在', async () => {
    const del = await req('DELETE', `/tasks/${taskId}`, undefined, adminToken)
    expect(del.status).toBe(200)

    const trash = await req('GET', '/trash', undefined, adminToken)
    expect(trash.status).toBe(200)
    const trashTasks = trash.json.tasks as Array<{ id: string }>
    expect(trashTasks.map((t) => t.id)).toContain(taskId)

    const restore = await req('POST', `/tasks/${taskId}/restore`, undefined, adminToken)
    expect(restore.status).toBe(200)
    const back = await req('GET', `/tasks/${taskId}`, undefined, adminToken)
    expect(back.status).toBe(200)
    expect((back.json.task as { deletedAt: string | null }).deletedAt ?? null).toBeNull()
  })

  // ===== v1.8.5 ~ v1.9.1 功能联动回归（模板 / 类型 / 结项合并）=====

  it('非法 projectType → 400（六类白名单硬校验）', async () => {
    const r = await req('POST', '/projects', { name: 'E2E非法类型项目', projectType: '不存在的类型' }, adminToken)
    expect(r.status).toBe(400)
  })

  it('系统模板种子齐全（5 个）且分类与规模正确', async () => {
    const r = await req('GET', '/templates/project-templates', undefined, adminToken)
    expect(r.status).toBe(200)
    const templates = r.json.templates as Array<{
      name: string; category: string | null; isSystem: boolean
      taskCount: number; budgetCount: number; kanbanColumnCount: number
    }>
    const sys = templates.filter((t) => t.isSystem)
    expect(sys.map((t) => t.name).sort()).toEqual(
      ['产品迭代模板', '客户支持模板', '实施交付模板', '咨询服务模板', '网站开发模板'].sort(),
    )
    const byName = Object.fromEntries(sys.map((t) => [t.name, t]))
    // 模板分类与项目类型白名单同源（v1.8.6 归一化）
    expect(byName['网站开发模板'].category).toBe('开发项目')
    expect(byName['产品迭代模板'].category).toBe('产品迭代')
    expect(byName['客户支持模板'].category).toBe('运维项目')
    expect(byName['咨询服务模板'].category).toBe('咨询项目')
    expect(byName['实施交付模板'].category).toBe('实施项目')
    // 模板规模：咨询 6 任务/2 预算/4 看板列；实施 7 任务/2 预算/4 看板列
    expect(byName['咨询服务模板'].taskCount).toBe(6)
    expect(byName['咨询服务模板'].budgetCount).toBe(2)
    expect(byName['咨询服务模板'].kanbanColumnCount).toBe(4)
    expect(byName['实施交付模板'].taskCount).toBe(7)
    expect(byName['实施交付模板'].budgetCount).toBe(2)
    expect(byName['实施交付模板'].kanbanColumnCount).toBe(4)
  })

  it('用系统模板建项目 → 模板任务整体复制到项目（模板×任务联动）', async () => {
    const list = await req('GET', '/templates/project-templates', undefined, adminToken)
    const templates = list.json.templates as Array<{ id: string; name: string }>
    const tpl = templates.find((t) => t.name === '咨询服务模板')!
    const created = await req('POST', '/projects', {
      name: 'E2E咨询项目',
      projectType: '咨询项目',
      templateId: tpl.id,
    }, adminToken)
    expect(created.status).toBe(201)
    consultProjectId = (created.json.project as { id: string }).id
    const tasksRes = await req('GET', `/projects/${consultProjectId}/tasks`, undefined, adminToken)
    expect(tasksRes.status).toBe(200)
    const tasks = tasksRes.json.tasks as Array<{ title: string }>
    expect(tasks.length).toBe(6)
    expect(tasks.map((t) => t.title)).toContain('需求调研与诊断')
  })

  it('非法模板分类 → 400（分类归一化守卫）', async () => {
    const r = await req('POST', '/templates/project-templates', { name: 'E2E非法分类模板', category: '胡乱分类' }, adminToken)
    expect(r.status).toBe(400)
  })

  it('项目保存为模板 → 分类按项目类型自动推导（项目×模板反向联动）', async () => {
    const r = await req('POST', `/templates/projects/${projectId}/save-as-template`, { templateName: 'E2E保存的运维模板' }, adminToken)
    expect(r.status).toBe(201)
    const template = r.json.template as { category: string | null; tasks: unknown[] }
    expect(template.category).toBe('运维项目')
    // projectId 含 1 个任务（已从回收站恢复），应复制进模板
    expect(template.tasks.length).toBe(1)
  })

  it('建「运维增强」项目并登记 2 条台账（结项合并准备）', async () => {
    const created = await req('POST', '/projects', { name: 'E2E待合并增强项目', projectType: '运维增强', status: 'active' }, adminToken)
    expect(created.status).toBe(201)
    sourceMergeId = (created.json.project as { id: string }).id
    for (const i of [1, 2]) {
      const r = await req('POST', '/op-logs', {
        projectId: sourceMergeId,
        category: '故障处理',
        status: '已完成',
        system: 'E2E系统',
        logDate: '2026-09-23',
        problem: `E2E合并前问题${i}`,
        detail: '定位与处理',
        cause: '根因',
        solution: '处置方案',
        hours: 1,
        completionDate: '2026-09-23',
      }, adminToken)
      expect(r.status).toBe(201)
      movedLogIds.push((r.json.log as { id: string }).id)
    }
  })

  it('结项合并守卫矩阵：越权 403 / 源类型不符 400 / 目标类型不符 400 / 自合并 400', async () => {
    // 成员非 owner：无权发起合并
    const forbidden = await req('POST', `/projects/${sourceMergeId}/merge`, { targetProjectId: projectId }, memberToken)
    expect(forbidden.status).toBe(403)
    // 源项目不是「运维增强」类型
    const wrongSource = await req('POST', `/projects/${projectId}/merge`, { targetProjectId: sourceMergeId }, adminToken)
    expect(wrongSource.status).toBe(400)
    // 目标项目不是「运维项目」类型（咨询项目）
    const wrongTarget = await req('POST', `/projects/${sourceMergeId}/merge`, { targetProjectId: consultProjectId }, adminToken)
    expect(wrongTarget.status).toBe(400)
    // 合并到项目自身
    const selfMerge = await req('POST', `/projects/${sourceMergeId}/merge`, { targetProjectId: sourceMergeId }, adminToken)
    expect(selfMerge.status).toBe(400)
  })

  it('执行结项合并 → 台账整体转绑到目标运维项目（合并×台账联动）', async () => {
    const r = await req('POST', `/projects/${sourceMergeId}/merge`, { targetProjectId: projectId }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.movedOpLogs).toBe(2)
    const source = r.json.project as { mergedIntoProjectId: string | null }
    expect(source.mergedIntoProjectId).toBe(projectId)

    // 目标项目可见 2 条转绑台账，源项目台账清零
    const targetList = await req('GET', `/op-logs?projectId=${projectId}`, undefined, adminToken)
    expect(targetList.status).toBe(200)
    const targetIds = (targetList.json.logs as Array<{ id: string }>).map((l) => l.id)
    for (const id of movedLogIds) expect(targetIds).toContain(id)

    const sourceList = await req('GET', `/op-logs?projectId=${sourceMergeId}`, undefined, adminToken)
    expect(sourceList.status).toBe(200)
    expect((sourceList.json.logs as unknown[]).length).toBe(0)
  })

  it('重复合并同一项目 → 400（合并守卫幂等）', async () => {
    const r = await req('POST', `/projects/${sourceMergeId}/merge`, { targetProjectId: projectId }, adminToken)
    expect(r.status).toBe(400)
  })

  // ===== 用户管理：删除成员与关联清理 =====

  it('管理员新建成员 → 成员登录并创建自己的项目', async () => {
    tempEmail = `e2e-del-${Date.now()}@pm.dev`
    const created = await req('POST', '/team', { email: tempEmail, password: 'del-pass-123', name: 'E2E待删成员', role: 'member' }, adminToken)
    expect(created.status).toBe(201)
    tempUserId = (created.json.user as { id: string }).id
    const login = await req('POST', '/auth/login', { email: tempEmail, password: 'del-pass-123' })
    expect(login.status).toBe(200)
    const token = (login.json as { token: string }).token
    const proj = await req('POST', '/projects', { name: 'E2E待删成员的项目', projectType: '开发项目' }, token)
    expect(proj.status).toBe(201)
    tempProjectId = (proj.json.project as { id: string }).id
  })

  it('删除守卫：删自己 400 / 非管理员 403 / 管理员账号不可删', async () => {
    const selfDel = await req('DELETE', `/team/${adminId}`, undefined, adminToken)
    expect(selfDel.status).toBe(400)
    const forbidden = await req('DELETE', `/team/${adminId}`, undefined, memberToken)
    expect(forbidden.status).toBe(403)
    const admin2 = await req('POST', '/team', { email: `e2e-admin2-${Date.now()}@pm.dev`, password: 'del-pass-123', name: 'E2E管理员', role: 'admin' }, adminToken)
    expect(admin2.status).toBe(201)
    const delAdmin = await req('DELETE', `/team/${(admin2.json.user as { id: string }).id}`, undefined, adminToken)
    expect(delAdmin.status).toBe(400)
  })

  it('执行删除 → 项目负责人转移给管理员、账号无法登录、列表移除', async () => {
    const del = await req('DELETE', `/team/${tempUserId}`, undefined, adminToken)
    expect(del.status).toBe(200)
    expect(del.json.transferredProjects).toBe(1)
    const login = await req('POST', '/auth/login', { email: tempEmail, password: 'del-pass-123' })
    expect(login.status).toBe(401)
    const proj = await req('GET', `/projects/${tempProjectId}`, undefined, adminToken)
    expect(proj.status).toBe(200)
    expect((proj.json.project as { ownerId: string }).ownerId).toBe(adminId)
    const team = await req('GET', '/team', undefined, adminToken)
    expect(team.status).toBe(200)
    expect((team.json.users as Array<{ id: string }>).map((u) => u.id)).not.toContain(tempUserId)
  })

  it('角色分配：admin 将成员改为项目核算人员，成员视角确认生效', async () => {
    const email = `e2e-role-${Date.now()}@pm.dev`
    const created = await req('POST', '/team', { email, password: 'role-pass-123', name: 'E2E角色成员', role: 'member' }, adminToken)
    expect(created.status).toBe(201)
    const uid = (created.json.user as { id: string }).id

    const upd = await req('PATCH', `/team/${uid}/role`, { role: 'finance' }, adminToken)
    expect(upd.status).toBe(200)
    expect((upd.json.user as { role: string }).role).toBe('finance')

    const login = await req('POST', '/auth/login', { email, password: 'role-pass-123' })
    expect(login.status).toBe(200)
    const me = await req('GET', '/auth/me', undefined, (login.json as { token: string }).token)
    expect((me.json.user as { role: string }).role).toBe('finance')

    const back = await req('PATCH', `/team/${uid}/role`, { role: 'owner' }, adminToken)
    expect(back.status).toBe(200)
    expect((back.json.user as { role: string }).role).toBe('owner')
  })

  it('指派项目负责人：admin 指派 → 新负责人全权限、原负责人降级、守卫齐全', async () => {
    // 成员建项目（owner=memberId）
    const created = await req('POST', '/projects', { name: `指派测试${Date.now()}`, projectType: '开发项目' }, memberToken)
    expect(created.status).toBe(201)
    const pid = (created.json.project as { id: string }).id

    // 非管理员无权指派
    const forbidden = await req('PATCH', `/projects/${pid}/owner`, { userId: adminId }, memberToken)
    expect(forbidden.status).toBe(403)

    // admin 指派自己为新负责人
    const upd = await req('PATCH', `/projects/${pid}/owner`, { userId: adminId }, adminToken)
    expect(upd.status).toBe(200)
    expect((upd.json.project as { ownerId: string }).ownerId).toBe(adminId)

    // 原负责人失去管理权（改名 403）
    const oldOwnerPatch = await req('PATCH', `/projects/${pid}`, { name: '不应成功' }, memberToken)
    expect(oldOwnerPatch.status).toBe(403)

    // 新负责人拥有全部权限（改名成功）
    const newOwnerPatch = await req('PATCH', `/projects/${pid}`, { name: `已易主${Date.now()}` }, adminToken)
    expect(newOwnerPatch.status).toBe(200)

    // 已是负责人再指派 → 400
    const dup = await req('PATCH', `/projects/${pid}/owner`, { userId: adminId }, adminToken)
    expect(dup.status).toBe(400)

    await req('DELETE', `/projects/${pid}`, undefined, adminToken)
  })

  it('人员替换：一键把成员的项目任务转给另一成员，计数与守卫齐全', async () => {
    // 成员建项目 + 1 指派任务 + 1 指派子任务
    const proj = await req('POST', '/projects', { name: `替换测试${Date.now()}`, projectType: '开发项目' }, memberToken)
    expect(proj.status).toBe(201)
    const pid = (proj.json.project as { id: string }).id
    const task = await req('POST', `/projects/${pid}/tasks`, { title: '被替换的任务', assigneeId: memberId }, memberToken)
    expect(task.status).toBe(201)
    const tid = (task.json.task as { id: string }).id
    const sub = await req('POST', `/tasks/${tid}/subtasks`, { title: '被替换的子任务', assigneeId: memberId }, memberToken)
    expect(sub.status).toBe(201)

    // 守卫：from = to 400
    const same = await req('POST', `/projects/${pid}/reassign`, { fromUserId: memberId, toUserId: memberId }, adminToken)
    expect(same.status).toBe(400)
    // 守卫：目标为访客 400
    const team = await req('GET', '/team', undefined, adminToken)
    const guestId = (team.json.users as Array<{ id: string; role: string }>).find((u) => u.role === 'guest')?.id
    if (guestId) {
      const toGuest = await req('POST', `/projects/${pid}/reassign`, { fromUserId: memberId, toUserId: guestId }, adminToken)
      expect(toGuest.status).toBe(400)
    }

    // 执行替换：member → admin
    const r = await req('POST', `/projects/${pid}/reassign`, { fromUserId: memberId, toUserId: adminId }, adminToken)
    expect(r.status).toBe(200)
    expect((r.json as { replacedTasks: number }).replacedTasks).toBe(1)
    expect((r.json as { replacedSubtasks: number }).replacedSubtasks).toBe(1)

    // 验证任务与子任务指派已变更
    const detail = await req('GET', `/tasks/${tid}`, undefined, adminToken)
    expect((detail.json.task as { assigneeId: string | null }).assigneeId).toBe(adminId)
    const subtasks = detail.json.subtasks as Array<{ assigneeId: string | null }>
    expect(subtasks[0].assigneeId).toBe(adminId)

    // 项目操作日志：一条汇总留痕
    const acts = await req('GET', `/projects/${pid}/activities`, undefined, adminToken)
    expect(acts.status).toBe(200)
    const actRows = acts.json.rows as Array<{ action: string; detail: string }>
    expect(actRows).toHaveLength(1)
    expect(actRows[0].action).toBe('reassign')
    expect(actRows[0].detail).toContain('人员替换')
    expect(actRows[0].detail).toContain('1 个任务')

    // 守卫：既非负责人又非 admin 的用户 403（新建一个旁观成员验证）
    const bystanderEmail = `e2e-bystander-${Date.now()}@pm.dev`
    await req('POST', '/team', { email: bystanderEmail, password: 'by-pass-123', name: 'E2E旁观成员', role: 'member' }, adminToken)
    const byLogin = await req('POST', '/auth/login', { email: bystanderEmail, password: 'by-pass-123' })
    const byToken = (byLogin.json as { token: string }).token
    const forbidden = await req('POST', `/projects/${pid}/reassign`, { fromUserId: memberId, toUserId: adminId }, byToken)
    expect(forbidden.status).toBe(403)

    await req('DELETE', `/projects/${pid}`, undefined, adminToken)
  })

  it('角色分配守卫：非管理员 403 / 非法角色 400', async () => {
    const forbidden = await req('PATCH', `/team/${memberId}/role`, { role: 'admin' }, memberToken)
    expect(forbidden.status).toBe(403)
    const badRole = await req('PATCH', `/team/${memberId}/role`, { role: 'superadmin' }, adminToken)
    expect(badRole.status).toBe(400)
  })
})
