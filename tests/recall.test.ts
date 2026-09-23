import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  return { default: createTestDb() }
})

import db from '../api/db.ts'
import { genId, seedUser, seedProject, seedOpLog } from './helpers/test-db'
import { opLogRepo } from '../api/repository/repo.ts'
import { cosineSimilarity, extractKeywords, rankRecallHits, rerankByEmbedding, type RecallCandidate } from '../api/lib/recall.ts'

describe('extractKeywords', () => {
  it('中文按词典分词、英文按单词切分并去重', () => {
    // zh 词典将「打印机」切为「打印」+「机」（单字被过滤）；「打印」仍能 LIKE 命中台账中的「打印机」
    expect(extractKeywords('打印机故障，网络异常；打印机故障')).toEqual(['打印', '故障', '网络', '异常'])
  })

  it('无标点自然语言长句也能提取出有效关键词（回归：旧实现整句超长被丢弃导致召回恒空）', () => {
    const out = extractKeywords('月结时Sharepoint上报表合计不一致怎么处理')
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('报表')
    expect(out).toContain('合计')
    expect(out).toContain('Sharepoint')
    expect(out).not.toContain('怎么') // 停用词被过滤
    expect(out).not.toContain('月结时Sharepoint上报表合计不一致怎么处理') // 不会把整句当关键词
  })

  it('过滤单字、纯数字与停用词', () => {
    const out = extractKeywords('服务器 a 4.1.9 是否异常，需要处理吗')
    expect(out).not.toContain('a')
    expect(out).not.toContain('是否')
    expect(out).not.toContain('需要')
    expect(out.join()).not.toMatch(/(^|,)(4|1|9)(,|$)/)
  })

  it('最多返回 8 个关键词', () => {
    const out = extractKeywords('alpha beta gamma delta epsilon zeta eta theta iota kappa')
    expect(out.length).toBe(8)
  })
})

describe('rankRecallHits', () => {
  const cand = (over: Partial<RecallCandidate>): RecallCandidate => ({
    id: genId(),
    projectId: null,
    system: '',
    category: '',
    problem: '',
    detail: '',
    cause: '',
    solution: '',
    logDate: '2026-01-01',
    ...over,
  })

  it('问题标题命中权重高于详细描述命中', () => {
    const a = cand({ problem: '数据库连接池打满导致服务超时' })
    const b = cand({ problem: '服务超时', detail: '数据库连接池打满' })
    const hits = rankRecallHits([a, b], ['连接池'])
    expect(hits[0].log.id).toBe(a.id)
    expect(hits[0].rawScore).toBeGreaterThan(hits[1].rawScore)
  })

  it('同项目/同系统上下文加权生效', () => {
    const a = cand({ problem: '订单导出失败', projectId: 'p1', system: '订单系统' })
    const b = cand({ problem: '订单导出失败', projectId: 'p2', system: '库存系统' })
    const hits = rankRecallHits([b, a], ['订单导出'], { projectId: 'p1', system: '订单系统' })
    expect(hits[0].log.id).toBe(a.id)
  })

  it('零命中的候选被剔除，分数归一化到 0~1', () => {
    const a = cand({ problem: '数据库连接池打满' })
    const b = cand({ problem: '完全无关的问题' })
    const hits = rankRecallHits([a, b], ['连接池'])
    expect(hits.length).toBe(1)
    expect(hits[0].score).toBe(1)
  })

  it('空关键词返回空数组', () => {
    expect(rankRecallHits([cand({ problem: 'x' })], [])).toEqual([])
  })
})

describe('opLogRepo.recall', () => {
  let userId: string, projectId: string

  beforeEach(() => {
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    userId = seedUser(db, { email: 'recall@pm.dev', name: '召回测试' })
    projectId = seedProject(db, userId, { name: '召回项目' })
  })

  it('只召回已闭环（已完成/已关闭）的台账', () => {
    const closed = seedOpLog(db, userId, { problem: '数据库连接池打满', status: '已完成' })
    seedOpLog(db, userId, { problem: '数据库连接池打满', status: '处理中' })
    seedOpLog(db, userId, { problem: '数据库连接池打满', status: '待处理' })

    const hits = opLogRepo.recall({ keywords: ['连接池'] })
    expect(hits.map((h) => h.log.id)).toEqual([closed])
  })

  it('软删除的台账不参与召回', () => {
    const dead = genId()
    seedOpLog(db, userId, { id: dead, problem: '数据库连接池打满' })
    db.prepare('UPDATE op_logs SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), dead)

    expect(opLogRepo.recall({ keywords: ['连接池'] })).toEqual([])
  })

  it('同项目候选带项目加成并排在前面', () => {
    const inProject = seedOpLog(db, userId, {
      projectId,
      problem: '订单系统导出报表报错',
      detail: '其他项目里也出现过导出报错',
    })
    seedOpLog(db, userId, { problem: '其他项目导出报表报错' })

    const hits = opLogRepo.recall({ keywords: ['导出报表'], projectId })
    expect(hits[0].log.id).toBe(inProject)
  })

  it('limit 生效', () => {
    for (let i = 0; i < 5; i++) {
      seedOpLog(db, userId, { problem: `打印机故障案例${i}` })
    }
    expect(opLogRepo.recall({ keywords: ['打印机'], limit: 3 }).length).toBe(3)
  })

  it('空关键词直接返回空数组', () => {
    seedOpLog(db, userId, { problem: '数据库连接池打满' })
    expect(opLogRepo.recall({ keywords: [] })).toEqual([])
  })
})

describe('cosineSimilarity', () => {
  it('同向为 1，正交为 0，反向为 -1', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 3])).toBe(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1)
  })

  it('零向量或长度不一致返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0)
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })
})

