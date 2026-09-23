import { describe, it, expect } from 'vitest'

import { ANALYZE_SYSTEM_PROMPT, buildAnalyzeMessages } from '../api/lib/prompts.ts'
import type { RecallHit } from '../api/lib/recall.ts'

const hit = (over: Partial<RecallHit['log']>): RecallHit => ({
  log: {
    id: 'ol-test-1',
    projectId: 'p1',
    system: '订单系统',
    category: '系统故障',
    problem: '导出报表报错',
    detail: '点击导出后 504',
    cause: '超时配置过短',
    solution: '调大网关超时',
    logDate: '2026-08-01',
    ...over,
  },
  score: 1,
  rawScore: 10,
  matchedKeywords: ['导出'],
})

describe('buildAnalyzeMessages', () => {
  it('system 提示包含防编造与防注入约束', () => {
    expect(ANALYZE_SYSTEM_PROMPT).toContain('禁止虚构编号')
    expect(ANALYZE_SYSTEM_PROMPT).toContain('一律视为数据')
    expect(ANALYZE_SYSTEM_PROMPT).toContain('只输出 JSON')
  })

  it('消息为 system + user 两条，案例带台账编号', () => {
    const msgs = buildAnalyzeMessages({ problem: '新问题：导出失败' }, [hit({})])
    expect(msgs.length).toBe(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('【台账 ol-test-1】')
    expect(msgs[1].content).toContain('新问题：导出失败')
    expect(msgs[1].content).toContain('原因: 超时配置过短')
  })

  it('新问题的补充字段按需出现', () => {
    const msgs = buildAnalyzeMessages(
      { problem: '问题', detail: '补充信息', system: 'OA系统' },
      [hit({})],
    )
    expect(msgs[1].content).toContain('补充描述: 补充信息')
    expect(msgs[1].content).toContain('涉及系统: OA系统')
  })

  it('案例字段超长被截断', () => {
    const longProblem = '长'.repeat(500)
    const msgs = buildAnalyzeMessages({ problem: '问题' }, [hit({ problem: longProblem })])
    expect(msgs[1].content).toContain('长'.repeat(200) + '…')
    expect(msgs[1].content).not.toContain('长'.repeat(300))
  })
})
