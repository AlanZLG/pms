// 项目级台账自定义列配置（oplog_extra_columns）：持久化 / 读取 roundtrip / 404
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { seedUser } from './helpers/test-db'
import { projectRepo } from '../api/repository/repo.ts'
import { ApiError } from '../api/lib/utils.ts'
import type { OpLogExtraConfig } from '../shared/types'

type CreateData = Parameters<typeof projectRepo.create>[0]

function createProject(ownerId: string, name: string) {
  return projectRepo.create({ name, description: '', status: 'active', ownerId, dueDate: null } as CreateData)
}

describe('项目台账自定义列配置 projectRepo.setOplogColumns', () => {
  beforeEach(() => {
    for (const t of ['project_activity_log', 'task_hours', 'project_budgets', 'task_history', 'saved_filters',
      'notifications', 'comments', 'subtasks', 'op_logs', 'tasks', 'project_members', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
  })

  it('保存配置后 findById 可还原 enabled 与列顺序（roundtrip）', () => {
    const ownerId = seedUser(db)
    const p = createProject(ownerId, 'P1')
    const config: OpLogExtraConfig = {
      enabled: true,
      columns: [
        { key: '客户名称', label: '客户名称' },
        { key: 'col_abc', label: '影响程度' },
        { key: 'col_xyz', label: '处理人' },
      ],
    }
    projectRepo.setOplogColumns(p.id, config)
    const found = projectRepo.findById(p.id)!
    expect(found.oplogExtraColumns).not.toBeNull()
    expect(found.oplogExtraColumns!.enabled).toBe(true)
    expect(found.oplogExtraColumns!.columns).toEqual(config.columns)
  })

  it('停用配置（enabled=false）同样可持久化', () => {
    const ownerId = seedUser(db)
    const p = createProject(ownerId, 'P2')
    projectRepo.setOplogColumns(p.id, { enabled: false, columns: [{ key: 'k', label: 'v' }] })
    const found = projectRepo.findById(p.id)!
    expect(found.oplogExtraColumns!.enabled).toBe(false)
    expect(found.oplogExtraColumns!.columns).toHaveLength(1)
  })

  it('覆盖保存：后一次写入替换前一次配置', () => {
    const ownerId = seedUser(db)
    const p = createProject(ownerId, 'P3')
    projectRepo.setOplogColumns(p.id, { enabled: true, columns: [{ key: 'a', label: 'A' }] })
    projectRepo.setOplogColumns(p.id, { enabled: true, columns: [{ key: 'b', label: 'B' }, { key: 'c', label: 'C' }] })
    expect(projectRepo.findById(p.id)!.oplogExtraColumns!.columns.map((c) => c.key)).toEqual(['b', 'c'])
  })

  it('未配置的项目 oplogExtraColumns 为 null', () => {
    const ownerId = seedUser(db)
    const p = createProject(ownerId, 'P4')
    expect(projectRepo.findById(p.id)!.oplogExtraColumns).toBeNull()
  })

  it('项目不存在抛 404', () => {
    expect(() => projectRepo.setOplogColumns('no-such-id', { enabled: true, columns: [{ key: 'k', label: 'v' }] }))
      .toThrow(ApiError)
    try {
      projectRepo.setOplogColumns('no-such-id', { enabled: true, columns: [{ key: 'k', label: 'v' }] })
    } catch (e) {
      expect((e as ApiError).status).toBe(404)
    }
  })
})
