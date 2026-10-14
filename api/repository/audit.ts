// 全量操作审计（v1.10.0）
// 设计：Express 中间件兜底记录所有非 GET 请求（谁、何时、对什么、结果），
// 配合 mapRequestToAudit 把请求映射为业务语义（模块/动作/对象），分类可查。
// 已有的 task_history / activity_log / system_activity_log 是业务展示层，继续保留。

import { type Request, type Response, type NextFunction } from 'express'
import db, { type SqlRow, type SqlParam } from '../db.ts'
import { genId } from '../lib/utils.ts'
import { userRepo } from './repo.ts'
import type { AuthRequest } from '../lib/auth.ts'
import type { AuditLog, AuditQuery } from '../../shared/types.ts'

/** 路径首段 → 业务模块 */
const MODULE_MAP: Record<string, string> = {
  auth: 'auth',
  projects: 'project',
  tasks: 'task',
  subtasks: 'task',
  hours: 'hours',
  budgets: 'budget',
  expenses: 'expense',
  stats: 'stats',
  team: 'user',
  users: 'user',
  roles: 'role',
  categories: 'category',
  notifications: 'notification',
  messages: 'message',
  templates: 'template',
  attachments: 'attachment',
  export: 'export',
  feishu: 'feishu',
  backup: 'backup',
  'op-logs': 'ledger',
  audit: 'audit',
}

function looksLikeId(s?: string): boolean {
  return !!s && /^[0-9a-zA-Z][0-9a-zA-Z_-]{10,}$/.test(s)
}

// 常见动词子段（/:id/verb）：作为动作名；否则视为子资源集合，POST 按 create 计
const ACTION_VERBS = new Set([
  'trash', 'restore', 'complete', 'reopen', 'sync', 'import', 'copy', 'transfer',
  'archive', 'reorder', 'read', 'send', 'retry', 'cancel', 'activate', 'deactivate',
])

/**
 * 请求 → 业务语义（纯函数，便于单测）
 * - POST /api/op-logs            → ledger/create
 * - DELETE /api/op-logs/:id      → ledger/delete（targetId=:id）
 * - POST /api/tasks/:id/trash    → task/trash（targetId=:id，动词子段作为动作）
 * - POST /api/auth/login         → auth/login
 * - PUT  /api/projects/:id       → project/update
 */
export function mapRequestToAudit(method: string, pathname: string): { module: string; action: string; targetId: string | null } {
  const seg = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const head = seg[0] || ''
  const module = MODULE_MAP[head] || head || 'system'
  const last = seg[seg.length - 1] || ''
  const prev = seg[seg.length - 2] || ''

  // auth 的第二段即动作（login/logout/register/change-password），登录轨迹按邮箱检索
  if (module === 'auth' && seg.length >= 2) {
    return { module, action: seg[1], targetId: null }
  }

  let action: string
  if (method === 'POST') {
    // POST 且存在动词子段（/:id/verb）：以动词为动作；否则视为新建
    action = seg.length >= 3 && looksLikeId(prev) && ACTION_VERBS.has(last) ? last : 'create'
  } else if (method === 'DELETE') {
    action = 'delete'
  } else if (method === 'PUT' || method === 'PATCH') {
    action = 'update'
  } else {
    action = 'call'
  }

  // 对象 id：无动词子段时取末段；有动词子段时取倒数第二段
  const targetId = seg.length >= 3 && looksLikeId(prev) ? prev : seg.length === 2 && looksLikeId(last) ? last : null
  return { module, action, targetId }
}

export const auditRepo = {
  record(e: {
    userId?: string | null
    userName?: string
    method: string
    path: string
    module: string
    action: string
    targetId?: string | null
    statusCode: number
    detail?: string | null
    ip?: string | null
  }): void {
    db.prepare(`INSERT INTO audit_logs (id, user_id, user_name, method, path, module, action, target_id, status_code, detail, ip, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        genId(), e.userId || null, e.userName || '未登录', e.method, e.path,
        e.module, e.action, e.targetId || null, e.statusCode, e.detail || null,
        e.ip || null, new Date().toISOString(),
      )
  },

  query(filter: AuditQuery): { rows: AuditLog[]; total: number } {
    const where: string[] = []
    const params: SqlParam[] = []
    if (filter.userId) { where.push('user_id = ?'); params.push(filter.userId) }
    if (filter.module) { where.push('module = ?'); params.push(filter.module) }
    if (filter.action) { where.push('action = ?'); params.push(filter.action) }
    if (filter.dateFrom) { where.push('created_at >= ?'); params.push(filter.dateFrom) }
    if (filter.dateTo) { where.push('created_at <= ?'); params.push(filter.dateTo) }
    if (filter.keyword) {
      const kw = `%${filter.keyword}%`
      where.push('(user_name LIKE ? OR path LIKE ? OR module LIKE ? OR action LIKE ? OR target_id LIKE ?)')
      params.push(kw, kw, kw, kw, kw)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_logs ${whereSql}`).get(...params) as { c: number }).c
    const page = Math.max(1, filter.page || 1)
    const pageSize = Math.min(200, Math.max(1, filter.pageSize || 50))
    const rows = db.prepare(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    ).all(...params, pageSize, (page - 1) * pageSize) as SqlRow[]
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id as string,
        userId: (r.user_id as string | null) ?? null,
        userName: r.user_name as string,
        method: r.method as string,
        path: r.path as string,
        module: r.module as string,
        action: r.action as string,
        targetId: (r.target_id as string | null) ?? null,
        statusCode: r.status_code as number,
        detail: (r.detail as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
        createdAt: r.created_at as string,
      })),
    }
  },

  /** 近 N 天按模块聚合（管理页顶部的分类概览） */
  stats(days = 30): Array<{ module: string; count: number }> {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const rows = db.prepare(
      'SELECT module, COUNT(*) count FROM audit_logs WHERE created_at >= ? GROUP BY module ORDER BY count DESC',
    ).all(since) as { module: string; count: number }[]
    return rows
  },
}

/**
 * 全局审计中间件：记录所有非 GET 请求（含 4xx/5xx，越权与异常尝试同样有价值）。
 * 登录类请求以 body.email 作为身份线索；绝不落 password 等敏感字段。
 */
export function auditMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method === 'GET') return next()
  res.on('finish', () => {
    try {
      const { module, action, targetId } = mapRequestToAudit(req.method, req.originalUrl.split('?')[0])
      let userName = '未登录'
      let detail: string | null = null
      const bodyEmail = typeof req.body?.email === 'string' ? req.body.email : null
      if (module === 'auth' && bodyEmail) {
        // 登录/注册/改密：身份线索用邮箱（此时 token 尚未验证，req.userId 为空）
        userName = bodyEmail
        detail = JSON.stringify({ email: bodyEmail, ok: res.statusCode < 400 })
      } else if (req.userId) {
        userName = userRepo.findById(req.userId)?.name || req.userId
      }
      auditRepo.record({
        userId: req.userId || null,
        userName,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        module,
        action,
        targetId,
        statusCode: res.statusCode,
        detail,
        ip: req.ip || null,
      })
    } catch (e) {
      // 审计失败不影响业务响应
      console.error('[audit] 记录失败:', e)
    }
  })
  next()
}
