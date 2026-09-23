// 台账经验召回：关键词提取与加权评分（纯函数，便于单测）
// P1 策略：双路召回（候选集 + 关键词 LIKE 全文扩展）+ 可选 embedding 语义重排（配合 LLM_EMBED_*）

export interface RecallCandidate {
  id: string
  projectId: string | null
  system: string
  category: string
  problem: string
  detail: string
  cause: string
  solution: string
  logDate: string
}

export interface RecallHit {
  log: RecallCandidate
  /** 0~1 归一化匹配度（相对最高分） */
  score: number
  /** 原始加权分 */
  rawScore: number
  /** 命中的关键词 */
  matchedKeywords: string[]
}

// 字段命中权重：问题标题命中权重最高，系统/原因/方案次之，详细描述最低
const FIELD_WEIGHTS: Array<{ field: keyof RecallCandidate; weight: number }> = [
  { field: 'problem', weight: 4 },
  { field: 'system', weight: 2 },
  { field: 'cause', weight: 2 },
  { field: 'solution', weight: 2 },
  { field: 'detail', weight: 1 },
]

// 业务上下文加权：同项目经验 > 同系统 > 同分类
const BONUS_SAME_PROJECT = 3
const BONUS_SAME_SYSTEM = 2
const BONUS_SAME_CATEGORY = 1
// 近 90 天的记录额外加成（经验时效性）
const RECENT_DAYS = 90
const BONUS_RECENT = 0.5

// 中文/英文混合分词：Node 内置 Intl.Segmenter（zh 词典级，零依赖）。
// 旧实现只按标点切分：无标点的自然语言整句会被当成一个关键词（或不满足长度上限被整体丢弃），
// LIKE 召回因此几乎必然为空，AI 永远拿不到台账案例、只能给通用建议（表现为回答千篇一律像模板）。
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

// 无检索价值的虚词/疑问词/高频泛词；保留「故障/超时/异常」等有业务含义的词
const STOPWORDS = new Set([
  '怎么', '怎样', '如何', '为什么', '什么', '是否', '请问', '帮忙', '麻烦',
  '可以', '需要', '应该', '出现', '导致', '进行', '一下', '然后', '还是',
  '以及', '这个', '那个', '没有', '问题', '现在', '目前', '时候', '之后',
])

/** 分词提取检索关键词：中文按词典切词、英文按单词，过滤单字/纯数字/停用词，去重后最多 8 个 */
export function extractKeywords(text: string): string[] {
  const words: string[] = []
  for (const s of segmenter.segment(text)) {
    if (!s.isWordLike) continue
    const w = s.segment
    if (w.length < 2 || STOPWORDS.has(w)) continue
    if (/^\d+$/.test(w)) continue // 纯数字无检索价值
    words.push(w)
  }
  return [...new Set(words)].slice(0, 8)
}

/** 对候选台账按关键词命中字段 + 业务上下文加权评分，归一化后按分数降序返回（零命中的候选被剔除） */
export function rankRecallHits(
  candidates: RecallCandidate[],
  keywords: string[],
  ctx: { projectId?: string; system?: string; category?: string } = {},
): RecallHit[] {
  const kw = keywords.map((k) => k.toLowerCase()).filter(Boolean)
  if (kw.length === 0) return []
  const recentCutoff = Date.now() - RECENT_DAYS * 86400000

  const hits: RecallHit[] = []
  for (const log of candidates) {
    const matched: string[] = []
    let raw = 0
    for (const k of kw) {
      let kwScore = 0
      for (const { field, weight } of FIELD_WEIGHTS) {
        const v = String(log[field] || '')
        if (v && v.toLowerCase().includes(k)) kwScore += weight
      }
      if (kwScore > 0) {
        raw += kwScore
        matched.push(k)
      }
    }
    if (raw === 0) continue
    if (ctx.projectId && log.projectId === ctx.projectId) raw += BONUS_SAME_PROJECT
    if (ctx.system && log.system && log.system === ctx.system) raw += BONUS_SAME_SYSTEM
    if (ctx.category && log.category && log.category === ctx.category) raw += BONUS_SAME_CATEGORY
    if (log.logDate && new Date(log.logDate).getTime() >= recentCutoff) raw += BONUS_RECENT
    hits.push({ log, rawScore: raw, score: 0, matchedKeywords: matched })
  }

  hits.sort((a, b) => b.rawScore - a.rawScore)
  const max = hits[0]?.rawScore || 1
  return hits.map((h) => ({ ...h, score: Math.round((h.rawScore / max) * 100) / 100 }))
}

/** 余弦相似度；零向量或长度不一致返回 0 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/**
 * embedding 语义重排：把关键词召回分与向量余弦相似度各按 50% 融合后降序，截取 topK。
 * 向量缺失的案例按余弦 0 处理（仍保留关键词分）。分数重新归一到 0~1。
 */
export function rerankByEmbedding(
  queryVector: number[],
  hits: RecallHit[],
  vectors: Map<string, number[]>,
  topK: number,
): RecallHit[] {
  const fused = hits.map((h) => {
    const vec = vectors.get(h.log.id)
    const cos = vec ? Math.max(0, cosineSimilarity(queryVector, vec)) : 0
    return { ...h, score: Math.round(((h.score + cos) / 2) * 100) / 100 }
  })
  fused.sort((a, b) => b.score - a.score)
  return fused.slice(0, topK)
}
