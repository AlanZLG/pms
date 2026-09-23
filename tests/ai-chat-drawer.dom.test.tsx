// @vitest-environment jsdom
// AiChatDrawer（AI 排障助手抽屉）组件级测试：mock api 与 store，聚焦对话交互
// 注意：vi.mock 必须用相对路径（tsconfig include 不含 tests，@/ 别名在测试文件中不解析）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  aiChatStream: vi.fn(),
  onOpenCase: vi.fn(),
  onClose: vi.fn(),
}))

vi.mock('../src/lib/api', () => ({
  api: {
    getOpLogAiStatus: vi.fn(async () => ({ enabled: true, model: 'test-model' })),
    aiChatStream: mocks.aiChatStream,
  },
}))

vi.mock('../src/stores/app', () => ({
  useAppStore: (sel: (s: unknown) => unknown) =>
    sel({
      notify: mocks.notify,
      user: { id: 'u1', name: '测试用户', role: 'admin' },
    }),
}))

import AiChatDrawer from '../src/components/AiChatDrawer'

beforeEach(() => {
  vi.clearAllMocks()
})

// vitest 未开启 globals，RTL 的自动 cleanup 不生效，需手动清理避免跨用例 DOM 残留
afterEach(cleanup)

describe('AiChatDrawer 对话式排障（组件级）', () => {
  it('空态显示欢迎提示，点击提示语即发送，渲染流式回答与可点击案例卡片', async () => {
    const user = userEvent.setup()
    mocks.aiChatStream.mockImplementation(async (_data: unknown, handlers: Record<string, (v?: unknown) => void>) => {
      handlers.onCases?.([
        { opLogId: 'log-9', problem: '打印机卡纸', cause: '进纸器故障', solution: '更换搓纸轮', system: 'OA', category: '故障', projectId: null, score: 0.87 },
      ])
      handlers.onDelta?.('先检查')
      handlers.onDelta?.('打印队列')
    })
    render(<AiChatDrawer projectId="p1" onOpenCase={mocks.onOpenCase} onClose={mocks.onClose} />)

    // 空态欢迎与提示语（头部显示模型名）
    expect(await screen.findByText(/描述你遇到的问题/)).toBeTruthy()
    expect(screen.getByText(/test-model/)).toBeTruthy()
    await user.click(screen.getByText('ERP 报销单无法提交，如何排查？'))

    // 请求参数：完整消息历史 + 项目上下文
    expect(mocks.aiChatStream).toHaveBeenCalledTimes(1)
    const [req] = mocks.aiChatStream.mock.calls[0]
    expect(req).toEqual({
      messages: [{ role: 'user', content: 'ERP 报销单无法提交，如何排查？' }],
      projectId: 'p1',
    })

    // 流式完成后的助手气泡（增量拼接）
    expect(await screen.findByText('先检查打印队列')).toBeTruthy()
    // 召回案例卡片 + 匹配度
    expect(screen.getByText('参考案例（1）')).toBeTruthy()
    expect(screen.getByText('87%')).toBeTruthy()

    // 点击案例触发跳转回调
    await user.click(screen.getByText('打印机卡纸'))
    expect(mocks.onOpenCase).toHaveBeenCalledWith('log-9')
  })

  it('发送失败时弹出错误通知，已生成的部分保留不丢失', async () => {
    const user = userEvent.setup()
    mocks.aiChatStream.mockImplementation(async (_data: unknown, handlers: Record<string, (v?: unknown) => void>) => {
      handlers.onDelta?.('部分回答')
      throw new Error('AI 助手回复失败')
    })
    render(<AiChatDrawer onOpenCase={mocks.onOpenCase} onClose={mocks.onClose} />)

    const box = screen.getByPlaceholderText(/描述问题/)
    await user.type(box, 'VPN 掉线')
    await user.click(screen.getByTitle('发送'))

    expect(await screen.findByText('部分回答')).toBeTruthy()
    expect(mocks.notify).toHaveBeenCalledWith('error', 'AI 助手回复失败')
  })

  it('流式中可点击停止，保留已生成部分并标注', async () => {
    const user = userEvent.setup()
    mocks.aiChatStream.mockImplementation(
      (_data: unknown, handlers: Record<string, (v?: unknown) => void>, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          handlers.onDelta?.('生成到一半')
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    render(<AiChatDrawer onOpenCase={mocks.onOpenCase} onClose={mocks.onClose} />)

    await user.type(screen.getByPlaceholderText(/描述问题/), '邮箱爆满')
    await user.click(screen.getByTitle('发送'))
    expect(await screen.findByText(/生成到一半/)).toBeTruthy()

    await user.click(screen.getByTitle('停止生成'))
    expect(await screen.findByText(/已停止生成/)).toBeTruthy()
  })
})
