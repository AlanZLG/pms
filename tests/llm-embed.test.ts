// llm.embed 测试：embeddings 端点解析、index 排序、未配置降级
// 注意：llm.ts 在模块加载时读取 LLM_* 环境变量，需先 stubEnv 再动态 import

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.stubEnv('LLM_BASE_URL', 'http://test.local/v1')
vi.stubEnv('LLM_API_KEY', 'test-key')
vi.stubEnv('LLM_CHAT_MODEL', 'test-model')

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('llm.embed', () => {
  it('未配置 LLM_EMBED_MODEL 时 embedEnabled 为 false 且调用抛 503', async () => {
    const { llm } = await import('../api/lib/llm.ts')
    expect(llm.embedEnabled()).toBe(false)
    await expect(llm.embed(['文本'])).rejects.toThrow('embedding 服务未配置')
  })

  it('配置 LLM_EMBED_MODEL 后按 index 排序返回向量', async () => {
    vi.stubEnv('LLM_EMBED_MODEL', 'test-embed')
    const { llm } = await import('../api/lib/llm.ts')
    expect(llm.embedEnabled()).toBe(true)
    expect(llm.embedModel()).toBe('test-embed')

    // 返回乱序 data，验证按 index 还原输入顺序
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        { index: 1, embedding: [0.4, 0.5] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    }), { status: 200 })))

    const vecs = await llm.embed(['第一条', '第二条'])
    expect(vecs).toEqual([[0.1, 0.2], [0.4, 0.5]])

    const fetchMock = vi.mocked(fetch)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string; input: string[] }
    expect(body.model).toBe('test-embed')
    expect(body.input).toEqual(['第一条', '第二条'])
  })

  it('LLM_EMBED_BASE_URL 未配置时回落到 LLM_BASE_URL', async () => {
    vi.stubEnv('LLM_EMBED_MODEL', 'test-embed')
    const { llm } = await import('../api/lib/llm.ts')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1] }],
    }), { status: 200 })))

    await llm.embed(['x'])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://test.local/v1/embeddings')
  })

  it('返回数据条数与输入不一致时抛 502', async () => {
    vi.stubEnv('LLM_EMBED_MODEL', 'test-embed')
    const { llm } = await import('../api/lib/llm.ts')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1] }],
    }), { status: 200 })))

    await expect(llm.embed(['a', 'b'])).rejects.toThrow('embedding 服务返回数据不完整')
  })
})
