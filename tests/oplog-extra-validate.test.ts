// 台账自定义列字段校验：配置模式白名单 + 导入重复表头检测
import { describe, it, expect } from 'vitest'
import { assertExtraFieldsMatchConfig, findDuplicateHeaders } from '../api/routes/opLogs.ts'
import { ApiError } from '../api/lib/utils.ts'

const config = {
  columns: [
    { key: '客户名称', label: '客户名称' },
    { key: 'col_abc', label: '影响程度' },
    { key: 'col_xyz', label: '处理人' },
  ],
}

describe('配置模式字段白名单 assertExtraFieldsMatchConfig', () => {
  it('字段键都在定义内时放行', () => {
    expect(() => assertExtraFieldsMatchConfig({ 客户名称: 'A', col_abc: '高', __sourceTaskId: 't1' }, config)).not.toThrow()
  })

  it('__ 前缀系统字段豁免校验', () => {
    expect(() => assertExtraFieldsMatchConfig({ __sourceTaskId: 't1', __sourceTaskTitle: 'x' }, config)).not.toThrow()
  })

  it('含定义外字段抛 400 并列出字段名', () => {
    expect(() => assertExtraFieldsMatchConfig({ 客户名称: 'A', 未知字段: 'v' }, config)).toThrow(ApiError)
    try {
      assertExtraFieldsMatchConfig({ 客户名称: 'A', 未知字段: 'v', 另一个: 'w' }, config)
    } catch (e) {
      expect((e as ApiError).status).toBe(400)
      expect((e as ApiError).message).toContain('未知字段、另一个')
    }
  })

  it('空值/非对象安全放行', () => {
    expect(() => assertExtraFieldsMatchConfig(undefined, config)).not.toThrow()
    expect(() => assertExtraFieldsMatchConfig(null, config)).not.toThrow()
    expect(() => assertExtraFieldsMatchConfig('x', config)).not.toThrow()
    expect(() => assertExtraFieldsMatchConfig({}, config)).not.toThrow()
  })
})

describe('导入表头重复列名检测 findDuplicateHeaders', () => {
  it('无重复返回空数组', () => {
    expect(findDuplicateHeaders(['分类', '状态', '问题', '客户名称'])).toEqual([])
  })

  it('检出重复列名并保持首次出现顺序', () => {
    expect(findDuplicateHeaders(['问题', '客户名称', '问题', '状态', '客户名称', '问题'])).toEqual(['问题', '客户名称'])
  })

  it('空列名跳过，同一重复只报一次', () => {
    expect(findDuplicateHeaders(['', '日期', '', '日期'])).toEqual(['日期'])
  })
})
