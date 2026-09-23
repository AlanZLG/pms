// llm.chatStream 流式解析测试：SSE 行解析、跨 chunk 断行、空流降级
// 注意：llm.ts 在模块加载时读取 LLM_* 环境变量，需先 stubEnv 再动态 import

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.stubEnv('LLM_BASE_URL', 'http://test.local/v1')
vi.stubEnv('LLM_API_KEY', 'test-key')
vi.stubEnv('LLM_CHAT_MODEL', 'test-model')

const encoder = new TextEncoder()

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

// 构造 OpenAI 兼容的 SSE delta 行
function deltaLine(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('llm.chatStream', () => {
  it('按顺序回调 delta 并返回完整文本', async () => {
    const { llm } = await import('../api/lib/llm.ts')
    const deltas: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([deltaLine('{"summary"'), deltaLine(':"正常"}'), 'data: [DONE]\n\n'])))

    const full = await llm.chatStream(
      [{ role: 'user', content: 'hi' }],
      { onDelta: (t) => deltas.push(t) },
    )

    expect(deltas).toEqual(['{"summary"', ':"正常"}'])
    expect(full).toBe('{"summary":"正常"}')
  })

  it('SSE 行被拆到多个 chunk 中间时仍能正确解析', async () => {
    const { llm } = await import('../api/lib/llm.ts')
    const deltas: string[] = []
    const line1 = deltaLine('第一段')
    const line2 = deltaLine('第二段')
    // 把两行 SSE 按字节随意切碎，模拟网络分包
    const raw = encoder.encode(line1 + line2)
    const cut = Math.floor(raw.length / 3)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(raw.slice(0, cut))
        controller.enqueue(raw.slice(cut, cut * 2))
        controller.enqueue(raw.slice(cut * 2))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })))

    const full = await llm.chatStream([{ role: 'user', content: 'hi' }], { onDelta: (t) => deltas.push(t) })

    expect(deltas).toEqual(['第一段', '第二段'])
    expect(full).toBe('第一段第二段')
  })

  it('流为空时抛出 502', async () => {
    const { llm } = await import('../api/lib/llm.ts')
    const { ApiError } = await import('../api/lib/utils.ts')
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: [DONE]\n\n'])))

    await expect(llm.chatStream([{ role: 'user', content: 'hi' }])).rejects.toThrow(ApiError)
  })

  it('未配置 LLM 时抛出 503', async () => {
    vi.stubEnv('LLM_API_KEY', '')
    const { llm } = await import('../api/lib/llm.ts')

    await expect(llm.chatStream([{ role: 'user', content: 'hi' }])).rejects.toThrow('AI 服务未配置')
  })
})