describe('rerankByEmbedding', () => {
  const cand = (id: string, problem: string): RecallCandidate => ({
    id, projectId: null, system: '', category: '', problem,
    detail: '', cause: '', solution: '', logDate: '2026-01-01',
  })

  it('向量相似度把语义相近的案例排到前面', () => {
    const a = { log: cand('a', '登录报 500'), rawScore: 4, score: 0.5, matchedKeywords: ['登录'] }
    const b = { log: cand('b', '缓存服务异常'), rawScore: 4, score: 0.5, matchedKeywords: ['登录'] }
    // 查询向量与 a 更相近
    const vectors = new Map([['a', [1, 0.9]], ['b', [0.1, 1]]])
    const out = rerankByEmbedding([1, 0.8], [a, b], vectors, 2)
    expect(out[0].log.id).toBe('a')
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })

  it('截取 topK，向量缺失的案例按余弦 0 处理仍保留关键词分', () => {
    const a = { log: cand('a', '登录报 500'), rawScore: 4, score: 1, matchedKeywords: ['登录'] }
    const b = { log: cand('b', '登录超时'), rawScore: 2, score: 0.5, matchedKeywords: ['登录'] }
    const out = rerankByEmbedding([1, 1], [a, b], new Map(), 1)
    expect(out.length).toBe(1)
    expect(out[0].log.id).toBe('a')
    expect(out[0].score).toBe(0.5) // (1 + 0) / 2
  })
})

describe('opLogRepo 向量缓存', () => {
  let userId: string

  beforeEach(() => {
    db.prepare('DELETE FROM op_log_embeddings').run()
    db.prepare('DELETE FROM op_logs').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()
    userId = seedUser(db, { email: 'embed@pm.dev', name: '向量测试' })
  })

  it('saveEmbeddings 写入后 getEmbeddings 按 model 读取', () => {
    const id = seedOpLog(db, userId, { problem: '数据库连接池打满' })
    opLogRepo.saveEmbeddings([{ logId: id, model: 'm1', vector: [0.1, 0.2] }])
    expect(opLogRepo.getEmbeddings([id], 'm1').get(id)).toEqual([0.1, 0.2])
    // 模型不匹配时不返回（换模型自动失效）
    expect(opLogRepo.getEmbeddings([id], 'm2').has(id)).toBe(false)
  })

  it('update 后缓存失效', () => {
    const id = seedOpLog(db, userId, { problem: '数据库连接池打满' })
    opLogRepo.saveEmbeddings([{ logId: id, model: 'm1', vector: [0.1, 0.2] }])
    opLogRepo.update(id, { problem: '连接池打满导致超时' })
    expect(opLogRepo.getEmbeddings([id], 'm1').has(id)).toBe(false)
  })

  it('softDelete 后缓存失效', () => {
    const id = seedOpLog(db, userId, { problem: '数据库连接池打满' })
    opLogRepo.saveEmbeddings([{ logId: id, model: 'm1', vector: [0.1, 0.2] }])
    opLogRepo.softDelete(id)
    expect(opLogRepo.getEmbeddings([id], 'm1').has(id)).toBe(false)
  })

  it('重复写入覆盖旧向量，损坏的缓存行被忽略', () => {
    const id = seedOpLog(db, userId, { problem: '数据库连接池打满' })
    opLogRepo.saveEmbeddings([{ logId: id, model: 'm1', vector: [0.1] }])
    opLogRepo.saveEmbeddings([{ logId: id, model: 'm1', vector: [0.9] }])
    expect(opLogRepo.getEmbeddings([id], 'm1').get(id)).toEqual([0.9])

    db.prepare("UPDATE op_log_embeddings SET vector = '{broken' WHERE log_id = ?").run(id)
    expect(opLogRepo.getEmbeddings([id], 'm1').has(id)).toBe(false)
  })
})
