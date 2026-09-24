// 全局系统操作日志（systemActivityLogRepo）：人员类别等全局资源的变更留痕与查询
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser } from './helpers/test-db'
import { systemActivityLogRepo } from '../api/repository/repo.ts'

describe('全局系统操作日志（systemActivityLogRepo）', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM system_activity_log').run()
    db.prepare('DELETE FROM users').run()
  })

  it('写入与查询：字段完整（操作人、action、target、detail）', () => {
    const adminId = seedUser(db, { role: 'admin' })
    systemActivityLogRepo.create(adminId, 'category_create', '外包开发', '新建类别「外包开发」，单价 ¥125/小时（外包）')
    systemActivityLogRepo.create(adminId, 'category_update', '外包开发', '单价 ¥125 → ¥130/小时')
    systemActivityLogRepo.create(adminId, 'category_delete', '临时类别', '删除类别「临时类别」（¥100/小时）')

    const rows = systemActivityLogRepo.findAll()
    expect(rows).toHaveLength(3)
    const actions = rows.map((r) => r.action).sort()
    expect(actions).toEqual(['category_create', 'category_delete', 'category_update'])

    const created = rows.find((r) => r.action === 'category_create')!
    expect(created.userName).toBeTruthy()
    expect(created.target).toBe('外包开发')
    expect(created.detail).toContain('¥125')
    expect(created.createdAt).toBeTruthy()

    const updated = rows.find((r) => r.action === 'category_update')!
    expect(updated.detail).toBe('单价 ¥125 → ¥130/小时')
  })

  it('target 与 detail 可省略（存为 null），limit 生效', () => {
    const adminId = seedUser(db, { role: 'admin' })
    systemActivityLogRepo.create(adminId, 'misc_action')
    const rows = systemActivityLogRepo.findAll()
    expect(rows[0].target).toBeNull()
    expect(rows[0].detail).toBeNull()

    for (let i = 0; i < 5; i++) systemActivityLogRepo.create(adminId, 'category_create', `类别${i}`, `第 ${i} 条`)
    expect(systemActivityLogRepo.findAll(3)).toHaveLength(3)
    expect(systemActivityLogRepo.findAll()).toHaveLength(6)
  })
})
