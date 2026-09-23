// @vitest-environment jsdom
// 台账「问题」列展开/收起 组件级测试：渲染真实 OpLogsPanel，模拟点击验证 DOM 行为
// api 与全局 store 使用 mock，仅聚焦表格交互本身

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpLog } from '../shared/types'

const { seedLogs } = vi.hoisted(() => ({ seedLogs: [] as unknown[] }))

// 注意：tsconfig include 不含 tests，vite-tsconfig-paths 不为测试文件解析 @/ 别名，
// 因此 vi.mock 必须用相对路径（与 src 内部 @/ 导入解析到同一模块）才能正确拦截

vi.mock('../src/lib/api', () => ({
  api: {
    listOpLogs: vi.fn(async () => ({ logs: seedLogs })),
    getOpLogStats: vi.fn(async () => ({ stats: [] })),
    getOpLogOptions: vi.fn(async () => ({ categories: [], systems: [], departments: [] })),
    listProjects: vi.fn(async () => ({ projects: [] })),
    getOpLogAiStatus: vi.fn(async () => ({ enabled: false, model: '' })),
  },
}))

vi.mock('../src/stores/app', () => ({
  useAppStore: (sel: (s: unknown) => unknown) =>
    sel({
      notify: vi.fn(),
      user: { id: 'u1', name: '测试用户', role: 'admin' },
    }),
}))

import OpLogsPanel from '../src/components/OpLogsPanel'

function makeOpLog(overrides: Partial<OpLog>): OpLog {
  return {
    id: 'log-1',
    projectId: null,
    userId: 'u1',
    category: '故障',
    status: '已完成',
    proposer: '张三',
    system: 'OA',
    department: 'IT',
    logDate: '2026-09-01',
    recorder: '李四',
    problem: '',
    completionDate: '2026-09-02',
    hours: 1,
    detail: null,
    cause: null,
    solution: null,
    extraFields: {},
    createdAt: '2026-09-01 10:00:00',
    updatedAt: '2026-09-01 10:00:00',
    ...overrides,
  }
}

const longText = '长'.repeat(150)
const shortText = '打印机卡纸'
const longSolution = '方'.repeat(140)
const shortSolution = '重启服务并清理缓存'

beforeEach(() => {
  vi.clearAllMocks()
  seedLogs.length = 0
  seedLogs.push(
    makeOpLog({ id: 'log-long', problem: longText, solution: longSolution }),
    makeOpLog({ id: 'log-short', problem: shortText, solution: shortSolution }),
  )
})

// vitest 未开启 globals，RTL 的自动 cleanup 不生效，需手动清理避免跨用例 DOM 残留
afterEach(cleanup)

/** 定位某条台账「问题」单元格：td 为可点击区域，div 为文本容器（折叠样式挂在 div 上） */
function problemCell(text: string) {
  const div = screen.getByText(text)
  const td = div.closest('td') as HTMLTableCellElement
  return { div, td }
}

describe('OpLogsPanel 问题列展开/收起（组件级）', () => {
  it('初始折叠：line-clamp-2、悬停标题、超过 120 字显示「展开」提示，短文本无提示', async () => {
    render(<OpLogsPanel />)
    await screen.findByText(longText)

    const long = problemCell(longText)
    expect(long.div.className).toContain('line-clamp-2')
    expect(long.td.className).toContain('cursor-pointer')
    expect(long.td.getAttribute('title')).toBe('点击查看完整内容')
    expect(within(long.td).getByText('展开')).toBeTruthy()

    const short = problemCell(shortText)
    expect(short.div.className).toContain('line-clamp-2')
    expect(short.td.className).toContain('cursor-pointer')
    expect(within(short.td).queryByText('展开')).toBeNull()
  })

  it('点击展开：移除折叠样式与提示，全文可见，且不影响其他行', async () => {
    const user = userEvent.setup()
    render(<OpLogsPanel />)
    await screen.findByText(longText)
    const long = problemCell(longText)
    const short = problemCell(shortText)

    await user.click(long.div)

    expect(long.div.className).not.toContain('line-clamp-2')
    expect(long.td.getAttribute('title')).toBeNull()
    expect(within(long.td).queryByText('展开')).toBeNull()
    expect(within(long.td).getByText(longText)).toBeTruthy()
    // 独立性：长文本展开后，短文本行仍保持折叠
    expect(short.div.className).toContain('line-clamp-2')
    expect(within(short.td).queryByText('展开')).toBeNull()
  })

  it('再次点击收起：恢复折叠样式、「展开」提示与悬停标题', async () => {
    const user = userEvent.setup()
    render(<OpLogsPanel />)
    await screen.findByText(longText)
    const cell = problemCell(longText)

    await user.click(cell.div)
    expect(cell.div.className).not.toContain('line-clamp-2')

    await user.click(cell.div)
    expect(cell.div.className).toContain('line-clamp-2')
    expect(within(cell.td).getByText('展开')).toBeTruthy()
    expect(cell.td.getAttribute('title')).toBe('点击查看完整内容')
  })

  it('解决方案列：折叠显示「展开」提示，点击展开/收起，与问题列互相独立', async () => {
    const user = userEvent.setup()
    render(<OpLogsPanel />)
    await screen.findByText(longText)

    const problem = problemCell(longText)
    const solution = problemCell(longSolution)
    expect(within(solution.td).getByText('展开')).toBeTruthy()

    // 展开解决方案，问题列不受影响
    await user.click(solution.div)
    expect(solution.div.className).not.toContain('line-clamp-2')
    expect(problem.div.className).toContain('line-clamp-2')
    expect(within(solution.td).queryByText('展开')).toBeNull()

    // 收起恢复
    await user.click(solution.div)
    expect(solution.div.className).toContain('line-clamp-2')
    expect(within(solution.td).getByText('展开')).toBeTruthy()
  })

  it('解决方案为空时显示占位符且不可点击展开', async () => {
    seedLogs.length = 0
    seedLogs.push(makeOpLog({ id: 'log-empty', problem: shortText, solution: null }))
    render(<OpLogsPanel />)
    await screen.findByText(shortText)

    // 解决方案列为问题列的下一个单元格
    const problem = problemCell(shortText)
    const solutionTd = problem.td.nextElementSibling as HTMLTableCellElement
    expect(solutionTd.textContent).toBe('-')
    expect(solutionTd.className).not.toContain('cursor-pointer')
    expect(solutionTd.getAttribute('title')).toBeNull()
  })
})
