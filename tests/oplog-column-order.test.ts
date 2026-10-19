// 台账列设置与导出列序一致性（修复：导出跟随列设置 + 页面补「详细描述」列）
// - 默认列序收敛到 shared/types.ts 的 OP_LOG_DEFAULT_COLUMN_ORDER（前后端单一事实源）
// - 导出端缺失列按默认相对位置插入（与前端 mergeColumnOrder 同语义），不再追加到末尾
// - v2 修复：导出改用统一交错列序 mergeExportOrder —— 自定义列（extra:*）与项目列
//   按界面列设置的位置交错输出，不再强制堆尾/置顶（用户实测列序不一致的根因）
import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import { OP_LOG_DEFAULT_COLUMN_ORDER } from '../shared/types.ts'
import { mergeExportOrder, mergeFixedExportOrder } from '../api/routes/opLogs.ts'
import { mergeColumnOrder } from '../src/components/OpLogsPanel.tsx'

const DEFAULTS = OP_LOG_DEFAULT_COLUMN_ORDER as readonly string[]

describe('台账默认列序（shared 单一事实源）', () => {
  it('包含 detail（详细描述），且位于 problem 与 cause 之间', () => {
    expect(DEFAULTS).toContain('detail')
    expect(DEFAULTS.indexOf('detail')).toBeGreaterThan(DEFAULTS.indexOf('problem'))
    expect(DEFAULTS.indexOf('detail')).toBeLessThan(DEFAULTS.indexOf('cause'))
  })

  it('覆盖全部固定列（登记日期也在其中）', () => {
    for (const k of ['category', 'status', 'proposer', 'system', 'department', 'logDate', 'recorder', 'problem', 'detail', 'cause', 'solution', 'completionDate', 'hours', 'createdAt']) {
      expect(DEFAULTS).toContain(k)
    }
  })
})

describe('导出端 mergeFixedExportOrder（列设置跟随修复）', () => {
  it('未设置过列序（空数组）→ 回退完整默认序（不含 seq/project）', () => {
    expect(mergeFixedExportOrder([])).toEqual(DEFAULTS.filter((k) => k !== 'seq' && k !== 'project'))
  })

  it('v1.9 旧列序（无 detail）→ detail 按默认相对位置插在 problem 之后，而非追加到末尾', () => {
    const legacy = ['logDate', 'category', 'status', 'proposer', 'recorder', 'problem', 'cause', 'solution', 'completionDate', 'hours']
    const out = mergeFixedExportOrder(legacy)
    expect(out.indexOf('detail')).toBe(out.indexOf('problem') + 1)
    expect(out.indexOf('detail')).toBeLessThan(out.indexOf('solution'))
  })

  it('用户自定义完整序 → 原样保持（导出与列设置一模一样）', () => {
    const custom = ['status', 'problem', 'detail', 'cause', 'solution', 'logDate', 'hours', 'completionDate', 'category', 'system', 'department', 'proposer', 'recorder', 'createdAt']
    expect(mergeFixedExportOrder(custom)).toEqual([...custom])
  })

  it('未知列被过滤、seq/project 被忽略；缺失列按默认相对位置补齐', () => {
    const dirty = ['status', 'hack', 'seq', 'project', 'hours']
    const out = mergeFixedExportOrder(dirty)
    expect(out).not.toContain('hack')
    expect(out).not.toContain('seq')
    expect(out).not.toContain('project')
    expect(out).toEqual([...DEFAULTS.filter((k) => k !== 'seq' && k !== 'project')])
  })
})

describe('两端 merge 语义一致（界面列序 = 导出列序）', () => {
  it('同一 v1.9 旧列序输入，前端 merge 与后端 merge 的固定列部分完全一致', () => {
    const legacy = ['logDate', 'category', 'status', 'proposer', 'recorder', 'problem', 'cause', 'solution', 'completionDate', 'hours']
    const fe = mergeColumnOrder(legacy, ['客户名称', '影响程度'])
      .filter((k) => !k.startsWith('extra:') && k !== 'project')
    const be = mergeFixedExportOrder(legacy)
    expect(fe).toEqual(be)
  })

  it('极简旧序（仅 3 列）+ 自定义列：固定列部分两端一致，extra 列两端均尾随', () => {
    const legacy = ['status', 'problem', 'hours']
    const feAll = mergeColumnOrder(legacy, ['客户名称'])
    const beAll = mergeFixedExportOrder(legacy)
    expect(feAll.filter((k) => !k.startsWith('extra:') && k !== 'project')).toEqual(beAll)
    expect(feAll.slice(-1)).toEqual(['extra:客户名称'])
  })
})

describe('统一交错列序 mergeExportOrder（自定义列/项目列可与固定列交错）', () => {
  it('用户序把自定义列移到固定列中间 → 原位保留（不堆尾），且与前端 mergeColumnOrder 全量一致', () => {
    const stored = ['logDate', 'extra:客户名称', 'problem', 'hours']
    const be = mergeExportOrder(stored, ['客户名称'], false)
    // 前端同输入（过滤界面专用 project 列）必须与后端完全一致 —— 这是「导出=界面」的核心承诺
    const fe = mergeColumnOrder(stored, ['客户名称']).filter((k) => k !== 'project')
    expect(fe).toEqual(be)
    // 精确序：extra:客户名称 保持在 recorder 与 problem 之间；hours 保持在用户放置的位置
    expect(be).toEqual([
      'logDate', 'category', 'status', 'system', 'department', 'proposer', 'recorder',
      'extra:客户名称', 'problem', 'detail', 'cause', 'solution', 'completionDate', 'hours', 'createdAt',
    ])
  })

  it('空列序 → 完整默认序 + 缺失自定义列尾部追加', () => {
    expect(mergeExportOrder([], ['客户名称', '影响程度'], false)).toEqual([
      ...DEFAULTS.filter((k) => k !== 'seq' && k !== 'project'),
      'extra:客户名称', 'extra:影响程度',
    ])
  })

  it('includeProject=true → 项目列按用户序位置保留（默认位次在 status 与 system 之间）', () => {
    const out = mergeExportOrder(['logDate', 'project', 'problem'], [], true)
    expect(out).toEqual([
      'logDate', 'category', 'status', 'project', 'system', 'department', 'proposer', 'recorder',
      'problem', 'detail', 'cause', 'solution', 'completionDate', 'hours', 'createdAt',
    ])
  })

  it('includeProject=false → project 与未知 extra 被过滤，缺失 extra 按默认语义尾部追加', () => {
    const out = mergeExportOrder(['logDate', 'project', 'extra:未知列', 'hours'], ['客户名称'], false)
    expect(out).not.toContain('project')
    expect(out).not.toContain('extra:未知列')
    expect(out).toEqual([...mergeFixedExportOrder(['logDate', 'hours']), 'extra:客户名称'])
  })
})
