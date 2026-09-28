// @vitest-environment jsdom
// 预算面板 E2E（组件全链路）：渲染真实 BudgetPanel，模拟「打开表单 → 万单位输入 → 提交 → API 调用」
// 完整用户流；api 与 store 使用 mock，聚焦金额输入组件与表单接线的端到端行为

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, ProjectBudget, ProjectExpense } from '../shared/types'

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    listBudgets: vi.fn(),
    listExpenses: vi.fn(),
    getProject: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
    approveBudget: vi.fn(),
    rejectBudget: vi.fn(),
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
    setTotalBudget: vi.fn(),
  },
}))

// 注意：tsconfig include 不含 tests，vi.mock 必须用相对路径（与 src 内部 @/ 解析到同一模块）
vi.mock('../src/lib/api', () => ({ api: apiMocks }))

vi.mock('../src/stores/app', () => ({
  useAppStore: (sel: (s: unknown) => unknown) =>
    sel({
      notify: vi.fn(),
      user: { id: 'u-finance', name: '核算财务', role: 'finance' },
    }),
}))

import BudgetPanel from '../src/components/BudgetPanel'

// jsdom 未实现 ResizeObserver，recharts ResponsiveContainer 挂载时依赖它
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const PROJECT_ID = 'p-e2e'

function makeBudget(overrides: Partial<ProjectBudget>): ProjectBudget {
  return {
    id: 'b1',
    projectId: PROJECT_ID,
    category: 'labor',
    amount: 20000,
    description: '内部人力',
    approvalStatus: 'approved',
    createdBy: 'u-finance',
    createdAt: '2026-09-01 10:00:00',
    ...overrides,
  } as ProjectBudget
}

const PROJECT: Project = {
  id: PROJECT_ID,
  name: 'E2E 预算项目',
  ownerId: 'u-finance',
  status: 'active',
  totalBudget: 50000,
  createdAt: '2026-09-01 10:00:00',
} as Project

let alertMock: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.listBudgets.mockResolvedValue({ budgets: [makeBudget({})] })
  apiMocks.listExpenses.mockResolvedValue({ expenses: [] as ProjectExpense[] })
  apiMocks.getProject.mockResolvedValue({ project: PROJECT })
  alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(cleanup)

describe('预算面板全链路（金额输入 E2E）', () => {
  it('新建预算：键入「3.5万」→ 创建预算 → createBudget 收到 35000 且弹窗关闭', async () => {
    const user = userEvent.setup()
    apiMocks.createBudget.mockResolvedValue({ budget: makeBudget({ amount: 35000, description: 'UI 设计外包', category: 'outsource' }) })
    render(<BudgetPanel projectId={PROJECT_ID} />)

    await user.click(await screen.findByRole('button', { name: '添加预算' }))
    // 切换分类到「外包费用」
    await user.selectOptions(screen.getByDisplayValue('内部人力'), 'outsource')
    const amountInput = screen.getByPlaceholderText('支持 3.5万')
    await user.type(amountInput, '3.5万')
    await user.type(screen.getByPlaceholderText('请输入备注说明'), 'UI 设计外包')
    await user.click(screen.getByRole('button', { name: '创建预算' }))

    await waitFor(() => {
      expect(apiMocks.createBudget).toHaveBeenCalledWith(PROJECT_ID, {
        category: 'outsource',
        amount: 35000,
        description: 'UI 设计外包',
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '创建预算' })).toBeNull()
    })
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('总预算剩余联动：键入 4万（超出剩余 3 万）出现红框提示，后端拦截时 alert 且弹窗不关', async () => {
    const user = userEvent.setup()
    apiMocks.createBudget.mockRejectedValue(new Error('超出项目总预算：剩余可分配 ¥30,000.00，本次申请 ¥40,000.00'))
    render(<BudgetPanel projectId={PROJECT_ID} />)

    await user.click(await screen.findByRole('button', { name: '添加预算' }))
    const amountInput = screen.getByPlaceholderText('支持 3.5万')
    await user.type(amountInput, '4万')

    // 组件内红框：AmountInput 上限提示（50000 - 20000 = 30000）
    expect(screen.getByText('超出上限 ¥30,000')).toBeTruthy()
    // 面板级剩余额度提示同步变红文案
    expect(screen.getByText(/本次金额已超出总额/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '创建预算' }))
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('超出项目总预算：剩余可分配 ¥30,000.00，本次申请 ¥40,000.00')
    })
    // 弹窗未关闭，用户可修正金额后重试
    expect(screen.getByRole('button', { name: '创建预算' })).toBeTruthy()
  })

  it('编辑预算：金额框聚焦全选直接替换，保存后 updateBudget 收到新金额', async () => {
    const user = userEvent.setup()
    const pendingBudget = makeBudget({ id: 'b2', approvalStatus: 'pending', amount: 20000, category: 'outsource', description: '旧外包' })
    apiMocks.listBudgets.mockResolvedValue({ budgets: [pendingBudget] })
    apiMocks.updateBudget.mockResolvedValue({})
    render(<BudgetPanel projectId={PROJECT_ID} />)

    await user.click(await screen.findByRole('button', { name: '编辑预算' }))
    const amountInput = screen.getByPlaceholderText('支持 3.5万') as HTMLInputElement
    expect(amountInput.value).toBe('20,000')
    // 聚焦全选后直接键入即整体替换（无需手动清除旧值）
    await user.type(amountInput, '3万')
    expect(apiMocks.updateBudget).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(apiMocks.updateBudget).toHaveBeenCalledWith('b2', {
        category: 'outsource',
        amount: 30000,
        description: '旧外包',
      })
    })
    // 编辑已有预算不受总额 max 红框约束（排除自身占用，由后端校验）
    expect(screen.queryByText(/超出上限/)).toBeNull()
  })
})
