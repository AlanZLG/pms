import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser, seedProject, seedTask, seedMessage } from './helpers/test-db'
import { messageRepo, notificationRepo, userRepo, taskRepo, projectRepo } from '../api/repository/repo.ts'
import { computeProjectHealth } from '../api/routes/stats.ts'

// 会话上下文键（与 messageRepo.threads 一致）：任务 > 项目 > 直聊
describe('站内消息 messageRepo', () => {
  let alice: string
  let bob: string
  let carol: string
  let pid: string
  let tid: string

  beforeEach(() => {
    db.exec('DELETE FROM messages; DELETE FROM notifications; DELETE FROM tasks; DELETE FROM projects; DELETE FROM users;')
    alice = seedUser(db, { email: 'alice@pm.dev', name: '爱丽丝' })
    bob = seedUser(db, { email: 'bob@pm.dev', name: '鲍勃' })
    carol = seedUser(db, { email: 'carol@pm.dev', name: '卡罗尔' })
    pid = seedProject(db, alice, { name: '消息项目' })
    tid = seedTask(db, pid, { title: '逾期任务', assigneeId: bob })
  })

  it('create + findById：联查双方姓名与项目/任务标题', () => {
    const msg = messageRepo.create({ senderId: alice, recipientId: bob, projectId: pid, taskId: tid, content: '请尽快处理' })
    const found = messageRepo.findById(msg.id)!
    expect(found.senderId).toBe(alice)
    expect(found.senderName).toBe('爱丽丝')
    expect(found.recipientId).toBe(bob)
    expect(found.recipientName).toBe('鲍勃')
    expect(found.projectId).toBe(pid)
    expect(found.projectName).toBe('消息项目')
    expect(found.taskId).toBe(tid)
    expect(found.taskTitle).toBe('逾期任务')
    expect(found.read).toBe(false)
  })

  it('threads 按 (上下文 × 对方) 分组：任务/项目/直聊互不合并，未读只数对方发给我的', () => {
    seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: '请处理', createdAt: '2026-10-10T01:00:00.000Z' })
    seedMessage(db, { senderId: bob, recipientId: alice, taskId: tid, projectId: pid, content: '收到', read: true, createdAt: '2026-10-10T02:00:00.000Z' })
    seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: '尽快', createdAt: '2026-10-10T03:00:00.000Z' })
    // 项目会话（无任务）：alice→bob
    seedMessage(db, { senderId: alice, recipientId: bob, projectId: pid, content: '项目也延期了', createdAt: '2026-10-10T04:00:00.000Z' })
    // 同一任务下卡罗尔与鲍勃：独立会话
    seedMessage(db, { senderId: carol, recipientId: bob, taskId: tid, projectId: pid, content: '我协助', createdAt: '2026-10-10T05:00:00.000Z' })

    const bobThreads = messageRepo.threads(bob)
    expect(bobThreads).toHaveLength(3) // task:tid|alice、project:pid|alice、task:tid|carol
    const byKey = new Map(bobThreads.map((t) => [`${t.taskId || t.projectId || 'direct'}|${t.peerId}`, t]))
    const taskAlice = byKey.get(`${tid}|${alice}`)!
    const projAlice = byKey.get(`${pid}|${alice}`)!
    const taskCarol = byKey.get(`${tid}|${carol}`)!
    expect(taskAlice.total).toBe(3)
    expect(taskAlice.unread).toBe(2) // m1、m3 未读；bob 自己发的 m2 不计
    expect(taskAlice.lastContent).toBe('尽快')
    expect(projAlice.unread).toBe(1)
    expect(taskCarol.unread).toBe(1)
    // 按 lastAt 倒序：carol(T5) > project(T4) > task(T3)
    expect(bobThreads.map((t) => t.peerId)).toEqual([carol, alice, alice])

    // alice 视角：她只发未收（bob 回的已读），未读应为 0
    const aliceThreads = messageRepo.threads(alice)
    expect(aliceThreads.every((t) => t.unread === 0)).toBe(true)
  })

  it('threadMessages 上下文隔离：任务会话不含项目消息，项目会话不含任务消息', () => {
    seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: '任务消息', createdAt: '2026-10-10T01:00:00.000Z' })
    seedMessage(db, { senderId: bob, recipientId: alice, taskId: tid, projectId: pid, content: '任务回复', createdAt: '2026-10-10T02:00:00.000Z' })
    seedMessage(db, { senderId: alice, recipientId: bob, projectId: pid, content: '项目消息', createdAt: '2026-10-10T03:00:00.000Z' })

    const taskThread = messageRepo.threadMessages(alice, bob, tid, null)
    expect(taskThread.map((m) => m.content)).toEqual(['任务消息', '任务回复'])

    const projThread = messageRepo.threadMessages(alice, bob, null, pid)
    expect(projThread.map((m) => m.content)).toEqual(['项目消息'])

    // 直聊上下文（双 NULL）：无消息
    expect(messageRepo.threadMessages(alice, bob, null, null)).toHaveLength(0)

    // 第三人不掺和：carol 查 alice 的任务会话为空
    expect(messageRepo.threadMessages(carol, alice, tid, null)).toHaveLength(0)
  })

  it('markThreadRead 只标记对方发给我的未读，且受上下文约束', () => {
    seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: 'm1', createdAt: '2026-10-10T01:00:00.000Z' })
    seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: 'm2', createdAt: '2026-10-10T02:00:00.000Z' })
    seedMessage(db, { senderId: bob, recipientId: alice, taskId: tid, projectId: pid, content: 'm3', createdAt: '2026-10-10T03:00:00.000Z' })
    seedMessage(db, { senderId: alice, recipientId: bob, projectId: pid, content: '项目消息', createdAt: '2026-10-10T04:00:00.000Z' })

    // 直聊上下文的已读操作不应误伤任务/项目会话
    messageRepo.markThreadRead(bob, alice, null, null)
    expect(messageRepo.unreadCount(bob)).toBe(3)

    messageRepo.markThreadRead(bob, alice, tid, null)
    // 任务会话 2 条已读，项目会话 1 条仍未读
    expect(messageRepo.unreadCount(bob)).toBe(1)
    // bob 发给 alice 的 m3 不受影响（alice 未读 hers：0，因为 m3 是 bob 发的，alice 的未读 = 收到 m3 → 1）
    expect(messageRepo.unreadCount(alice)).toBe(1)

    // 全上下文对齐后再清零
    messageRepo.markThreadRead(bob, alice, null, pid)
    expect(messageRepo.unreadCount(bob)).toBe(0)
  })

  it('unreadCount 汇总所有会话的未读', () => {
    seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: 'a', createdAt: '2026-10-10T01:00:00.000Z' })
    seedMessage(db, { senderId: carol, recipientId: bob, content: 'b', createdAt: '2026-10-10T02:00:00.000Z' })
    expect(messageRepo.unreadCount(bob)).toBe(2)
    expect(messageRepo.unreadCount(alice)).toBe(0)
  })

  it('发送消息联动通知：notificationRepo 收到 system 类型新通知（路由层行为等价验证）', () => {
    const msg = messageRepo.create({ senderId: alice, recipientId: bob, projectId: pid, taskId: tid, content: '这是一条比较长的提醒内容，超过六十字符的部分会被截断展示在通知正文里，用于模拟真实逾期提醒文案的长度情况' })
    const sender = userRepo.findById(alice)!
    notificationRepo.create({
      userId: bob,
      type: 'system',
      title: `${sender.name} 发来站内消息`,
      body: msg.content.slice(0, 60),
      taskId: tid,
      projectId: pid,
    })
    const list = notificationRepo.findByUser(bob)
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('system')
    expect(list[0].title).toBe('爱丽丝 发来站内消息')
    expect(list[0].body.length).toBeLessThanOrEqual(60)
    expect(list[0].read).toBe(false)
  })

  it('ProjectHealth 带 ownerId（逾期明细右键发消息依赖）', () => {
    const health = computeProjectHealth(projectRepo.findById(pid)!, taskRepo.findByProject(pid), new Date('2026-09-29T00:00:00+08:00'), new Date('2026-09-29T00:00:00+08:00').getTime())
    expect(health.ownerId).toBe(alice)
    expect(health.ownerName).toBe('爱丽丝')
  })

  it('删除用户级联清理其消息', () => {
    const mid = seedMessage(db, { senderId: alice, recipientId: bob, taskId: tid, projectId: pid, content: '待级联', createdAt: '2026-10-10T01:00:00.000Z' })
    expect(messageRepo.findById(mid)).not.toBeNull()
    // 先删项目（级联任务），再删用户（级联其收发的消息）
    db.prepare('DELETE FROM projects WHERE id = ?').run(pid)
    db.prepare('DELETE FROM users WHERE id = ?').run(alice)
    expect(messageRepo.findById(mid)).toBeNull()
    const rows = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }
    expect(rows.c).toBe(0)
  })
})
