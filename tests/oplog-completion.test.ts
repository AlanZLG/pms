import { describe, it, expect } from 'vitest'
import { completionMissing } from '../api/routes/opLogs.ts'

describe('已完成台账经验三字段必填（completionMissing）', () => {
  it('待处理/处理中/已关闭不强制（status 缺省视为待处理）', () => {
    expect(completionMissing({ status: '待处理', detail: '', cause: '', solution: '' })).toEqual([])
    expect(completionMissing({ status: '处理中' })).toEqual([])
    expect(completionMissing({ status: '已关闭' })).toEqual([])
    expect(completionMissing({})).toEqual([])
    expect(completionMissing({ status: null })).toEqual([])
  })

  it('已完成全空 → 三个字段都缺失', () => {
    expect(completionMissing({ status: '已完成', detail: '', cause: '', solution: '' })).toEqual([
      '详细描述',
      '原因',
      '解决方案',
    ])
  })

  it('已完成缺部分字段 → 只列出缺失项', () => {
    expect(
      completionMissing({ status: '已完成', detail: '有描述', cause: '  ', solution: '有方案' })
    ).toEqual(['原因'])
  })

  it('已完成全填（含纯空白视为未填）→ 通过', () => {
    expect(
      completionMissing({ status: '已完成', detail: '描述', cause: '原因', solution: '方案' })
    ).toEqual([])
    expect(
      completionMissing({ status: '已完成', detail: '描述', cause: ' \n\t', solution: '方案' })
    ).toEqual(['原因'])
  })

  it('PATCH 场景：合并现有值与更新后校验（更新清空已完成记录的字段会被拦截）', () => {
    const cur = { status: '已完成', detail: '旧描述', cause: '旧原因', solution: '旧方案' }
    // 更新其他字段不触发
    expect(completionMissing({ ...cur, hours: '2' } as never)).toEqual([])
    // 更新把原因清空 → 缺「原因」
    expect(completionMissing({ ...cur, cause: null } as never)).toEqual(['原因'])
  })
})
