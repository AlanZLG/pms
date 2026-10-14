// 运维台账面板：列表 + 筛选 + 增删改 + Excel 导入/导出/模板下载
// 可独立使用（全量台账），也可传入 projectId 作为项目详情页的嵌入式面板

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Edit2,
  Trash2,
  Download,
  Upload,
  FileSpreadsheet,
  X,
  ChevronDown,
  BarChart3,
  Columns3,
  ListPlus,
  Link2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Sparkles,
  Copy,
  Bot,
  CheckCircle2,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button, Input, Textarea, EmptyState } from '@/components/ui'
import { cn } from '@/lib/utils'
import { toggleExpanded, showExpandHint } from '@/lib/problemExpand'
import { useAppStore } from '@/stores/app'
import AiChatDrawer from '@/components/AiChatDrawer'
import type { OpLog, OpLogFilter, OpLogStat, Project, Task, OpLogAiAnalyzeResponse, OpLogAiCase, OpLogExtraConfig } from '../../shared/types'
import { OP_LOG_MAX_EXTRA_COLUMNS } from '../../shared/types'

const STATUSES = ['待处理', '处理中', '暂停', '取消', '已完成', '已关闭']

// 工时汇总维度：默认按月，可切换按记录人/系统/部门/分类
type StatDim = 'month' | 'recorder' | 'system' | 'department' | 'category'
const STAT_DIMS: { key: StatDim; label: string }[] = [
  { key: 'month', label: '月份' },
  { key: 'recorder', label: '记录人' },
  { key: 'system', label: '系统' },
  { key: 'department', label: '部门' },
  { key: 'category', label: '分类' },
]

// 可排序列：key 对应后端 sortBy 白名单；dir 为首次点击时的默认方向
// 问题/解决方案列（长文本）与扩展字段列不提供排序
const SORTABLE_COLUMNS = [
  { key: 'logDate', label: '日期', defaultDir: 'desc' },
  { key: 'category', label: '分类', defaultDir: 'asc' },
  { key: 'status', label: '状态', defaultDir: 'asc' },
  { key: 'system', label: '系统', defaultDir: 'asc' },
  { key: 'department', label: '部门', defaultDir: 'asc' },
  { key: 'proposer', label: '提出人', defaultDir: 'asc' },
  { key: 'recorder', label: '记录人', defaultDir: 'asc' },
  { key: 'completionDate', label: '完成日', defaultDir: 'desc' },
  { key: 'hours', label: '工时', defaultDir: 'desc' },
  { key: 'createdAt', label: '登记日期', defaultDir: 'desc' },
] as const

const sortCol = (key: string) => SORTABLE_COLUMNS.find((c) => c.key === key)!

const statusStyle: Record<string, string> = {
  待处理: 'bg-danger/15 text-danger',
  处理中: 'bg-warn/15 text-warn',
  暂停: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  取消: 'bg-bg-border/40 text-muted',
  已完成: 'bg-ok/15 text-ok',
  已关闭: 'bg-bg-border/50 text-muted',
}

// ===== 列显示顺序自定义 =====
// 可调序列（序号永远第 1 列、操作永远最后，不在其中）；'extra:<字段名>' 为动态自定义列
const DEFAULT_COL_ORDER = [
  'logDate', 'category', 'status', 'project', 'system', 'department',
  'proposer', 'recorder', 'problem', 'solution', 'completionDate', 'hours', 'createdAt',
] as const
const COL_LABELS: Record<string, string> = {
  logDate: '日期', category: '分类', status: '状态', project: '项目', system: '系统',
  department: '部门', proposer: '提出人', recorder: '记录人', problem: '问题', solution: '解决方案',
  completionDate: '完成日', hours: '工时', createdAt: '登记日期',
}
const COL_ORDER_KEY = 'fortune:oplogs:colOrder'

// 冻结表头：滚动台账条目时表头吸顶（sticky 由各 th 携带，保证背景不透底）
const TH_STICKY = 'sticky top-0 z-10 border-b border-bg-border bg-bg-soft'

/** 读取本地持久化的列顺序（只保留已知标准列；自定义列由数据动态合并） */
function loadColOrder(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(COL_ORDER_KEY) || '[]')
    if (!Array.isArray(arr)) return [...DEFAULT_COL_ORDER]
    const known = new Set<string>(DEFAULT_COL_ORDER)
    return arr.filter((k: unknown) => typeof k === 'string' && known.has(k))
  } catch {
    return [...DEFAULT_COL_ORDER]
  }
}

interface OpLogsPanelProps {
  /** 固定项目上下文（项目详情页嵌入时传入）；不传则为全局台账模式 */
  projectId?: string
}

interface ExtraRow {
  key: string
  value: string
}

interface FormState {
  projectId: string
  category: string
  status: string
  proposer: string
  system: string
  department: string
  logDate: string
  recorder: string
  problem: string
  completionDate: string
  hours: string
  detail: string
  cause: string
  solution: string
  /** 关联任务 id；'' = 自动归集（落到项目「运维日常工作」任务） */
  taskId: string
}

// 状态为「已完成」时必须填写的经验字段（与后端导入/接口校验共用口径）
const COMPLETION_REQUIRED = [
  { key: 'detail', label: '详细描述' },
  { key: 'cause', label: '原因' },
  { key: 'solution', label: '解决方案' },
] as const

const emptyForm = (): FormState => ({
  projectId: '',
  category: '',
  status: '待处理',
  proposer: '',
  system: '',
  department: '',
  logDate: new Date().toISOString().slice(0, 10),
  recorder: '',
  problem: '',
  completionDate: '',
  hours: '',
  detail: '',
  cause: '',
  solution: '',
  taskId: '',
})

