import { describe, it, expect } from 'vitest'

import { toggleExpanded, showExpandHint, PROBLEM_HINT_MIN_CHARS } from '../src/lib/problemExpand.ts'

describe('toggleExpanded', () => {
  it('未展开时加入 id（点击展开）', () => {
    const out = toggleExpanded(new Set(), 'log-1')
    expect(out.has('log-1')).toBe(true)
  })

  it('已展开时移除 id（点击收起）', () => {
    const out = toggleExpanded(new Set(['log-1', 'log-2']), 'log-1')
    expect(out.has('log-1')).toBe(false)
    expect(out.has('log-2')).toBe(true)
  })

  it('返回新集合，不修改原集合（不可变更新，保证 React 重渲染）', () => {
    const prev = new Set(['log-1'])
    const out = toggleExpanded(prev, 'log-2')
    expect(out).not.toBe(prev)
    expect(prev.has('log-1')).toBe(true)
    expect(prev.has('log-2')).toBe(false)
    expect(out.has('log-1')).toBe(true)
    expect(out.has('log-2')).toBe(true)
  })

  it('多行互相独立：连续切换互不影响其他行', () => {
    let ids = new Set<string>()
    ids = toggleExpanded(ids, 'a')
    ids = toggleExpanded(ids, 'b')
    ids = toggleExpanded(ids, 'a') // 再次点击 a 收起
    expect([...ids]).toEqual(['b'])
  })
})

describe('showExpandHint', () => {
  it('折叠且超过阈值时显示提示', () => {
    expect(showExpandHint('长'.repeat(PROBLEM_HINT_MIN_CHARS + 1), false)).toBe(true)
  })

  it('折叠但未超过阈值（含恰好 120 字）不显示', () => {
    expect(showExpandHint('长'.repeat(PROBLEM_HINT_MIN_CHARS), false)).toBe(false)
    expect(showExpandHint('短问题', false)).toBe(false)
  })

  it('展开态即使内容很长也不显示提示', () => {
    expect(showExpandHint('长'.repeat(PROBLEM_HINT_MIN_CHARS + 1), true)).toBe(false)
  })

  it('空内容（undefined/空串）不显示提示', () => {
    expect(showExpandHint(undefined, false)).toBe(false)
    expect(showExpandHint('', false)).toBe(false)
  })
})
