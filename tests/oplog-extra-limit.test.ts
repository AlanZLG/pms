// 台账自定义列（扩展字段）数量上限：最多 10 个，__ 前缀内部字段不占名额
import { describe, it, expect } from 'vitest'
import { extraUserKeys, assertExtraColumnsLimit } from '../api/routes/opLogs.ts'
import { OP_LOG_MAX_EXTRA_COLUMNS } from '../shared/types'

const letterCols = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i))
const toExtra = (cols: string[]) => Object.fromEntries(cols.map((k) => [k, 'v']))

describe('台账自定义列上限', () => {
  it('上限常量为 10', () => {
    expect(OP_LOG_MAX_EXTRA_COLUMNS).toBe(10)
  })

  it('__ 前缀内部字段不计入名额', () => {
    const keys = extraUserKeys({ __sourceTaskId: 't1', __sourceTaskTitle: '某任务', 客户名称: 'A', 影响程度: '高' })
    expect(keys).toEqual(['客户名称', '影响程度'])
  })

  it('恰好 10 个用户列放行（内部字段额外保留）', () => {
    const extra = toExtra(letterCols(OP_LOG_MAX_EXTRA_COLUMNS))
    expect(() => assertExtraColumnsLimit({ ...extra, __sourceTaskId: 't1' })).not.toThrow()
  })

  it('超过 10 个抛 400 并列出超出的列名', () => {
    const extra = toExtra(letterCols(OP_LOG_MAX_EXTRA_COLUMNS + 2))
    expect(() => assertExtraColumnsLimit(extra)).toThrow(/自定义列最多 10 个，当前 12 个：k、l/)
  })

  it('空值/非对象安全返回空数组', () => {
    expect(extraUserKeys(undefined)).toEqual([])
    expect(extraUserKeys(null)).toEqual([])
    expect(extraUserKeys('x')).toEqual([])
    expect(extraUserKeys(123)).toEqual([])
  })
})