export default function OpLogsPanel({ projectId }: OpLogsPanelProps) {
  const notify = useAppStore((s) => s.notify)
  const currentUser = useAppStore((s) => s.user)
  const isEmbedded = Boolean(projectId)

  // ===== 筛选状态 =====
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    category: '',
    status: '',
    system: '',
    department: '',
    dateFrom: '',
    dateTo: '',
  })
  // 全局模式下的项目 Tab：项目ID / 'all'=全部台账（台账必须关联项目，无「未关联」视图）
  const [projectFilter, setProjectFilter] = useState<string>(projectId || 'all')

  // 当前生效的项目隔离上下文：'all' 表示跨项目全量视图
  const scopedProjectId = projectId || (projectFilter !== 'all' ? projectFilter : '')

  // 切换 Tab 时重置筛选，避免上个项目的筛选条件串到新项目
  useEffect(() => {
    setFilters({ category: '', status: '', system: '', department: '', dateFrom: '', dateTo: '' })
    setKeywordInput('')
  }, [projectFilter])

  // 关键词防抖
  useEffect(() => {
    const t = setTimeout(() => setKeyword(keywordInput.trim()), 350)
    return () => clearTimeout(t)
  }, [keywordInput])

  // 排序状态：默认按日期降序
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({ by: 'logDate', dir: 'desc' })

  const toggleSort = (key: string) => {
    setSort((s) => {
      if (s.by === key) return { by: key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      const col = SORTABLE_COLUMNS.find((c) => c.key === key)
      return { by: key, dir: (col?.defaultDir || 'desc') as 'asc' | 'desc' }
    })
  }

  const effectiveFilter = useMemo<OpLogFilter>(() => {
    const f: OpLogFilter = {}
    if (projectId) f.projectId = projectId
    else if (projectFilter !== 'all') f.projectId = projectFilter
    if (keyword) f.keyword = keyword
    if (filters.category) f.category = filters.category
    if (filters.status) f.status = filters.status
    if (filters.system) f.system = filters.system
    if (filters.department) f.department = filters.department
    if (filters.dateFrom) f.dateFrom = filters.dateFrom
    if (filters.dateTo) f.dateTo = filters.dateTo
    f.sortBy = sort.by
    f.sortDir = sort.dir
    return f
  }, [projectId, projectFilter, keyword, filters, sort])

  const logsData = useAsync(() => api.listOpLogs(effectiveFilter), [effectiveFilter])
  const statsData = useAsync(() => api.getOpLogStats(effectiveFilter), [effectiveFilter])
  const optionsData = useAsync(() => api.getOpLogOptions(scopedProjectId || undefined), [scopedProjectId])
  const projectsData = useAsync<Project[]>(() => api.listProjects().then((r) => r.projects), [])

  const logs: OpLog[] = useMemo(() => logsData.data?.logs ?? [], [logsData.data])
  const projects: Project[] = useMemo(() => projectsData.data ?? [], [projectsData.data])

  // 当前上下文项目的台账自定义列配置：启用时展示列/表单/导入导出均按定义的字段与顺序执行
  // （全局「全部台账」视图为跨项目混合数据，不启用配置，保持动态扩展列）
  const scopedProject = useMemo(
    () => (scopedProjectId ? projects.find((p) => p.id === scopedProjectId) || null : null),
    [projects, scopedProjectId],
  )
  const extraConfig: OpLogExtraConfig | null = scopedProject?.oplogExtraColumns?.enabled ? scopedProject.oplogExtraColumns : null
  // 自定义列 key → 显示名（配置模式取定义名；自由模式列名即数据键，回退自身）
  const extraLabels = useMemo(() => {
    const m = new Map<string, string>()
    if (extraConfig) for (const c of extraConfig.columns) m.set(c.key, c.label)
    return m
  }, [extraConfig])

  // 缺省 Tab：全局模式下项目列表首次加载后自动选中第一个项目（用户已手动切换过则不覆盖）
  const defaultPickedRef = useRef(isEmbedded)
  useEffect(() => {
    if (defaultPickedRef.current) return
    if (projects.length === 0) return
    defaultPickedRef.current = true
    setProjectFilter((cur) => (cur === 'all' ? projects[0].id : cur))
  }, [projects])
  const projectName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects) m.set(p.id, p.name)
    return (id: string | null) => (id ? m.get(id) || '未知项目' : '')
  }, [projects])

  // 「项目」列仅在跨项目视图（'all'）下显示
  const showProjectColumn = !isEmbedded && projectFilter === 'all'
  // 对话框中锁定项目归属：嵌入模式或选中具体项目 Tab 时不可更改（保证隔离）
  const lockProject = isEmbedded || (!isEmbedded && projectFilter !== 'all')

  // 收集当前结果中出现过的扩展字段（保持首次出现顺序；__ 前缀为系统隐藏字段如来源任务关联）
  // 配置模式下固定显示项目定义的自定义列（与数据是否已填写无关），顺序即配置顺序
  const extraKeys = useMemo(() => {
    if (extraConfig) return extraConfig.columns.map((c) => c.key)
    const keys: string[] = []
    for (const log of logs) {
      for (const k of Object.keys(log.extraFields || {})) {
        if (k.startsWith('__')) continue
        if (!keys.includes(k)) keys.push(k)
      }
    }
    return keys
  }, [logs, extraConfig])

  // ===== 列显示顺序（localStorage 持久化；序号永远第 1 列、操作永远最后） =====
  const [storedOrder, setStoredOrder] = useState<string[]>(loadColOrder)
  useEffect(() => {
    try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(storedOrder)) } catch { /* 隐私模式等场景忽略 */ }
  }, [storedOrder])
  // 实际渲染列序：持久化顺序 + 动态补充缺失的标准列/自定义列，并按当前视图过滤项目列
  const columnOrder = useMemo(() => {
    const valid = new Set<string>([...DEFAULT_COL_ORDER, ...extraKeys.map((k) => `extra:${k}`)])
    const order = storedOrder.filter((k) => valid.has(k))
    for (const k of DEFAULT_COL_ORDER) if (!order.includes(k)) order.push(k)
    for (const k of extraKeys) if (!order.includes(`extra:${k}`)) order.push(`extra:${k}`)
    return order.filter((k) => k !== 'project' || showProjectColumn)
  }, [storedOrder, extraKeys, showProjectColumn])
  // 列设置面板中展示的完整列清单（含项目列占位，便于全局模式下调整）
  const settingColumns = useMemo(() => {
    const valid = new Set<string>([...DEFAULT_COL_ORDER, ...extraKeys.map((k) => `extra:${k}`)])
    const order = storedOrder.filter((k) => valid.has(k))
    for (const k of DEFAULT_COL_ORDER) if (!order.includes(k)) order.push(k)
    for (const k of extraKeys) if (!order.includes(`extra:${k}`)) order.push(`extra:${k}`)
    return order
  }, [storedOrder, extraKeys])
  const moveCol = (key: string, dir: -1 | 1) => {
    setStoredOrder((prev) => {
      const valid = new Set<string>([...DEFAULT_COL_ORDER, ...extraKeys.map((k) => `extra:${k}`)])
      const arr = prev.filter((k) => valid.has(k))
      for (const k of DEFAULT_COL_ORDER) if (!arr.includes(k)) arr.push(k)
      for (const k of extraKeys) if (!arr.includes(`extra:${k}`)) arr.push(`extra:${k}`)
      const i = arr.indexOf(key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= arr.length) return arr
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
  }

  // 列表表头渲染（按自定义列序；吸顶冻结样式见 TH_STICKY）
  const renderTh = (key: string) => {
    if (key.startsWith('extra:')) {
      const k = key.slice(6)
      const label = extraLabels.get(k) || k
      return <th key={key} className={cn(TH_STICKY, 'whitespace-nowrap px-3 py-3 text-left font-medium')} title={`扩展字段：${label}`}>{label}</th>
    }
    switch (key) {
      case 'project':
        return <th key={key} className={cn(TH_STICKY, 'whitespace-nowrap px-3 py-3 text-left font-medium')}>项目</th>
      case 'problem':
        return <th key={key} className={cn(TH_STICKY, 'w-[280px] min-w-[280px] px-3 py-3 text-left font-medium')}>问题</th>
      case 'solution':
        return <th key={key} className={cn(TH_STICKY, 'w-[280px] min-w-[280px] px-3 py-3 text-left font-medium')}>解决方案</th>
      case 'hours':
        return <SortTh key={key} col={sortCol('hours')} sort={sort} onToggle={toggleSort} align="right" className={TH_STICKY} />
      case 'createdAt':
        return <SortTh key={key} col={sortCol('createdAt')} sort={sort} onToggle={toggleSort} className={TH_STICKY} />
      default:
        return <SortTh key={key} col={sortCol(key)} sort={sort} onToggle={toggleSort} className={TH_STICKY} />
    }
  }

  // 列表单元格渲染（按自定义列序；问题/解决方案支持点击展开与复制）
  const renderTd = (log: OpLog, key: string) => {
    if (key.startsWith('extra:')) {
      const k = key.slice(6)
      return (
        <td key={key} className="max-w-[160px] truncate px-3 py-3 text-text-secondary" title={log.extraFields[k] || ''}>
          {log.extraFields[k] || '-'}
        </td>
      )
    }
    switch (key) {
      case 'logDate':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.logDate || '-'}</td>
      case 'category':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.category || '-'}</td>
      case 'status':
        return (
          <td key={key} className="whitespace-nowrap px-3 py-3">
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusStyle[log.status] || 'bg-bg-border/40 text-muted')}>
              {log.status}
            </span>
          </td>
        )
      case 'project':
        return (
          <td key={key} className="max-w-[140px] truncate px-3 py-3 text-text-secondary" title={projectName(log.projectId)}>
            {log.projectId ? projectName(log.projectId) : <span className="text-muted">未关联</span>}
          </td>
        )
      case 'system':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.system || '-'}</td>
      case 'department':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.department || '-'}</td>
      case 'proposer':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.proposer || '-'}</td>
      case 'recorder':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.recorder || '-'}</td>
      case 'problem':
        return (
          <td
            key={key}
            className={cn('min-w-[280px] max-w-[280px] px-3 py-3 text-text-primary', !expandedCells.has(`${log.id}:problem`) && 'cursor-pointer')}
            onClick={() => {
              if (!log.problem) return
              setExpandedCells((prev) => toggleExpanded(prev, `${log.id}:problem`))
            }}
            title={expandedCells.has(`${log.id}:problem`) ? undefined : '点击查看完整内容'}
          >
            <div className={cn('break-all', !expandedCells.has(`${log.id}:problem`) && 'line-clamp-2')}>{log.problem}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              {showExpandHint(log.problem, expandedCells.has(`${log.id}:problem`)) && (
                <span className="text-xs text-brand-soft">展开</span>
              )}
              <button
                type="button"
                title="复制全文"
                className="text-muted transition hover:text-brand-soft"
                onClick={(e) => {
                  e.stopPropagation()
                  void navigator.clipboard.writeText(log.problem)
                  notify('success', '问题内容已复制')
                }}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            {log.extraFields?.__sourceTaskTitle && (
              <div
                className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand-soft"
                title={`来源任务: ${log.extraFields.__sourceTaskTitle}`}
              >
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{log.extraFields.__sourceTaskTitle}</span>
              </div>
            )}
          </td>
        )
      case 'solution':
        return (
          <td
            key={key}
            className={cn('min-w-[280px] max-w-[280px] px-3 py-3 text-text-primary', log.solution && !expandedCells.has(`${log.id}:solution`) && 'cursor-pointer')}
            onClick={() => {
              if (!log.solution) return
              setExpandedCells((prev) => toggleExpanded(prev, `${log.id}:solution`))
            }}
            title={log.solution ? (expandedCells.has(`${log.id}:solution`) ? undefined : '点击查看完整内容') : undefined}
          >
            <div className={cn('break-all', log.solution && !expandedCells.has(`${log.id}:solution`) && 'line-clamp-2')}>{log.solution || '-'}</div>
            {log.solution && (
              <div className="mt-0.5 flex items-center gap-1.5">
                {showExpandHint(log.solution, expandedCells.has(`${log.id}:solution`)) && (
                  <span className="text-xs text-brand-soft">展开</span>
                )}
                <button
                  type="button"
                  title="复制全文"
                  className="text-muted transition hover:text-brand-soft"
                  onClick={(e) => {
                    e.stopPropagation()
                    void navigator.clipboard.writeText(log.solution)
                    notify('success', '解决方案已复制')
                  }}
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            )}
          </td>
        )
      case 'completionDate':
        return <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary">{log.completionDate || '-'}</td>
      case 'hours':
        return (
          <td key={key} className="whitespace-nowrap px-3 py-3 text-right font-mono text-text-secondary">
            {log.hours ? (
              <span className="inline-flex items-center justify-end gap-1">
                {log.hours}h
                {log.hoursSynced ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="已入账任务工时" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-warn/60" aria-label="未入账" />
                )}
              </span>
            ) : (
              '-'
            )}
          </td>
        )
      case 'createdAt':
        return (
          <td key={key} className="whitespace-nowrap px-3 py-3 text-text-secondary" title={log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN') : ''}>
            {log.createdAt ? log.createdAt.slice(0, 10) : '-'}
          </td>
        )
      default:
        return null
    }
  }

  const totalHours = useMemo(() => logs.reduce((s, l) => s + (l.hours || 0), 0), [logs])
  // 已自动入账到任务工时（task_hours）的合计：仅统计填了工时的台账（保存后即入账）
  const syncedHours = useMemo(() => logs.reduce((s, l) => s + (l.hoursSynced ? l.hours || 0 : 0), 0), [logs])
  // 工时汇总（基于当前筛选结果的全部记录，前端聚合；空值归「未填」），默认按月（近月在前）
  const [statDim, setStatDim] = useState<StatDim>('month')
  const dimStats = useMemo(() => {
    const map = new Map<string, { count: number; hours: number }>()
    for (const log of logs) {
      let key: string
      if (statDim === 'month') key = (log.logDate || '').slice(0, 7) || '未填'
      else if (statDim === 'recorder') key = log.recorder?.trim() || '未填'
      else if (statDim === 'system') key = log.system?.trim() || '未填'
      else if (statDim === 'department') key = log.department?.trim() || '未填'
      else key = log.category?.trim() || '未填'
      const cur = map.get(key) || { count: 0, hours: 0 }
      cur.count += 1
      cur.hours += log.hours || 0
      map.set(key, cur)
    }
    return [...map.entries()]
      .map(([value, v]) => ({ value, ...v }))
      .sort((a, b) => (statDim === 'month' ? b.value.localeCompare(a.value) : b.hours - a.hours || b.count - a.count))
  }, [logs, statDim])
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (keyword ? 1 : 0)

  // ===== 统计表格状态 =====
  const [showStats, setShowStats] = useState(false)
  // 列设置面板显隐
  const [showColSettings, setShowColSettings] = useState(false)
  // 台账自定义列配置（项目级；仅项目负责人/管理员可改）
  const [extraCfgOpen, setExtraCfgOpen] = useState(false)
  const [extraCfgDraft, setExtraCfgDraft] = useState<{ enabled: boolean; columns: { key: string; label: string }[] }>({ enabled: false, columns: [] })
  const [extraCfgSaving, setExtraCfgSaving] = useState(false)
  const canConfigExtra = !!(scopedProject && currentUser && (currentUser.role === 'admin' || scopedProject.ownerId === currentUser.id))
  // 首次启用时从现有数据预填列定义（沿用数据键，保证历史数据无缝衔接）；已配置过则用已存定义
  const openExtraCfg = () => {
    if (!scopedProjectId) return
    const cur = scopedProject?.oplogExtraColumns
    setExtraCfgDraft(cur
      ? { enabled: cur.enabled, columns: cur.columns.map((c) => ({ ...c })) }
      : { enabled: false, columns: extraKeys.map((k) => ({ key: k, label: extraLabels.get(k) || k })) })
    setExtraCfgOpen(true)
  }
  const saveExtraCfg = async () => {
    if (!scopedProjectId) return
    try {
      setExtraCfgSaving(true)
      await api.updateProjectOplogColumns(scopedProjectId, {
        enabled: extraCfgDraft.enabled,
        columns: extraCfgDraft.columns.map((c) => ({ key: c.key, label: c.label.trim() })),
      })
      notify('success', extraCfgDraft.enabled ? '台账自定义列配置已保存' : '已停用台账自定义列（列定义保留）')
      setExtraCfgOpen(false)
      await projectsData.reload()
    } catch (err) {
      notify('error', getErrorMessage(err, '保存自定义列配置失败'))
    } finally {
      setExtraCfgSaving(false)
    }
  }
  const stats: OpLogStat[] = useMemo(() => statsData.data?.stats ?? [], [statsData.data])

  // ===== AI 排障助手（P2 对话式排障） =====
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [aiChatEnabled, setAiChatEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    // 未配置 LLM 时不显示入口
    api.getOpLogAiStatus().then((s) => { if (alive) setAiChatEnabled(s.enabled) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // 将扁平统计数据转换为 月份×分类 交叉表
  const { statMonths, statCategories, statMatrix, statTotals } = useMemo(() => {
    const months = [...new Set(stats.map((s) => s.month))].sort((a, b) => b.localeCompare(a))
    const categories = [...new Set(stats.map((s) => s.category))].sort()
    const matrix: Record<string, Record<string, { count: number; hours: number }>> = {}
    for (const m of months) matrix[m] = {}
    for (const s of stats) {
      if (!matrix[s.month][s.category]) matrix[s.month][s.category] = { count: 0, hours: 0 }
      matrix[s.month][s.category].count += s.count
      matrix[s.month][s.category].hours += s.hours
    }
    // 合计：每个分类的总条数/总工时
    const catTotals: Record<string, { count: number; hours: number }> = {}
    for (const c of categories) catTotals[c] = { count: 0, hours: 0 }
    let allCount = 0
    let allHours = 0
    for (const s of stats) {
      catTotals[s.category].count += s.count
      catTotals[s.category].hours += s.hours
      allCount += s.count
      allHours += s.hours
    }
    return {
      statMonths: months,
      statCategories: categories,
      statMatrix: matrix,
      statTotals: { byCategory: catTotals, count: allCount, hours: allHours },
    }
  }, [stats])

  const reloadAll = useCallback(() => {
    logsData.reload()
    statsData.reload()
    optionsData.reload()
  }, [logsData, statsData, optionsData])

  // ===== 新增/编辑对话框 =====
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<OpLog | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [extraRows, setExtraRows] = useState<ExtraRow[]>([])
  const [saving, setSaving] = useState(false)
  // AI 案例查看模式：从 AI 分析/AI 助手的参考案例打开台账时强制只读
  const [caseViewMode, setCaseViewMode] = useState(false)
  // 问题/解决方案列点击展开/收起（长文本默认折叠为 2 行），key 为 `${logId}:problem|solution`
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())

  // 表单生效的自定义列配置：跟随表单所选项目（全局模式「全部台账」下可切换项目归属）
  const formExtraConfig: OpLogExtraConfig | null = useMemo(() => {
    const p = form.projectId ? projects.find((x) => x.id === form.projectId) : null
    return p?.oplogExtraColumns?.enabled ? p.oplogExtraColumns : null
  }, [projects, form.projectId])

  // 按目标项目的自定义列配置构建表单扩展字段行（配置模式固定列、只填值；自由模式沿用数据键）
  const buildExtraRows = useCallback((pid: string, log?: OpLog): ExtraRow[] => {
    const p = pid ? projects.find((x) => x.id === pid) : null
    const cfg = p?.oplogExtraColumns?.enabled ? p.oplogExtraColumns : null
    if (cfg) return cfg.columns.map((c) => ({ key: c.key, value: log?.extraFields?.[c.key] ?? '' }))
    return Object.entries(log?.extraFields || {}).filter(([k]) => !k.startsWith('__')).map(([key, value]) => ({ key, value: String(value) }))
  }, [projects])

  // 表单中切换项目归属时，扩展字段行对齐到目标项目的自定义列定义（按 key 保留已填值）
  useEffect(() => {
    setExtraRows((prev) => {
      if (!formExtraConfig) return prev
      return formExtraConfig.columns.map((c) => ({ key: c.key, value: prev.find((r) => r.key === c.key)?.value ?? '' }))
    })
  }, [formExtraConfig])

  const openCreate = () => {
    const user = currentUser
    const targetPid = projectId || (projectFilter !== 'all' ? projectFilter : '')
    setEditing(null)
    setCaseViewMode(false)
    setForm({
      ...emptyForm(),
      // 新增默认归属：嵌入模式→固定项目；全局模式→当前 Tab 项目（'all' 时需手动选择，保存前强制校验）
      projectId: targetPid,
      recorder: user?.name || '',
    })
    setExtraRows(buildExtraRows(targetPid))
    setDialogOpen(true)
  }

  const openEdit = (log: OpLog, opts?: { caseView?: boolean }) => {
    // AI 案例入口（caseView）强制只读：参考案例仅用于查看，不提供任何修改入口
    setCaseViewMode(!!opts?.caseView)
    setEditing(log)
    setForm({
      projectId: log.projectId || '',
      category: log.category || '',
      status: log.status || '待处理',
      proposer: log.proposer || '',
      system: log.system || '',
      department: log.department || '',
      logDate: log.logDate || '',
      recorder: log.recorder || '',
      problem: log.problem || '',
      completionDate: log.completionDate || '',
      hours: log.hours ? String(log.hours) : '',
      detail: log.detail || '',
      cause: log.cause || '',
      solution: log.solution || '',
      taskId: log.taskId || '',
    })
    setExtraRows(buildExtraRows(log.projectId || '', log))
    setDialogOpen(true)
  }

  // 无台账编辑权限的角色（admin/owner 除外）只能只读查看
  const canEditOpLog =
    currentUser?.role === 'admin' ||
    currentUser?.role === 'owner' ||
    !!currentUser?.customRole?.permissions?.some((p) => p.key === 'oplog.edit')

  // 台账写入权限（v1.9.3，与后端守卫同口径）：登记/编辑须为项目负责人或项目成员；删除仅项目负责人；admin 全权
  const projectWritable = useCallback((pid: string | null | undefined) => {
    if (!pid || !currentUser) return false
    if (currentUser.role === 'admin') return true
    const p = projects.find((x) => x.id === pid)
    return !!p && (p.ownerId === currentUser.id || p.members.some((m) => m.userId === currentUser.id))
  }, [currentUser, projects])
  const projectOwned = useCallback((pid: string | null | undefined) => {
    if (!currentUser) return false
    if (currentUser.role === 'admin') return true
    if (!pid) return false
    const p = projects.find((x) => x.id === pid)
    return !!p && p.ownerId === currentUser.id
  }, [currentUser, projects])
  // 当前上下文项目（嵌入模式固定 / 全局模式取所选 Tab；'all' 视图在弹窗内选项目）
  const contextWritable = projectId
    ? projectWritable(projectId)
    : projectFilter !== 'all' ? projectWritable(projectFilter) : true

  // AI 相似案例点击：拉取完整台账并打开，强制只读查看（不允许从 AI 案例入口修改任何字段）
  const handleOpenCaseLog = async (id: string) => {
    try {
      const { log } = await api.getOpLog(id)
      openEdit(log, { caseView: true })
    } catch (e) {
      // AI 案例召回按约定不按项目隔离，跨项目案例对本用户不可见（服务端 404）时给出明确提示
      const msg = getErrorMessage(e, '打开台账失败')
      notify('error', msg === '台账记录不存在' ? '该案例所在项目不在你的可见范围内' : msg)
    }
  }

  const handleSave = async () => {
    // 台账必须关联项目：所有运维作业（含内部作业）统一归集到项目名下
    if (!form.projectId) {
      notify('error', '台账必须关联项目，请选择所属项目')
      return
    }
    if (!form.problem.trim()) {
      notify('error', '「问题」为必填项')
      return
    }
    // 状态为已完成时，经验三字段必须填写（沉淀排障经验；待处理/处理中不强制）
    if (form.status === '已完成') {
      const missing = COMPLETION_REQUIRED.filter((f) => !form[f.key].trim())
      if (missing.length > 0) {
        notify('error', `状态为已完成时必须填写：${missing.map((f) => f.label).join('、')}`)
        return
      }
    }
    const extraFields: Record<string, string> = {}
    // 保留系统隐藏字段（如 __sourceTaskId 来源任务关联）
    if (editing) {
      for (const [k, v] of Object.entries(editing.extraFields || {})) {
        if (k.startsWith('__')) extraFields[k] = v
      }
    }
    for (const r of extraRows) {
      const k = r.key.trim()
      if (k) extraFields[k] = r.value
    }
    // 自定义列数量上限（__ 前缀内部字段不占名额）
    const userKeyCount = Object.keys(extraFields).filter((k) => !k.startsWith('__')).length
    if (userKeyCount > OP_LOG_MAX_EXTRA_COLUMNS) {
      notify('error', `自定义列最多 ${OP_LOG_MAX_EXTRA_COLUMNS} 个，请删减后再保存`)
      return
    }
    const payload = {
      projectId: form.projectId,
      category: form.category.trim() || '其他',
      status: form.status,
      proposer: form.proposer.trim(),
      system: form.system.trim(),
      department: form.department.trim(),
      logDate: form.logDate || new Date().toISOString().slice(0, 10),
      recorder: form.recorder.trim(),
      problem: form.problem.trim(),
      completionDate: form.completionDate || null,
      hours: Number(form.hours) || 0,
      detail: form.detail,
      cause: form.cause,
      solution: form.solution,
      extraFields,
      // 关联任务：'' = 自动归集到项目「运维日常工作」任务（后端解析）
      taskId: form.taskId || '',
    }
    try {
      setSaving(true)
      if (editing) {
        await api.updateOpLog(editing.id, payload)
        notify('success', '台账记录已更新')
      } else {
        await api.createOpLog(payload)
        notify('success', '台账记录已添加')
      }
      setDialogOpen(false)
      reloadAll()
    } catch (e) {
      notify('error', getErrorMessage(e, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (log: OpLog) => {
    if (!confirm(`确认删除该台账记录？\n${log.problem.slice(0, 50)}`)) return
    try {
      await api.deleteOpLog(log.id)
      notify('success', '已删除')
      reloadAll()
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }

  // ===== Excel 导入/导出/模板 =====
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  // 导入预检弹窗：文件先经 preview 扫描重复，用户在弹窗中决定「跳过重复 / 全部照导 / 取消」
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<{ total: number; newCount: number; duplicateCount: number; dupRows: { row: number; problem: string; logDate: string }[]; fieldWarningCount: number; unknownColumns?: string[]; missingColumns?: string[] } | null>(null)

  // 台账必须关联项目：全局模式下「全部台账」视图不提供导入入口项目
  const importProjectId = projectId || (projectFilter !== 'all' ? projectFilter : undefined)

  const doImport = async (file: File, skipDuplicates: boolean) => {
    // 兜底校验：预检弹窗打开期间项目选择变化（如键盘聚焦切换 Tab）时，禁止把文件导进其他/无项目
    if (!importProjectId) {
      notify('warning', '请先选择具体项目，再导入该项目的台账')
      setPendingFile(null)
      setPreview(null)
      return
    }
    try {
      setImporting(true)
      const res = await api.importOpLogs(file, importProjectId, { skipDuplicates })
      const parts = [`成功导入 ${res.imported} 条`]
      if (res.duplicateCount > 0) parts.push(`重复跳过 ${res.duplicateCount} 条`)
      const otherSkipped = res.skipped - res.duplicateCount
      if (otherSkipped > 0) parts.push(`跳过 ${otherSkipped} 条`)
      if (res.fieldWarningCount > 0) parts.push(`${res.fieldWarningCount} 条已完成记录缺经验字段`)
      if (res.unknownColumns && res.unknownColumns.length > 0) parts.push(`未识别列 ${res.unknownColumns.join('、')}${extraConfig ? '（不在项目自定义列定义中，未导入）' : '（按扩展字段处理）'}`)
      if (res.missingColumns && res.missingColumns.length > 0) parts.push(`缺少已定义列 ${res.missingColumns.join('、')}（按空值导入）`)
      const details = [...(res.duplicates || []), ...res.errors, ...(res.fieldWarnings || [])]
      const hasWarn = res.duplicateCount > 0 || res.fieldWarningCount > 0 || (res.unknownColumns?.length ?? 0) > 0 || (res.missingColumns?.length ?? 0) > 0
      if (details.length > 0) {
        notify(hasWarn ? 'warning' : 'info', parts.join('，') + `\n${details.join('\n')}`, { duration: 8000 })
      } else {
        notify(hasWarn ? 'warning' : 'success', parts.join('，'))
      }
      reloadAll()
    } catch (e) {
      notify('error', getErrorMessage(e, '导入失败'))
    } finally {
      setImporting(false)
      setPendingFile(null)
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleImportFile = async (file: File) => {
    // 台账必须关联项目：未选中具体项目（嵌入模式必有 projectId；全局模式需先点选项目 Tab）时不允许导入
    if (!importProjectId) {
      notify('warning', '请先选择具体项目，再导入该项目的台账')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    try {
      setImporting(true)
      // 先预检（不写库）：无重复直接导入；有重复弹窗由用户决定处理方式
      const p = await api.importOpLogsPreview(file, importProjectId)
      if (p.duplicateCount === 0) {
        await doImport(file, true)
        return
      }
      setPreview(p)
      setPendingFile(file)
    } catch (e) {
      notify('error', getErrorMessage(e, '导入失败'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleExport = async () => {
    try {
      await api.exportOpLogs(effectiveFilter)
      notify('success', '导出成功')
    } catch (e) {
      notify('error', getErrorMessage(e, '导出失败'))
    }
  }

  const handleTemplate = async () => {
    try {
      // 带上当前项目：启用自定义列配置的项目按定义生成模板自定义列区
      await api.downloadOpLogTemplate(scopedProjectId || undefined)
    } catch (e) {
      notify('error', getErrorMessage(e, '模板下载失败'))
    }
  }

  const selectCls =
    'h-9 rounded-lg border border-bg-border bg-bg-soft px-2.5 text-sm text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand/40'

  return (
    <div className="flex flex-col gap-4">
      {/* 项目 Tab（全局模式）：按项目隔离台账，'all' 为跨项目全量视图 */}
      {!isEmbedded && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-bg-border bg-bg-soft/60 p-1.5">
          <button
            onClick={() => setProjectFilter('all')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition',
              projectFilter === 'all' ? 'bg-brand text-white shadow-sm' : 'text-muted hover:bg-bg-border/40 hover:text-text-secondary',
            )}
          >
            全部台账
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setProjectFilter(p.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                projectFilter === p.id ? 'bg-brand text-white shadow-sm' : 'text-muted hover:bg-bg-border/40 hover:text-text-secondary',
              )}
              title={`仅显示 ${p.name} 的台账记录`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Input
              placeholder="搜索问题/描述/原因/方案…"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
            />
          </div>
          <Button
            variant={activeFilterCount > 0 ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
          >
            筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showFilters && 'rotate-180')} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showStats ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setShowStats((v) => !v)}
            title="按月+分类统计条数与工时"
          >
            <BarChart3 className="h-3.5 w-3.5" /> 统计
          </Button>
          <Button
            variant={showColSettings ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setShowColSettings((v) => !v)}
            title="调整列显示顺序（自动保存到本机）"
          >
            <Columns3 className="h-3.5 w-3.5" /> 列设置
          </Button>
          {canConfigExtra && (
            <Button
              variant={extraConfig ? 'primary' : 'ghost'}
              size="sm"
              onClick={openExtraCfg}
              title={extraConfig
                ? '编辑本项目的台账自定义列（名称与顺序，导入/导出按此执行）'
                : '为本项目定义台账自定义列（名称与顺序，导入/导出按此执行）'}
            >
              <ListPlus className="h-3.5 w-3.5" /> 自定义列
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleTemplate} title="下载标准导入模板">
            <FileSpreadsheet className="h-3.5 w-3.5" /> 模板
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={importing || !importProjectId || !contextWritable}
            onClick={() => fileRef.current?.click()}
            title={!importProjectId
              ? '请先选择具体项目，再导入该项目的台账'
              : !contextWritable
                ? '只有该项目的负责人或成员才能导入台账'
                : '从 Excel 文件导入台账'}
          >
            <Upload className="h-3.5 w-3.5" /> {importing ? '导入中…' : '导入'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} title="按当前筛选导出 Excel">
            <Download className="h-3.5 w-3.5" /> 导出
          </Button>
          {aiChatEnabled && (
            <Button variant="ghost" size="sm" onClick={() => setAiChatOpen(true)} title="基于台账经验的对话式排障问答">
              <Bot className="h-3.5 w-3.5" /> AI 助手
            </Button>
          )}
          <Button
            size="sm"
            onClick={openCreate}
            disabled={!contextWritable}
            title={!contextWritable ? '只有该项目的负责人或成员才能登记台账' : undefined}
          >
            <Plus className="h-4 w-4" /> 新增记录
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImportFile(f)
          }}
        />
      </div>

      {/* 高级筛选 */}
      {showFilters && (
        <div className="rounded-xl border border-bg-border bg-bg-panel/60 p-4 animate-fade-up">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">分类</label>
              <select className={selectCls} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                <option value="">全部</option>
                {(optionsData.data?.categories || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">状态</label>
              <select className={selectCls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">全部</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">系统</label>
              <select className={selectCls} value={filters.system} onChange={(e) => setFilters({ ...filters, system: e.target.value })}>
                <option value="">全部</option>
                {(optionsData.data?.systems || []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">部门</label>
              <select className={selectCls} value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
                <option value="">全部</option>
                {(optionsData.data?.departments || []).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted">日期从</label>
                <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted">至</label>
                <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
              </div>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters({ category: '', status: '', system: '', department: '', dateFrom: '', dateTo: '' })
                  setKeywordInput('')
                }}
              >
                <X className="h-3.5 w-3.5" /> 清除筛选
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 统计条 */}
      <div className="flex items-center gap-4 text-xs text-muted">
        <span>共 <span className="font-medium text-text-secondary">{logs.length}</span> 条记录</span>
        <span>合计工时 <span className="font-medium text-text-secondary">{totalHours.toFixed(1)}h</span></span>
        <span title="填了工时的台账保存后自动计入关联任务的任务工时">
          已入账 <span className="font-medium text-text-secondary">{syncedHours.toFixed(1)}h</span>
        </span>
        {logsData.loading && <span className="animate-pulse">加载中…</span>}
        {logsData.error && <span className="text-danger">{logsData.error}</span>}
      </div>

      {/* 统计表格：按月×分类交叉展示条数与工时 */}
      {showStats && (
        <div className="rounded-2xl border border-bg-border bg-bg-panel/60 p-4 animate-fade-up">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-text-primary">按月分类统计</h3>
            <span className="text-xs text-muted">每格显示「条数 / 工时(h)」</span>
          </div>
          {statMonths.length === 0 ? (
            <EmptyState title="暂无统计数据" hint="当前筛选条件下没有可统计的台账记录" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-soft text-xs text-muted">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium">月份</th>
                    {statCategories.map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{c}</th>
                    ))}
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium bg-brand/10 text-brand-soft">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {statMonths.map((month) => {
                    let rowCount = 0
                    let rowHours = 0
                    return (
                      <tr key={month} className="border-b border-bg-border/50">
                        <td className="whitespace-nowrap px-3 py-2.5 font-medium text-text-secondary">{month}</td>
                        {statCategories.map((c) => {
                          const cell = statMatrix[month][c]
                          if (cell) {
                            rowCount += cell.count
                            rowHours += cell.hours
                          }
                          return (
                            <td key={c} className="px-3 py-2.5 text-right font-mono text-xs">
                              {cell ? (
                                <span className="text-text-primary">
                                  {cell.count}<span className="text-muted"> / {cell.hours.toFixed(1)}h</span>
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium bg-brand/5 text-brand-soft">
                          {rowCount}<span className="text-muted"> / {rowHours.toFixed(1)}h</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-bg-soft font-medium">
                    <td className="whitespace-nowrap px-3 py-2.5 text-text-primary">合计</td>
                    {statCategories.map((c) => {
                      const t = statTotals.byCategory[c]
                      return (
                        <td key={c} className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-text-primary">
                          {t.count}<span className="text-muted"> / {t.hours.toFixed(1)}h</span>
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-brand-soft bg-brand/10">
                      {statTotals.count}<span className="text-muted"> / {statTotals.hours.toFixed(1)}h</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* 工时汇总：默认按月，可切换记录人/系统/部门/分类；条数 / 工时 / 占比，基于当前筛选结果（与月×分类统计同口径） */}
          {dimStats.length > 0 && (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-text-primary">工时汇总</h3>
                  <div className="flex gap-1">
                    {STAT_DIMS.map((d) => (
                      <button
                        key={d.key}
                        onClick={() => setStatDim(d.key)}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs transition',
                          statDim === d.key ? 'bg-brand/15 font-medium text-brand-soft' : 'text-muted hover:bg-bg-border/40 hover:text-text-secondary',
                        )}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-xs text-muted">共 {logs.length} 条 / {totalHours.toFixed(1)}h</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-soft text-xs text-muted">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{STAT_DIMS.find((d) => d.key === statDim)!.label}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">条数</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">工时(h)</th>
                      <th className="w-[220px] px-3 py-2.5 text-left font-medium">工时占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dimStats.map((r) => {
                      const pct = totalHours > 0 ? (r.hours / totalHours) * 100 : 0
                      return (
                        <tr key={r.value} className="border-b border-bg-border/50">
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-text-secondary">{r.value}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{r.count}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{r.hours.toFixed(1)}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-border/50">
                                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-bg-soft font-medium">
                      <td className="whitespace-nowrap px-3 py-2.5 text-text-primary">合计</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{logs.length}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{totalHours.toFixed(1)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 列设置面板：调整列显示顺序（序号固定第 1 列、操作固定最后；设置持久化到本机） */}
      {showColSettings && (
        <div className="rounded-2xl border border-bg-border bg-bg-panel p-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-text-primary">列显示顺序</p>
            <button onClick={() => setStoredOrder([...DEFAULT_COL_ORDER])} className="text-xs text-brand-soft transition hover:underline">
              恢复默认
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">
            「序号」固定第 1 列、「操作」固定最后；自定义列随当前数据动态显示。顺序自动保存到本机浏览器。
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {settingColumns.map((key, i) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-bg-border bg-bg-soft/60 px-3 py-1.5">
                <span className="truncate text-xs text-text-secondary">
                  {key.startsWith('extra:') ? (extraLabels.get(key.slice(6)) || key.slice(6)) : COL_LABELS[key]}
                  {key.startsWith('extra:') && <span className="ml-1 text-[10px] text-muted">自定义</span>}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    disabled={i === 0}
                    onClick={() => moveCol(key, -1)}
                    className="rounded p-1 text-muted transition hover:bg-bg-border/50 hover:text-text-primary disabled:opacity-30"
                    title="上移"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    disabled={i === settingColumns.length - 1}
                    onClick={() => moveCol(key, 1)}
                    className="rounded p-1 text-muted transition hover:bg-bg-border/50 hover:text-text-primary disabled:opacity-30"
                    title="下移"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 列表 */}
      {logs.length === 0 && !logsData.loading ? (
        <EmptyState
          title={activeFilterCount > 0 ? '没有匹配的台账记录' : '暂无运维台账/课题表'}
          hint={activeFilterCount > 0 ? '调整筛选条件后重试' : '点击「新增记录」或「导入」Excel 文件开始'}
        />
      ) : (
        <div className="max-h-[72vh] overflow-auto rounded-2xl border border-bg-border">
          <table className="w-full min-w-[1380px] text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className={cn(TH_STICKY, 'whitespace-nowrap px-3 py-3 text-left font-medium')}>序号</th>
                {columnOrder.map((key) => renderTh(key))}
                <th className={cn(TH_STICKY, 'whitespace-nowrap px-3 py-3 text-right font-medium')}>操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-bg-border/50 align-top hover:bg-bg-soft/50">
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">{log.seq ?? '-'}</td>
                  {columnOrder.map((key) => renderTd(log, key))}
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(log)}
                        className="rounded-md p-1.5 text-muted transition hover:bg-brand/15 hover:text-brand-soft"
                        title="编辑"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      {/* 删除仅项目负责人（admin 例外，v1.9.3）；无权限直接隐藏 */}
                      {projectOwned(log.projectId) && (
                        <button
                          onClick={() => handleDelete(log)}
                          className="rounded-md p-1.5 text-muted transition hover:bg-danger/15 hover:text-danger"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增/编辑对话框 */}
      {dialogOpen &&
        createPortal(
          <OpLogDialog
            editing={editing}
            form={form}
            setForm={setForm}
            extraRows={extraRows}
            setExtraRows={setExtraRows}
            extraKeySuggestions={[...new Set(logs.flatMap((l) => Object.keys(l.extraFields || {})))]}
            extraConfig={formExtraConfig}
            projects={projects}
            projectWritable={projectWritable}
            lockProject={lockProject}
            readonly={caseViewMode || (!!editing && (!canEditOpLog || !projectWritable(editing.projectId)))}
            onOpenCase={handleOpenCaseLog}
            lockedProjectLabel={
              isEmbedded ? undefined : projects.find((p) => p.id === projectFilter)?.name
            }
            saving={saving}
            options={optionsData.data}
            onSave={handleSave}
            onClose={() => { setDialogOpen(false); setCaseViewMode(false) }}
          />,
          document.body,
        )}

      {/* 台账自定义列配置弹窗：定义本项目自定义列的名称与顺序（导入/导出/展示按此执行） */}
      {extraCfgOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExtraCfgOpen(false)}>
            <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">台账自定义列配置</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  为「{scopedProject?.name}」定义自定义列的名称与顺序（最多 {OP_LOG_MAX_EXTRA_COLUMNS} 个）。启用后台账列表、登记表单、Excel 导入导出均按此配置执行。
                </p>
              </div>
              <div className="max-h-[50vh] space-y-3 overflow-y-auto px-5 py-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={extraCfgDraft.enabled}
                    onChange={(e) => setExtraCfgDraft((d) => ({ ...d, enabled: e.target.checked }))}
                    className="h-4 w-4 accent-sky-600"
                  />
                  启用项目自定义列（停用后保持原有动态扩展列方式）
                </label>
                {extraCfgDraft.columns.map((col, i) => (
                  <div key={col.key} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-400">{i + 1}</span>
                    <input
                      value={col.label}
                      onChange={(e) => setExtraCfgDraft((d) => ({
                        ...d,
                        columns: d.columns.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)),
                      }))}
                      placeholder={`列名 ${i + 1}`}
                      className="flex-1 rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-sky-500 dark:border-slate-600 dark:text-slate-100"
                    />
                    <button
                      disabled={i === 0}
                      onClick={() => setExtraCfgDraft((d) => {
                        const columns = [...d.columns]
                        ;[columns[i - 1], columns[i]] = [columns[i], columns[i - 1]]
                        return { ...d, columns }
                      })}
                      className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700"
                      title="上移"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      disabled={i === extraCfgDraft.columns.length - 1}
                      onClick={() => setExtraCfgDraft((d) => {
                        const columns = [...d.columns]
                        ;[columns[i], columns[i + 1]] = [columns[i + 1], columns[i]]
                        return { ...d, columns }
                      })}
                      className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700"
                      title="下移"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setExtraCfgDraft((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))}
                      className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                      title="删除该列"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {extraCfgDraft.columns.length < OP_LOG_MAX_EXTRA_COLUMNS && (
                  <button
                    onClick={() => setExtraCfgDraft((d) => ({
                      ...d,
                      columns: [...d.columns, { key: `col_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: '' }],
                    }))}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sky-600 transition hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-900/30"
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加列
                  </button>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
                <Button variant="ghost" size="sm" onClick={() => setExtraCfgOpen(false)}>取消</Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={extraCfgSaving || (extraCfgDraft.enabled && extraCfgDraft.columns.some((c) => !c.label.trim()))}
                  onClick={saveExtraCfg}
                  title={extraCfgDraft.enabled && extraCfgDraft.columns.some((c) => !c.label.trim()) ? '启用的列名不能为空' : undefined}
                >
                  {extraCfgSaving ? '保存中…' : '保存'}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* AI 排障助手抽屉 */}
      {aiChatOpen &&
        createPortal(
          <AiChatDrawer
            projectId={scopedProjectId || undefined}
            onOpenCase={handleOpenCaseLog}
            onClose={() => setAiChatOpen(false)}
          />,
          document.body,
        )}

      {/* 导入查重确认弹窗：预检发现重复时由用户决定处理方式 */}
      {preview &&
        pendingFile &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setPreview(null); setPendingFile(null) }}>
            <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">发现 {preview.duplicateCount} 条重复台账</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  文件共 {preview.total} 条待导入，其中 <span className="font-medium text-amber-600 dark:text-amber-400">{preview.duplicateCount} 条与已有台账重复</span>（项目+作业日期+问题相同），{preview.newCount} 条为新记录。请选择处理方式：
                </p>
                {preview.fieldWarningCount > 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    另有 {preview.fieldWarningCount} 条「已完成」记录缺少详细描述/原因/解决方案，导入后请补填。
                  </p>
                )}
                {preview.unknownColumns && preview.unknownColumns.length > 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    未识别列：{preview.unknownColumns.join('、')}——{extraConfig ? '不在本项目自定义列定义中，其内容不会被导入' : '已按自定义扩展字段处理'}；若为标准列名拼写有误（如「作业日期」应为「日期」），请修正文件后重新导入。
                  </p>
                )}
                {preview.missingColumns && preview.missingColumns.length > 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    文件缺少已定义的自定义列：{preview.missingColumns.join('、')}——这些列将按空值导入。
                  </p>
                )}
              </div>
              <div className="max-h-56 overflow-y-auto px-5 py-3">
                <ul className="space-y-1.5 text-sm">
                  {preview.dupRows.map((d) => (
                    <li key={d.row} className="flex gap-2 text-slate-600 dark:text-slate-300">
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">第 {d.row} 行</span>
                      <span className="truncate">{d.problem}{d.logDate ? `（${d.logDate}）` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
                <button
                  className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                  onClick={() => { setPreview(null); setPendingFile(null) }}
                >
                  取消导入
                </button>
                <button
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                  disabled={importing}
                  onClick={() => doImport(pendingFile, false)}
                >
                  全部照导
                </button>
                <button
                  className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  disabled={importing}
                  onClick={() => doImport(pendingFile, true)}
                >
                  {importing ? '导入中…' : `跳过重复，导入 ${preview.newCount} 条`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

// ===== 可排序表头 =====
export function SortTh({
  col,
  sort,
  onToggle,
  align = 'left',
  className,
}: {
  col: { key: string; label: string; defaultDir: string }
  sort: { by: string; dir: 'asc' | 'desc' }
  onToggle: (key: string) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const active = sort.by === col.key
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={cn('whitespace-nowrap px-3 py-3 font-medium', align === 'right' ? 'text-right' : 'text-left', className)}>
      <button
        onClick={() => onToggle(col.key)}
        className={cn(
          'inline-flex items-center gap-1 transition hover:text-text-primary',
          active ? 'text-brand-soft' : 'text-muted',
        )}
        title={`按${col.label}排序，点击切换升/降序`}
      >
        {col.label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  )
}

// ===== 新增/编辑对话框 =====
function OpLogDialog({
  editing,
  form,
  setForm,
  extraRows,
  setExtraRows,
  extraKeySuggestions,
  extraConfig,
  projects,
  projectWritable,
  lockProject,
  readonly,
  onOpenCase,
  lockedProjectLabel,
  saving,
  options,
  onSave,
  onClose,
}: {
  editing: OpLog | null
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  extraRows: ExtraRow[]
  setExtraRows: React.Dispatch<React.SetStateAction<ExtraRow[]>>
  extraKeySuggestions: string[]
  /** 表单所属项目的台账自定义列配置（null = 自由模式，沿用旧动态列行为） */
  extraConfig: OpLogExtraConfig | null
  projects: Project[]
  /** 项目可登记判断（v1.9.3：负责人或成员，admin 全权；与父组件/后端同口径） */
  projectWritable: (pid: string | null | undefined) => boolean
  /** 为 true 时项目归属不可更改（嵌入模式或已选中项目 Tab，保证按项目隔离） */
  lockProject: boolean
  /** 只读查看模式（无台账编辑权限打开已有记录） */
  readonly: boolean
  /** 点击 AI 相似案例打开对应台账 */
  onOpenCase: (id: string) => void
  /** 锁定时显示的项目名称（嵌入模式由父组件传入，全局模式取当前 Tab 项目） */
  lockedProjectLabel?: string
  saving: boolean
  options: { categories: string[]; systems: string[]; departments: string[] } | null | undefined
  onSave: () => void
  onClose: () => void
}) {
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))
  const inputCls = 'h-9 rounded-lg border border-bg-border bg-bg-soft px-3 text-sm text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand/40'

  // 关联任务选项：台账所属项目下的全部任务（工时入账载体，v1.9.4）
  const projectTasks = useAsync<Task[]>(
    () => (form.projectId ? api.listTasks(form.projectId).then((r) => r.tasks) : Promise.resolve([])),
    [form.projectId],
  )

  // ===== AI 经验分析（基于历史台账相似案例） =====
  const notify = useAppStore((s) => s.notify)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState<OpLogAiAnalyzeResponse | null>(null)
  // 流式渲染：正文增量与召回案例在分析过程中即时展示
  const [aiLiveSummary, setAiLiveSummary] = useState('')
  const [aiCases, setAiCases] = useState<OpLogAiCase[]>([])

  useEffect(() => {
    let alive = true
    api.getOpLogAiStatus().then((s) => { if (alive) setAiEnabled(s.enabled) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // 切换查看的记录时清空上一次的 AI 分析结果
  useEffect(() => {
    setAiResult(null)
  }, [editing?.id])

  const canAnalyze = aiEnabled && !readonly && form.problem.trim().length >= 4

  const handleAiAnalyze = async () => {
    if (analyzing || !canAnalyze) return
    setAiResult(null)
    setAiCases([])
    setAiLiveSummary('')
    setAnalyzing(true)
    const payload = {
      problem: form.problem.trim(),
      detail: form.detail.trim() || undefined,
      system: form.system.trim() || undefined,
      category: form.category.trim() || undefined,
      projectId: form.projectId || undefined,
    }
    try {
      // 优先走流式：meta（召回案例）→ delta（正文逐字）→ done（解析后的完整结果）
      let liveCases: OpLogAiCase[] = []
      await api.analyzeOpLogStream(payload, {
        onCases: (cases) => {
          liveCases = cases
          setAiCases(cases)
        },
        onDelta: (text) => setAiLiveSummary((prev) => prev + text),
        onDone: (analysis) => setAiResult({ analysis, cases: liveCases, model: '' }),
      })
      if (!liveCases.length) notify('info', '未找到相似的历史台账案例')
    } catch (streamErr) {
      // 流式失败降级为非流式一次
      try {
        const res = await api.analyzeOpLog(payload)
        setAiResult(res)
        setAiCases(res.cases)
        if (!res.cases.length) notify('info', '未找到相似的历史台账案例')
      } catch {
        notify('error', getErrorMessage(streamErr, 'AI 分析失败'))
      }
    } finally {
      setAnalyzing(false)
      setAiLiveSummary('')
    }
  }

  // 采纳：AI 建议写入「原因」与「解决方案」（已有内容则换行追加，不覆盖人工输入）
  const adoptAi = () => {
    if (!aiResult) return
    const a = aiResult.analysis
    const causeText = a.possibleCauses.map((c) => c.cause).join('；')
    const stepText = a.suggestedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    const merge = (cur: string, add: string) => (add ? (cur.trim() ? cur.trimEnd() + '\n' + add : add) : cur)
    set({ cause: merge(form.cause, causeText), solution: merge(form.solution, stepText) })
    notify('success', '已采纳 AI 建议，请结合实际情况修改后保存')
  }

  // 展示中的案例：完整结果优先，流式过程中用召回阶段送达的案例
  const shownCases = aiResult?.cases.length ? aiResult.cases : aiCases

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
      <div className="w-full max-w-3xl rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl animate-fade-up max-h-[85vh] overflow-y-auto">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-medium text-text-primary">
            {readonly ? '台账详情' : editing ? '编辑台账记录' : '新增台账记录'}
          </h3>
          <button onClick={onClose} className="text-muted transition hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 只读模式下禁用全部表单控件 */}
        <fieldset disabled={readonly} className="min-w-0 border-0 p-0">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">所属项目</label>
            {lockProject ? (
              <Input value={lockedProjectLabel || projects.find((p) => p.id === form.projectId)?.name || '当前项目'} disabled />
            ) : (
              // 台账必须关联项目：下拉仅列当前用户可登记的项目（负责人或成员，v1.9.3），无「不关联」选项
              // 切换项目时清空关联任务（任务列表随项目变化）
              <select className={inputCls + ' w-full'} value={form.projectId} onChange={(e) => set({ projectId: e.target.value, taskId: '' })}>
                {projects.filter((p) => projectWritable(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">分类</label>
            <input
              className={inputCls + ' w-full'}
              list="oplog-category-options"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
              placeholder="如：系统故障 / 需求变更 / 例行维护"
            />
            <datalist id="oplog-category-options">
              {(options?.categories || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">状态</label>
            <select className={inputCls + ' w-full'} value={form.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">提出人</label>
            <input className={inputCls + ' w-full'} value={form.proposer} onChange={(e) => set({ proposer: e.target.value })} placeholder="问题提出人姓名" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">系统</label>
            <input
              className={inputCls + ' w-full'}
              list="oplog-system-options"
              value={form.system}
              onChange={(e) => set({ system: e.target.value })}
              placeholder="如：OA系统 / ERP"
            />
            <datalist id="oplog-system-options">
              {(options?.systems || []).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">部门</label>
            <input
              className={inputCls + ' w-full'}
              list="oplog-department-options"
              value={form.department}
              onChange={(e) => set({ department: e.target.value })}
              placeholder="提出人所在部门"
            />
            <datalist id="oplog-department-options">
              {(options?.departments || []).map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">日期</label>
            <Input type="date" value={form.logDate} onChange={(e) => set({ logDate: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">记录人</label>
            <input className={inputCls + ' w-full'} value={form.recorder} onChange={(e) => set({ recorder: e.target.value })} placeholder="台账记录人" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              问题 <span className="text-danger">*</span>
            </label>
            <Textarea
              rows={2}
              value={form.problem}
              onChange={(e) => set({ problem: e.target.value })}
              placeholder="问题描述（必填）"
            />
          </div>

          {/* AI 经验分析：基于历史台账相似案例给出原因假设与处理建议（只读模式隐藏） */}
          {!readonly && (
          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted">AI 经验分析</label>
              <button
                onClick={handleAiAnalyze}
                disabled={analyzing || !canAnalyze}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition',
                  canAnalyze ? 'text-brand-soft hover:bg-brand/10' : 'cursor-not-allowed text-muted/60',
                )}
                title={
                  aiEnabled
                    ? '基于历史台账相似案例给出原因假设与处理建议'
                    : 'AI 服务未配置，请联系管理员在 .env 中配置 LLM 相关变量'
                }
              >
                <Sparkles className={cn('h-3.5 w-3.5', analyzing && 'animate-spin')} />
                {analyzing ? '分析中…' : '基于历史台账分析'}
              </button>
            </div>
            {(aiResult || aiLiveSummary) && (
              <div className="mt-2 rounded-lg border border-bg-border bg-bg-soft p-3 text-sm">
                <p className="whitespace-pre-wrap text-text-primary">
                  {aiResult ? aiResult.analysis.summary : aiLiveSummary}
                  {!aiResult && analyzing && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-brand-soft align-middle" />
                  )}
                </p>
                {aiResult.analysis.possibleCauses.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted">可能原因</p>
                    <ul className="mt-1 space-y-1">
                      {aiResult.analysis.possibleCauses.map((c, i) => (
                        <li key={i} className="text-text-secondary">
                          {c.cause}
                          <span className="ml-1 text-xs text-muted">（{c.confidence}）</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiResult.analysis.suggestedSteps.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted">建议步骤</p>
                    <ol className="mt-1 list-inside list-decimal space-y-0.5 text-text-secondary">
                      {aiResult.analysis.suggestedSteps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {aiResult.analysis.risks.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted">风险提示</p>
                    <ul className="mt-1 space-y-0.5 text-text-secondary">
                      {aiResult.analysis.risks.map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {shownCases.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted">相似历史案例（匹配度）</p>
                    <ul className="mt-1 space-y-1">
                      {shownCases.map((c) => (
                        <li
                          key={c.opLogId}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-text-secondary transition hover:bg-brand/10 hover:text-brand-soft"
                          title="点击查看该台账"
                          onClick={() => onOpenCase(c.opLogId)}
                        >
                          <span className="min-w-0 flex-1 truncate" title={`${c.problem} —— ${c.solution}`}>
                            {c.problem}
                          </span>
                          <span className="flex-shrink-0 text-muted">{Math.round(c.score * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(aiResult.analysis.possibleCauses.length > 0 || aiResult.analysis.suggestedSteps.length > 0) && (
                  <button
                    onClick={adoptAi}
                    className="mt-3 rounded-md bg-brand/15 px-2.5 py-1 text-xs text-brand-soft transition hover:bg-brand/25"
                  >
                    采纳到「原因」与「解决方案」
                  </button>
                )}
              </div>
            )}
          </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">完成日</label>
            <Input type="date" value={form.completionDate} onChange={(e) => set({ completionDate: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">工时（小时）</label>
            <Input type="number" min="0" step="0.5" value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="0" />
          </div>
          {/* 关联任务（v1.9.4）：台账工时自动入账到该任务的任务工时（成本/报表口径），不填则归集到项目「运维日常工作」 */}
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              关联任务（工时入账）
              <span className="ml-2 font-normal text-muted/70">填写了工时的台账会自动计入该任务的任务工时</span>
            </label>
            <select className={inputCls + ' w-full'} value={form.taskId} onChange={(e) => set({ taskId: e.target.value })}>
              <option value="">默认：归集到项目「运维日常工作」任务</option>
              {(projectTasks.data || []).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              详细描述{form.status === '已完成' && <span className="text-danger"> *</span>}
            </label>
            <Textarea rows={3} value={form.detail} onChange={(e) => set({ detail: e.target.value })} placeholder="问题的详细描述、现象、影响范围等" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              原因{form.status === '已完成' && <span className="text-danger"> *</span>}
            </label>
            <Textarea rows={2} value={form.cause} onChange={(e) => set({ cause: e.target.value })} placeholder="问题根本原因分析" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              解决方案{form.status === '已完成' && <span className="text-danger"> *</span>}
            </label>
            <Textarea rows={2} value={form.solution} onChange={(e) => set({ solution: e.target.value })} placeholder="处理过程与解决方法" />
          </div>

          {/* 扩展字段 */}
          <div className="md:col-span-2">
            {extraConfig ? (
              <>
                {/* 配置模式：按项目自定义列定义渲染固定列（label 只读，仅填值） */}
                <div className="mb-1.5">
                  <label className="text-xs font-medium text-muted">
                    自定义列（{extraConfig.columns.length} 个，由项目定义；导入/导出按此顺序执行）
                  </label>
                </div>
                <div className="space-y-2">
                  {extraConfig.columns.map((c) => {
                    const value = extraRows.find((r) => r.key === c.key)?.value ?? ''
                    return (
                      <div key={c.key} className="flex items-center gap-2">
                        <span
                          className="flex h-9 w-44 flex-shrink-0 items-center overflow-hidden whitespace-nowrap rounded-lg border border-bg-border bg-bg-soft px-3 text-sm text-text-primary"
                          title={c.label}
                        >
                          {c.label}
                        </span>
                        <input
                          className={inputCls + ' flex-1'}
                          value={value}
                          onChange={(e) => {
                            setExtraRows((rows) => {
                              const idx = rows.findIndex((r) => r.key === c.key)
                              if (idx >= 0) {
                                const next = [...rows]
                                next[idx] = { ...next[idx], value: e.target.value }
                                return next
                              }
                              return [...rows, { key: c.key, value: e.target.value }]
                            })
                          }}
                          placeholder="字段值"
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                {/* 自由模式：项目未配置自定义列，沿用旧动态列行为 */}
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted">
                    扩展字段（自定义列，最多 {OP_LOG_MAX_EXTRA_COLUMNS} 个；导入/导出 Excel 时自动识别）
                  </label>
                  <button
                    onClick={() => setExtraRows([...extraRows, { key: '', value: '' }])}
                    disabled={extraRows.length >= OP_LOG_MAX_EXTRA_COLUMNS}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-soft transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    title={extraRows.length >= OP_LOG_MAX_EXTRA_COLUMNS ? `最多 ${OP_LOG_MAX_EXTRA_COLUMNS} 个自定义列` : '添加自定义列'}
                  >
                    <Plus className="h-3.5 w-3.5" /> 添加字段
                  </button>
                </div>
                <datalist id="oplog-extra-key-options">
                  {extraKeySuggestions.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
                {extraRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-bg-border px-3 py-3 text-xs text-muted">
                    暂无扩展字段，点击「添加字段」自定义，如：客户名称、影响程度、处理人等
                  </p>
                ) : (
                  <div className="space-y-2">
                    {extraRows.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          className={cn(inputCls, 'w-44 flex-shrink-0')}
                          list="oplog-extra-key-options"
                          value={row.key}
                          onChange={(e) => {
                            const rows = [...extraRows]
                            rows[i] = { ...rows[i], key: e.target.value }
                            setExtraRows(rows)
                          }}
                          placeholder="字段名"
                        />
                        <input
                          className={inputCls + ' flex-1'}
                          value={row.value}
                          onChange={(e) => {
                            const rows = [...extraRows]
                            rows[i] = { ...rows[i], value: e.target.value }
                            setExtraRows(rows)
                          }}
                          placeholder="字段值"
                        />
                        <button
                          onClick={() => setExtraRows(extraRows.filter((_, j) => j !== i))}
                          className="rounded-md p-1.5 text-muted transition hover:bg-danger/15 hover:text-danger"
                          title="移除该字段"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        </fieldset>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>{readonly ? '关闭' : '取消'}</Button>
          {!readonly && (
            <Button onClick={onSave} disabled={saving || !form.problem.trim()}>
              {saving ? '保存中…' : editing ? '保存修改' : '添加'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
