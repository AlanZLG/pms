// 台账自定义列（扩展字段）数量上限：最多 5 个，__ 前缀内部字段不占名额
import { describe, it, expect } from 'vitest'
import { extraUserKeys, assertExtraColumnsLimit } from '../api/routes/opLogs.ts'
import { OP_LOG_MAX_EXTRA_COLUMNS } from '../shared/types'

describe('台账自定义列上限', () => {
  it('上限常量为 5', () => {
    expect(OP_LOG_MAX_EXTRA_COLUMNS).toBe(5)
  })

  it('__ 前缀内部字段不计入名额', () => {
    const keys = extraUserKeys({ __sourceTaskId: 't1', __sourceTaskTitle: '某任务', 客户名称: 'A', 影响程度: '高' })
    expect(keys).toEqual(['客户名称', '影响程度'])
  })

  it('恰好 5 个用户列放行（内部字段额外保留）', () => {
    const extra = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k) => [k, 'v']))
    expect(() => assertExtraColumnsLimit({ ...extra, __sourceTaskId: 't1' })).not.toThrow()
  })

  it('超过 5 个抛 400 并列出超出的列名', () => {
    const extra = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => [k, 'v']))
    expect(() => assertExtraColumnsLimit(extra)).toThrow(/自定义列最多 5 个，当前 7 个：f、g/)
  })

  it('空值/非对象安全返回空数组', () => {
    expect(extraUserKeys(undefined)).toEqual([])
    expect(extraUserKeys(null)).toEqual([])
    expect(extraUserKeys('x')).toEqual([])
    expect(extraUserKeys(123)).toEqual([])
  })
})
