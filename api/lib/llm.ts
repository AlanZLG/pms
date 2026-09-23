// LLM 薄封装：任意 OpenAI 兼容协议的模型服务（chat completions）
// 未配置 LLM_BASE_URL / LLM_API_KEY / LLM_CHAT_MODEL 时 enabled() 为 false，AI 功能自动隐藏

import dotenv from 'dotenv'
dotenv.config()

import { ApiError } from './utils.ts'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const BASE_URL = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '')
const API_KEY = process.env.LLM_API_KEY || ''
const CHAT_MODEL = process.env.LLM_CHAT_MODEL || ''
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000

// embedding 配置（可选，用于召回结果语义重排）：未单独配置时回落到 chat 服务的地址与密钥
const EMBED_BASE_URL = (process.env.LLM_EMBED_BASE_URL || BASE_URL).replace(/\/+$/, '')
const EMBED_API_KEY = process.env.LLM_EMBED_API_KEY || API_KEY
const EMBED_MODEL = process.env.LLM_EMBED_MODEL || ''

export const llm = {
  enabled(): boolean {
    return Boolean(BASE_URL && API_KEY && CHAT_MODEL)
  },

  chatModel(): string {
    return CHAT_MODEL
  },

  /** embedding 服务是否可用（LLM_EMBED_MODEL 未配置时关闭，召回退回纯关键词排序） */
  embedEnabled(): boolean {
    return Boolean(EMBED_BASE_URL && EMBED_API_KEY && EMBED_MODEL)
  },

  embedModel(): string {
    return EMBED_MODEL
  },

  /** 批量向量化（OpenAI 兼容 /embeddings）；单条文本截断到 1000 字符，返回顺序与输入一致 */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedEnabled()) {
      throw new ApiError(503, 'embedding 服务未配置（LLM_EMBED_MODEL）')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${EMBED_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMBED_API_KEY}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => t.slice(0, 1000)) }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new ApiError(502, `embedding 服务调用失败(${res.status})${text ? ': ' + text.slice(0, 200) : ''}`)
      }
      const data = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> }
      const list = (data.data || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0))
      if (list.length !== texts.length || list.some((d) => !Array.isArray(d.embedding))) {
        throw new ApiError(502, 'embedding 服务返回数据不完整')
      }
      return list.map((d) => d.embedding as number[])
    } catch (e) {
      if (e instanceof ApiError) throw e
      if ((e as Error).name === 'AbortError') throw new ApiError(504, 'embedding 服务响应超时')
      throw new ApiError(502, `embedding 服务调用失败: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  },

  /** 调用 chat completions；jsonMode 时请求 JSON 输出，解析失败由调用方降级处理 */
  async chat(messages: LlmMessage[], opts: { jsonMode?: boolean; maxTokens?: number } = {}): Promise<string> {
    if (!this.enabled()) {
      throw new ApiError(503, 'AI 服务未配置（LLM_BASE_URL / LLM_API_KEY / LLM_CHAT_MODEL）')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages,
          temperature: 0.3,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new ApiError(502, `AI 服务调用失败(${res.status})${text ? ': ' + text.slice(0, 200) : ''}`)
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new ApiError(502, 'AI 服务返回内容为空')
      return content
    } catch (e) {
      if (e instanceof ApiError) throw e
      if ((e as Error).name === 'AbortError') throw new ApiError(504, 'AI 服务响应超时')
      throw new ApiError(502, `AI 服务调用失败: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  },

  /** 流式调用 chat completions（SSE），逐段回调 onDelta，返回完整文本。解析失败由调用方降级处理 */
  async chatStream(
    messages: LlmMessage[],
    opts: { jsonMode?: boolean; maxTokens?: number; signal?: AbortSignal; onDelta?: (text: string) => void } = {},
  ): Promise<string> {
    if (!this.enabled()) {
      throw new ApiError(503, 'AI 服务未配置（LLM_BASE_URL / LLM_API_KEY / LLM_CHAT_MODEL）')
    }
    const controller = new AbortController()
    // 空闲超时：每收到一段数据就重置计时，仅当流停滞（无任何字节）超过 TIMEOUT_MS 才中止，
    // 避免长回答或思维链模型先推理后输出时被固定总时长误杀
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const resetTimer = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    }
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort()
      else opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages,
          temperature: 0.3,
          stream: true,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new ApiError(502, `AI 服务调用失败(${res.status})${text ? ': ' + text.slice(0, 200) : ''}`)
      }
      if (!res.body) throw new ApiError(502, 'AI 服务未返回流式内容')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let full = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        resetTimer()
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const data = t.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
            const delta = json.choices?.[0]?.delta?.content || ''
            if (delta) {
              full += delta
              opts.onDelta?.(delta)
            }
          } catch {
            // 忽略无法解析的非 JSON 行（如注释、空行）
          }
        }
      }
      if (!full) throw new ApiError(502, 'AI 服务流式返回内容为空')
      return full
    } catch (e) {
      if (e instanceof ApiError) throw e
      if ((e as Error).name === 'AbortError') throw new ApiError(504, 'AI 服务响应超时')
      throw new ApiError(502, `AI 服务调用失败: ${(e as Error).message}`)
    } finally {
      if (timer) clearTimeout(timer)
    }
  },
}
