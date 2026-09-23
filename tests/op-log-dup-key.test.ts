import { describe, it, expect } from 'vitest'
import { normProblemKey, opLogDupKey } from '../api/routes/opLogs.ts'

describe('台账导入查重 key', () => {
  it('问题文本归一化：CRLF/LF 统一、去首尾空白', () => {
    expect(normProblemKey('第一行\r\n第二行')).toBe('第一行\n第二行')
    expect(normProblemKey('  同一问题  ')).toBe('同一问题')
    expect(normProblemKey('同一问题')).toBe(normProblemKey(' 同一问题\r\n'))
  })

  it('同一问题但作业日期不同 → key 不同（不算重复）', () => {
    expect(opLogDupKey('p1', '2026-06-24', '月结作业')).not.toBe(opLogDupKey('p1', '2026-06-30', '月结作业'))
  })

  it('同一问题但项目不同 → key 不同（跨项目不误拦）', () => {
    expect(opLogDupKey('p1', '2026-06-24', '月结作业')).not.toBe(opLogDupKey('p2', '2026-06-24', '月结作业'))
  })

  it('完全一致（含归一化后）→ key 相同', () => {
    expect(opLogDupKey('p1', '2026-06-24', '问题A\r\n续行 ')).toBe(opLogDupKey('p1', '2026-06-24', '问题A\n续行'))
  })

  it('无日期（undefined/null/空串）视为同一空值键', () => {
    expect(opLogDupKey('p1', undefined, '问题B')).toBe(opLogDupKey('p1', null, '问题B'))
    expect(opLogDupKey('p1', '', '问题B')).toBe(opLogDupKey('p1', undefined, '问题B'))
  })
})
