import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { ScrollText, Search, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, Button, EmptyState } from '@/components/ui'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import type { AuditLog } from '../../shared/types'

// 模块与动作的中文展示（与后端 MODULE_MAP / mapRequestToAudit 对应）
const MODULES: Array<{ value: string; label: string }> = [
  { value: '', label: '全部模块' },
  { value: 'auth', label: '登录认证' },
  { value: 'project', label: '项目' },
  { value: 'task', label: '任务' },
  { value: 'ledger', label: '运维台账' },
  { value: 'hours', label: '工时' },
  { value: 'budget', label: '预算' },
  { value: 'expense', label: '费用' },
  { value: 'user', label: '人员' },
  { value: 'category', label: '工时类别' },
  { value: 'role', label: '角色权限' },
  { value: 'message', label: '站内消息' },
  { value: 'notification', label: '通知' },
  { value: 'template', label: '模板' },
  { value: 'attachment', label: '附件' },
  { value: 'export', label: '导出' },
  { value: 'backup', label: '备份' },
  { value: 'feishu', label: '飞书' },
  { value: 'stats', label: '统计' },
  { value: 'audit', label: '审计' },
]

const ACTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部动作' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'login', label: '登录' },
  { value: 'logout', label: '登出' },
  { value: 'register', label: '注册' },
]

const moduleLabel = (m: string) => MODULES.find((x) => x.value === m)?.label || m
const actionLabel = (a: string) => ACTIONS.find((x) => x.value === a)?.label || a

function statusColor(code: number): string {
  if (code < 300) return 'text-emerald-400'
  if (code < 400) return 'text-amber-400'
  return 'text-red-400'
}

export default function AuditLogs() {
  const user = useAppStore((s) => s.user)
  const [rows, setRows] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Array<{ module: string; count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 50

  // 筛选条件
  const [userId, setUserId] = useState('')
  const [module, setModule] = useState('')
  const [action, setAction] = useState('')
  const [keyword, setKeyword] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, st] = await Promise.all([
        api.listAuditLogs({ userId: userId || undefined, module: module || undefined, action: action || undefined, keyword: keyword || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, pageSize }),
        api.auditStats(),
      ])
      setRows(data.rows)
      setTotal(data.total)
      setStats(st.rows)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [userId, module, action, keyword, dateFrom, dateTo, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.listUsers().then((r) => setUsers(r.users.map((u) => ({ id: u.id, name: u.name })))).catch(() => {})
  }, [])

  const reset = () => {
    setUserId(''); setModule(''); setAction(''); setKeyword(''); setDateFrom(''); setDateTo('')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-brand" />
        <h1 className="font-display text-lg font-semibold text-text-primary">操作日志</h1>
        <span className="text-xs text-muted">全量写操作轨迹 · 含登录与异常尝试 · 仅管理员可见</span>
      </div>

      {/* 近 30 天模块概览 */}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.map((s) => (
            <button
              key={s.module}
              onClick={() => { setModule(s.module); setPage(1) }}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                module === s.module ? 'bg-brand/25 text-brand' : 'bg-bg-soft text-text-secondary hover:bg-brand/15'
              }`}
            >
              {moduleLabel(s.module)} · {s.count}
            </button>
          ))}
        </div>
      )}

      {/* 筛选栏 */}
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          账号
          <select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1) }} className="h-8 min-w-28 rounded-lg border border-border bg-bg-soft px-2 text-sm text-text-primary">
            <option value="">全部账号</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          模块
          <select value={module} onChange={(e) => { setModule(e.target.value); setPage(1) }} className="h-8 min-w-28 rounded-lg border border-border bg-bg-soft px-2 text-sm text-text-primary">
            {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          动作
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} className="h-8 min-w-24 rounded-lg border border-border bg-bg-soft px-2 text-sm text-text-primary">
            {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          开始日期
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="h-8 rounded-lg border border-border bg-bg-soft px-2 text-sm text-text-primary" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          结束日期
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="h-8 rounded-lg border border-border bg-bg-soft px-2 text-sm text-text-primary" />
        </label>
        <label className="flex flex-1 min-w-40 flex-col gap-1 text-xs text-muted">
          关键词（姓名/路径/对象）
          <div className="relative">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
              placeholder="如：nicole、op-logs、登录邮箱"
              className="h-8 w-full rounded-lg border border-border bg-bg-soft pl-8 pr-2 text-sm text-text-primary"
            />
          </div>
        </label>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重置
        </Button>
      </Card>

      {/* 日志表格 */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted">加载中…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="暂无记录" hint="当前筛选条件下没有操作日志" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2 font-normal">时间</th>
                  <th className="px-3 py-2 font-normal">操作人</th>
                  <th className="px-3 py-2 font-normal">模块</th>
                  <th className="px-3 py-2 font-normal">动作</th>
                  <th className="px-3 py-2 font-normal">对象</th>
                  <th className="px-3 py-2 font-normal">请求</th>
                  <th className="px-3 py-2 font-normal">结果</th>
                  <th className="px-3 py-2 font-normal">IP</th>
                  <th className="px-3 py-2 font-normal">详情</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-bg-soft/60">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{r.createdAt.replace('T', ' ').slice(0, 19)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-primary">{r.userName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{moduleLabel(r.module)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{actionLabel(r.action)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{r.targetId ? r.targetId.slice(0, 8) : '-'}</td>
                    <td className="max-w-72 truncate px-3 py-2 font-mono text-xs text-muted" title={r.path}>{r.method} {r.path}</td>
                    <td className={`px-3 py-2 font-mono text-xs ${statusColor(r.statusCode)}`}>{r.statusCode}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{r.ip || '-'}</td>
                    <td className="max-w-56 truncate px-3 py-2 font-mono text-xs text-muted" title={r.detail || ''}>{r.detail || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* 分页 */}
        {total > pageSize && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
            <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> 上一页
              </Button>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页 <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
