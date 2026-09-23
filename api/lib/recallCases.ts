// 召回服务（analyze / analyze-stream / chat-stream 共用）：双路召回 + 可选 embedding 语义重排
// 从 routes/opLogs.ts 抽出，供多个 AI 端点复用

import { opLogRepo } from '../repository/repo.ts'
import { llm } from './llm.ts'
import { extractKeywords, rerankByEmbedding, type RecallHit } from './recall.ts'

/** 拼接台账 embedding 输入文本：问题标题优先，附详细描述/原因/方案 */
export function opLogEmbedText(log: { problem: string; detail: string; cause: string; solution: string }): string {
  return `问题:${log.problem}\n描述:${log.detail}\n原因:${log.cause}\n解决:${log.solution}`.slice(0, 1000)
}

/**
 * 召回 + 可选 embedding 语义重排。
 * 未配置 LLM_EMBED_MODEL 或召回结果过少时，直接使用关键词排序；
 * embedding 调用失败时静默降级为关键词排序结果，不影响分析可用性。
 */
export async function recallCases(input: {
  problem: string
  topK: number
  projectId?: string
  detail?: string
  system?: string
  category?: string
}): Promise<RecallHit[]> {
  const keywords = extractKeywords(`${input.problem} ${input.detail || ''} ${input.system || ''}`)
  const useEmbed = llm.embedEnabled()
  const cases = opLogRepo.recall({
    keywords,
    projectId: input.projectId,
    system: input.system,
    category: input.category,
    // 启用向量重排时扩大候选集（重排后才截 topK），否则直接按 topK 返回
    limit: useEmbed ? Math.min(Math.max(input.topK * 4, 16), 30) : input.topK,
  })
  if (!useEmbed || cases.length < 2) return cases.slice(0, input.topK)

  try {
    const model = llm.embedModel()
    const [queryVec] = await llm.embed([`${input.problem} ${input.detail || ''} ${input.system || ''}`.slice(0, 1000)])
    const vectors = opLogRepo.getEmbeddings(cases.map((c) => c.log.id), model)
    const missing = cases.filter((c) => !vectors.has(c.log.id))
    if (missing.length > 0) {
      const embs = await llm.embed(missing.map((c) => opLogEmbedText(c.log)))
      missing.forEach((c, i) => vectors.set(c.log.id, embs[i]))
      // 现算结果写入缓存，下次召回直接复用
      opLogRepo.saveEmbeddings(missing.map((c, i) => ({ logId: c.log.id, model, vector: embs[i] })))
    }
    return rerankByEmbedding(queryVec, cases, vectors, input.topK)
  } catch {
    return cases.slice(0, input.topK)
  }
}

// 响应/SSE meta 共用的案例序列化
export const toAiCase = (c: RecallHit) => ({
  opLogId: c.log.id,
  problem: c.log.problem,
  cause: c.log.cause,
  solution: c.log.solution,
  system: c.log.system,
  category: c.log.category,
  projectId: c.log.projectId,
  score: c.score,
})
