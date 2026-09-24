import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ResponsiveContainer, ComposedChart,
} from 'recharts'
import { Clock, TrendingUp, Users2, Building2, DollarSign, PieChart } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Skeleton, EmptyState, Input } from '@/components/ui'
import { cn, sortUsers, getUserSortOrder } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { SortTh } from '@/components/OpLogsPanel'
import type { TaskHours, User, Project, HoursByUserProject, ProjectCostSummary } from '../../shared/types'

const categoryLabels: Record<string, string> = {
  labor: '内部人力',
  outsource: '外包费用',
  hardware: '硬件设备',
  software: '软件服务',
  other: '其他',
}

// 工时记录明细可排序列（defaultDir 为首次点击时的方向：文本列升序、数值列降序）
const DETAIL_SORTABLE: { key: string; label: string; defaultDir: string; align?: 'left' | 'right' }[] = [
  { key: 'date', label: '日期', defaultDir: 'desc' },
  { key: 'projectName', label: '项目', defaultDir: 'asc' },
  { key: 'taskTitle', label: '任务', defaultDir: 'asc' },
  { key: 'userName', label: '登记人', defaultDir: 'asc' },
  { key: 'plannedHours', label: '计划工时', defaultDir: 'desc', align: 'right' },
  { key: 'actualHours', label: '内部工时', defaultDir: 'desc', align: 'right' },
  { key: 'billedHours', label: '计费工数', defaultDir: 'desc', align: 'right' },
  { key: 'variance', label: '偏差', defaultDir: 'desc', align: 'right' },
]

// 人员成本明细可排序列（全局一套排序，应用于所有项目表）
const COST_SORTABLE: { key: string; label: string; defaultDir: string; align?: 'left' | 'right' }[] = [
  { key: 'userName', label: '人员', defaultDir: 'asc' },
  { key: 'isOutsourced', label: '类型', defaultDir: 'asc' },
  { key: 'hourlyRate', label: '单价(RMB/h)', defaultDir: 'desc', align: 'right' },
  { key: 'totalHours', label: '总工数(h)', defaultDir: 'desc', align: 'right' },
  { key: 'totalCost', label: '总成本(RMB)', defaultDir: 'desc', align: 'right' },
]

// 单价来源徽标：登记时冻结快照（个人/类别/角色默认），混合 = 该人有多种快照价
const RATE_SOURCE_BADGE: Record<string, string> = {
  user: '个人价',
  category: '类别价',
  role_owner: '角色价',
  role_member: '角色价',
  role_outsourced: '角色价',
  mixed: '混合',
}

// 日期格式化为 YYYY-MM-DD
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// 期间缺省：当月 1 日 ~ 当月最后一天
const monthStart = () => {
  const n = new Date()
  return fmtDate(new Date(n.getFullYear(), n.getMonth(), 1))
}
const monthEnd = () => {
  const n = new Date()
  return fmtDate(new Date(n.getFullYear(), n.getMonth() + 1, 0))
}

export default function HoursReport() {
  const currentUser = useAppStore((s) => s.user)
  const [projectId, setProjectId] = useState<string>('')
  // 项目缺省：仅在用户尚未手动选择时按「我负责的第一个项目」回填一次
  const [projectTouched, setProjectTouched] = useState(false)
  const [userId, setUserId] = useState<string>('')
  const [startDate, setStartDate] = useState<string>(monthStart)
  const [endDate, setEndDate] = useState<string>(monthEnd)

  const projects = useAsync<Project[]>(() => api.listProjects().then((r) => r.projects), [])
  const users = useAsync<User[]>(() => api.listUsers().then((r) => r.users), [])

  useEffect(() => {
    if (projectTouched || !projects.data) return
    const mine = projects.data.find((p) => p.ownerId === currentUser?.id)
    if (mine) setProjectId(mine.id)
  }, [projects.data, currentUser, projectTouched])

  // 主数据源：/stats/hours 服务端按项目/人员/日期过滤，并附带任务计划工时汇总与基线
  const hoursRes = useAsync(
    () => api.listStatsHours(projectId, userId, startDate, endDate),
    [projectId, userId, startDate, endDate],
  )

  // 人员下拉选项：选中具体项目时先列该项目成员（含负责人），再补齐「历史参与人」——
  // 在该项目/期间内有登记记录或负责任务、但已不在成员列表的人，保证任何工时数字都能在
  // 下拉中找到归属人；选"全部项目"时显示所有人员。同名人员追加邮箱前缀消歧。
  const personOptions = useMemo(() => {
    const all = users.data || []
    const project = projectId ? projects.data?.find((p) => p.id === projectId) : undefined
    let list: User[] = all
    if (project) {
      const ids = Array.from(new Set([project.ownerId, ...project.members.map((m) => m.userId)]))
      list = ids
        .map((id) => all.find((u) => u.id === id))
        .filter((u): u is User => !!u)
      // 成员信息兜底：接口未返回该用户档案时用项目成员快照补齐
      for (const m of project.members) {
        if (!list.some((u) => u.id === m.userId) && m.user) {
          list.push({ id: m.userId, name: m.user.name, email: m.user.email, avatarColor: m.user.avatarColor, role: 'member', createdAt: '' })
        }
      }
      list = sortUsers(list)
    }
    const isMember = new Set(list.map((u) => u.id))
    // 历史参与人：有登记或负责任务但不在成员列表（标注「历史参与」），排在成员之后
    const extras = (hoursRes.data?.registrantIds || [])
      .map((id) => all.find((u) => u.id === id))
      .filter((u): u is User => !!u && !isMember.has(u.id))
    const nameCount = new Map<string, number>()
    list.forEach((u) => nameCount.set(u.name, (nameCount.get(u.name) || 0) + 1))
    // 同名消歧：优先邮箱前缀；无 team.view 权限时接口不返回邮箱，退化为序号
    const nameSeq = new Map<string, number>()
    return [
      ...list.map((u) => {
        if ((nameCount.get(u.name) || 0) <= 1) return { id: u.id, label: u.name }
        const seq = (nameSeq.get(u.name) || 0) + 1
        nameSeq.set(u.name, seq)
        return { id: u.id, label: u.email ? `${u.name}（${u.email.split('@')[0]}）` : `${u.name}（${seq}）` }
      }),
      ...sortUsers(extras).map((u) => ({
        id: u.id,
        label: `${u.name}（历史参与）`,
      })),
    ]
  }, [projectId, projects.data, users.data, hoursRes.data])

  // 项目切换后，已选人员若不在新项目成员列表中则自动回退为"全部人员"，避免悬空选项
  useEffect(() => {
    if (userId && !personOptions.some((o) => o.id === userId)) setUserId('')
  }, [personOptions, userId])

  const allHours = useMemo(() => hoursRes.data?.hours || [], [hoursRes.data])
  const taskPlannedHours = hoursRes.data?.taskPlannedHours || 0
  const unassignedPlannedHours = hoursRes.data?.unassignedPlannedHours || 0
  // 人员-项目工时矩阵：与项目筛选联动（选具体项目时矩阵只展示该项目列）
  const hoursByUser = useAsync<HoursByUserProject[]>(() => api.listHoursByUser(startDate, endDate, projectId || undefined).then((r) => r.data), [startDate, endDate, projectId])
  const projectCost = useAsync<ProjectCostSummary[]>(() => api.listProjectCost(projectId || undefined).then((r) => r.data), [projectId])

  // 服务端已完成过滤，直接使用
  const filteredHours = allHours

  const totalPlanned = useMemo(() => filteredHours.reduce((sum, h) => sum + h.plannedHours, 0), [filteredHours])
  const totalActual = useMemo(() => filteredHours.reduce((sum, h) => sum + h.actualHours, 0), [filteredHours])
  const totalBilled = useMemo(() => filteredHours.reduce((sum, h) => sum + (h.billedHours || 0), 0), [filteredHours])
  // 工时偏差：实际消耗 vs 任务计划工时（任务设置口径，与「登记计划」无关）
  const variance = totalActual - taskPlannedHours
  const variancePercent = taskPlannedHours > 0 ? ((variance / taskPlannedHours) * 100).toFixed(1) : '0'

  // 计划消耗进度：任务计划工时 vs 已登记的实际消耗
  const consumedPercent = taskPlannedHours > 0 ? Math.min(100, (totalActual / taskPlannedHours) * 100) : 0

  // 403 → 权限不足提示（区分「没数据」和「没权限」）
  const isPermissionError = (err: string) => err.includes('权限')
  const matrixDenied = hoursByUser.error !== '' && isPermissionError(hoursByUser.error)
  const costDenied = projectCost.error !== '' && isPermissionError(projectCost.error)

  // 趋势图数据：柱状 = 每日登记计划/实际；折线 = 计划/实际累计 S 曲线（期间内逐日累计）
  // 计划曲线来源 = 任务计划基线（plannedBaseline 已裁剪到所选期间内）
  const chartData = useMemo(() => {
    if (!startDate || !endDate) return []
    const s = new Date(startDate + 'T00:00:00')
    const e = new Date(endDate + 'T00:00:00')
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return []
    // 本地时区安全格式化（toISOString 在 UTC+8 会回退一天）
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const round2 = (x: number) => Math.round(x * 100) / 100
    const daily = new Map<string, { planned: number; actual: number; baseline: number }>()
    filteredHours.forEach((h) => {
      const v = daily.get(h.date) || { planned: 0, actual: 0, baseline: 0 }
      v.planned += h.plannedHours
      v.actual += h.actualHours
      daily.set(h.date, v)
    })
    hoursRes.data?.taskPlannedByDate?.forEach((b) => {
      const v = daily.get(b.date) || { planned: 0, actual: 0, baseline: 0 }
      v.baseline += b.planned
      daily.set(b.date, v)
    })
    let cumActual = 0
    let cumBaseline = 0
    const out: { date: string; planned: number; actual: number; plannedCum: number; actualCum: number }[] = []
    const cur = new Date(s)
    while (cur <= e) {
      const d = fmt(cur)
      const v = daily.get(d)
      cumActual += v?.actual || 0
      cumBaseline += v?.baseline || 0
      out.push({
        date: d.slice(5),
        planned: round2(v?.planned || 0),
        actual: round2(v?.actual || 0),
        plannedCum: round2(cumBaseline),
        actualCum: round2(cumActual),
      })
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [filteredHours, hoursRes.data, startDate, endDate])

  // 明细排序：默认日期降序（与服务端 ORDER BY 一致）；点击表头切换升/降序
  const [detailSort, setDetailSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({ by: 'date', dir: 'desc' })
  const toggleDetailSort = (key: string) => {
    setDetailSort((s) => {
      if (s.by === key) return { by: key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      const col = DETAIL_SORTABLE.find((c) => c.key === key)
      return { by: key, dir: (col?.defaultDir || 'desc') as 'asc' | 'desc' }
    })
  }
  const sortedHours = useMemo(() => {
    const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.name || ''
    const val = (h: TaskHours): string | number => {
      switch (detailSort.by) {
        case 'projectName': return h.projectName || ''
        case 'taskTitle': return h.taskTitle || ''
        case 'userName': return nameOf(h.userId)
        case 'plannedHours': return h.plannedHours
        case 'actualHours': return h.actualHours
        case 'billedHours': return h.billedHours
        case 'variance': return h.actualHours - h.plannedHours
        default: return h.date
      }
    }
    const dir = detailSort.dir === 'asc' ? 1 : -1
    return [...filteredHours].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y), 'zh-CN') * dir
    })
  }, [filteredHours, detailSort, users.data])

  // 人员成本明细排序：全局一套，应用于所有项目表；默认按总工数降序
  // （总成本 = 时薪 × 工数，时薪未配置时恒为 0 无区分度，故默认用工数排序）
  const [costSort, setCostSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({ by: 'totalHours', dir: 'desc' })
  const toggleCostSort = (key: string) => {
    setCostSort((s) => {
      if (s.by === key) return { by: key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      const col = COST_SORTABLE.find((c) => c.key === key)
      return { by: key, dir: (col?.defaultDir || 'desc') as 'asc' | 'desc' }
    })
  }
  const sortedMemberCosts = useMemo(() => {
    const val = (m: ProjectCostSummary['memberCosts'][number]): string | number => {
      switch (costSort.by) {
        case 'userName': return m.userName
        case 'isOutsourced': return m.isOutsourced ? 1 : 0
        case 'hourlyRate': return m.hourlyRate || 0
        case 'totalHours': return m.totalHours
        default: return m.totalCost
      }
    }
    const dir = costSort.dir === 'asc' ? 1 : -1
    const map: Record<string, ProjectCostSummary['memberCosts']> = {}
    projectCost.data?.forEach((p) => {
      map[p.projectId] = [...p.memberCosts].sort((a, b) => {
        const x = val(a)
        const y = val(b)
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
        return String(x).localeCompare(String(y), 'zh-CN') * dir
      })
    })
    return map
  }, [projectCost.data, costSort])

  const hoursByUserSimple = useMemo(() => {
    const accMap = filteredHours.reduce((acc, h) => {
      acc[h.userId] = acc[h.userId] || { userId: h.userId, userName: '', planned: 0, actual: 0 }
      acc[h.userId].planned += h.plannedHours
      acc[h.userId].actual += h.actualHours
      return acc
    }, {} as Record<string, { userId: string; userName: string; planned: number; actual: number }>)
    Object.values(accMap).forEach((h) => {
      const user = users.data?.find((u) => u.id === h.userId)
      h.userName = user?.name || '未知用户'
    })
    return accMap
  }, [filteredHours, users.data])

  const { uniqueProjects, projectNames } = useMemo(() => {
    const allProjects = hoursByUser.data?.flatMap((u) => u.projects).map((p) => p.projectId) || []
    const uniq = [...new Set(allProjects)]
    const names: Record<string, string> = {}
    hoursByUser.data?.forEach((u) => {
      u.projects.forEach((p) => {
        names[p.projectId] = p.projectName
      })
    })
    return { uniqueProjects: uniq, projectNames: names }
  }, [hoursByUser.data])

  const totalHoursByProject = useMemo(() => {
    return uniqueProjects.reduce((acc, pid) => {
      let planned = 0
      let actual = 0
      let billed = 0
      hoursByUser.data?.forEach((u) => {
        const p = u.projects.find((proj) => proj.projectId === pid)
        if (p) {
          planned += p.plannedHours
          actual += p.actualHours
          billed += p.billedHours || 0
        }
      })
      acc[pid] = { planned, actual, billed }
      return acc
    }, {} as Record<string, { planned: number; actual: number; billed: number }>)
  }, [uniqueProjects, hoursByUser.data])

  const allCategoryTotals = useMemo(() => {
    return projectCost.data?.reduce((acc, p) => {
      p.costByCategory.forEach((c) => {
        acc[c.category] = acc[c.category] || { budget: 0, expense: 0, hours: 0 }
        acc[c.category].budget += c.budget
        acc[c.category].expense += c.expense
        acc[c.category].hours += c.hours
      })
      return acc
    }, {} as Record<string, { budget: number; expense: number; hours: number }>) || {}
  }, [projectCost.data])

  const categoryChartData = useMemo(() => {
    return Object.entries(allCategoryTotals).map(([category, data]) => ({
      name: categoryLabels[category] || category,
      budget: data.budget,
      expense: data.expense,
    }))
  }, [allCategoryTotals])

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="font-display text-2xl text-text-primary">工时报表</h2>
        <p className="mt-1 text-sm text-muted">任务计划工时（来自任务设置）与工时登记记录（任务详情中登记）的计划/内部/计费工数统计分析</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted">项目</label>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectTouched(true)
                setProjectId(e.target.value)
              }}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
            >
              <option value="">全部项目</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">人员</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
            >
              <option value="">全部人员</option>
              {personOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">开始日期</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">结束日期</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
      </Card>

      {!hoursRes.loading && hoursRes.error && (
        <Card className="border-danger/40 bg-danger/5 p-3">
          <p className="text-sm text-danger">工时数据加载失败：{hoursRes.error}（调整筛选条件后会自动重新加载）</p>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">任务计划工时</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text-primary">{taskPlannedHours.toFixed(1)}</span>
            <span className="text-xs text-muted">小时</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            来自任务设置
            {userId && unassignedPlannedHours > 0 && (
              <span className="text-warn"> · 另有 {unassignedPlannedHours.toFixed(1)}h 未指派负责人</span>
            )}
          </div>
          <Link to="/projects" className="mt-1 inline-block text-[11px] text-brand hover:underline">去任务登记工时 →</Link>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">登记计划工时</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text-primary">{totalPlanned.toFixed(1)}</span>
            <span className="text-xs text-muted">小时</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">登记工时时填写的计划工时合计</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">内部工时(实际)</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text-primary">{totalActual.toFixed(1)}</span>
            <span className="text-xs text-muted">小时</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">计费工数(对客户)</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-brand">{totalBilled.toFixed(1)}</span>
            <span className="text-xs text-muted">小时</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">工时偏差</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn('font-mono text-2xl font-semibold', variance >= 0 ? 'text-warn' : 'text-success')}>
              {variance >= 0 ? '+' : ''}{variance.toFixed(1)}
            </span>
            <span className="text-xs text-muted">小时</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">内部实际 {totalActual.toFixed(1)}h − 任务计划 {taskPlannedHours.toFixed(1)}h</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">偏差率</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn('font-mono text-2xl font-semibold', variance >= 0 ? 'text-warn' : 'text-success')}>
              {variancePercent}%
            </span>
          </div>
        </Card>
        <Card className="p-4 md:col-span-2">
          <div className="flex items-center gap-2 text-xs text-muted">计划消耗进度</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text-primary">
              {totalActual.toFixed(1)}
            </span>
            <span className="text-xs text-muted">/ {taskPlannedHours.toFixed(1)} 小时（任务计划）</span>
            {taskPlannedHours > 0 && (
              <span className={cn('ml-auto font-mono text-sm', consumedPercent >= 100 ? 'text-danger' : 'text-success')}>
                {consumedPercent.toFixed(0)}%
              </span>
            )}
          </div>
          <div className="mt-2 h-2 rounded-full bg-bg-border overflow-hidden">
            <div
              className={cn('h-full', consumedPercent >= 100 ? 'bg-danger' : 'bg-brand')}
              style={{ width: `${taskPlannedHours > 0 ? consumedPercent : 0}%` }}
            />
          </div>
        </Card>
      </div>

      {/* 行高显式锁死为 380px 轨道 + 卡片溢出裁剪：人员列表内容再多也不能撑破行高压到下方卡片 */}
      <div className="grid gap-6 lg:h-[380px] lg:grid-cols-2 lg:grid-rows-[380px]">
        <Card className="flex flex-col p-5 lg:overflow-hidden">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <Clock className="h-5 w-5 text-brand-soft" /> 工时趋势
          </h3>
          {hoursRes.loading ? (
            <Skeleton className="h-64" />
          ) : chartData.length === 0 ? (
            <EmptyState title="当前筛选条件下无登记数据" hint="可调整项目 / 人员 / 日期范围后查看按日趋势" />
          ) : (
            <div className="h-64 lg:h-auto lg:min-h-0 lg:flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="day"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <YAxis
                    yAxisId="cum"
                    orientation="right"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#16203A',
                      border: '1px solid #243054',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="day" dataKey="planned" name="登记计划" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="day" dataKey="actual" name="登记实际" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="cum" dataKey="plannedCum" name="计划累计" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  <Line yAxisId="cum" dataKey="actualCum" name="实际累计" stroke="#22D3EE" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {(hoursRes.data?.baselineSkippedHours || 0) > 0 && (
            <p className="mt-2 text-[11px] text-muted">
              有 {(hoursRes.data?.baselineSkippedHours || 0).toFixed(1)}h 任务计划因未设置起止日期或周期过长（超 60 天），未计入"计划累计"曲线
            </p>
          )}
        </Card>

        <Card className="flex flex-col p-5 lg:overflow-hidden">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <Users2 className="h-5 w-5 text-brand-soft" /> 人员工时统计
          </h3>
          {hoursRes.loading ? (
            <Skeleton className="h-64" />
          ) : Object.keys(hoursByUserSimple).length === 0 ? (
            <EmptyState title="当前筛选条件下无登记数据" />
          ) : (
            /* 确定性高度上限：保证 overflow-y-auto 始终生效，内容永不溢出卡片 */
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1 lg:max-h-[280px] lg:min-h-0 lg:flex-1">
              {Object.values(hoursByUserSimple)
                .sort((a, b) => {
                  const userA = users.data?.find((u) => u.id === a.userId)
                  const userB = users.data?.find((u) => u.id === b.userId)
                  const orderA = getUserSortOrder(userA)
                  const orderB = getUserSortOrder(userB)
                  if (orderA !== orderB) return orderA - orderB
                  return a.userName.localeCompare(b.userName)
                })
                .map((h) => (
                <div key={h.userId} className="rounded-lg bg-bg-soft p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">{h.userName}</span>
                    <span className="text-xs text-muted">
                      {h.planned.toFixed(1)}h / {h.actual.toFixed(1)}h
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    <div
                      className="h-2 rounded-full bg-brand"
                      style={{ width: Math.max(1, (h.planned / Math.max(totalPlanned, 1)) * 100) + '%' }}
                    />
                    <div
                      className="h-2 rounded-full bg-success"
                      style={{ width: Math.max(1, (h.actual / Math.max(totalActual, 1)) * 100) + '%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
          <Building2 className="h-5 w-5 text-brand-soft" /> 人员-项目工时矩阵
        </h3>
        {matrixDenied ? (
          <EmptyState title="仅财务与管理员可见" hint="跨人员统计需要相应权限" />
        ) : hoursByUser.loading ? (
          <Skeleton className="h-80" />
        ) : hoursByUser.data?.length === 0 ? (
          <EmptyState title="暂无工时数据" />
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border">
                  <th className="sticky left-0 top-0 z-30 bg-bg-soft text-left py-3 px-4 font-medium text-muted">人员</th>
                  {uniqueProjects.map((pid) => (
                    <th key={pid} className="sticky top-0 z-20 bg-bg-soft text-center py-3 px-4 font-medium text-muted">
                      {projectNames[pid]}
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-bg-soft text-center py-3 px-4 font-medium text-muted">合计</th>
                </tr>
              </thead>
              <tbody>
                {hoursByUser.data?.map((u) => (
                  <tr key={u.userId} className="border-b border-bg-border/50 hover:bg-bg-soft/50">
                    <td className="sticky left-0 z-10 bg-bg-soft py-3 px-4 font-medium text-text-primary">{u.userName}</td>
                    {uniqueProjects.map((pid) => {
                      const p = u.projects.find((proj) => proj.projectId === pid)
                      return (
                        <td key={pid} className="text-center py-3 px-4">
                          {p ? (
                            <div className="space-y-1">
                              <div className="font-mono text-sm text-text-secondary">内部 {p.actualHours.toFixed(1)}h</div>
                              <div className="text-xs text-muted">计划: {p.plannedHours.toFixed(1)}h</div>
                              <div className="text-xs text-brand">计费: {(p.billedHours || 0).toFixed(1)}h</div>
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="text-center py-3 px-4">
                      <div className="space-y-1">
                        <div className="font-mono font-medium text-text-primary">内部 {u.totalActual.toFixed(1)}h</div>
                        <div className="text-xs text-muted">计划: {u.totalPlanned.toFixed(1)}h</div>
                        <div className="text-xs text-brand">计费: {(u.totalBilled || 0).toFixed(1)}h</div>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="bg-bg-soft">
                  <td className="sticky left-0 bottom-0 z-30 bg-bg-soft py-3 px-4 font-semibold text-text-primary">项目合计</td>
                  {uniqueProjects.map((pid) => {
                    const totals = totalHoursByProject[pid]
                    return (
                      <td key={pid} className="sticky bottom-0 z-20 bg-bg-soft text-center py-3 px-4 font-semibold">
                        <div className="space-y-1">
                          <div className="font-mono text-success">{totals?.actual.toFixed(1) || '0'}h</div>
                          <div className="text-xs text-muted">计划: {(totals?.planned || 0).toFixed(1)}h</div>
                          <div className="text-xs text-brand">计费: {(totals?.billed || 0).toFixed(1)}h</div>
                        </div>
                      </td>
                    )
                  })}
                  <td className="sticky bottom-0 z-20 bg-bg-soft text-center py-3 px-4 font-semibold text-brand">
                    <div className="space-y-1">
                      <div className="font-mono">内部 {(hoursByUser.data?.reduce((sum, u) => sum + u.totalActual, 0) || 0).toFixed(1)}h</div>
                      <div className="text-xs text-muted">计划: {(hoursByUser.data?.reduce((sum, u) => sum + u.totalPlanned, 0) || 0).toFixed(1)}h</div>
                      <div className="text-xs">计费: {(hoursByUser.data?.reduce((sum, u) => sum + (u.totalBilled || 0), 0) || 0).toFixed(1)}h</div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <DollarSign className="h-5 w-5 text-brand-soft" /> 项目成本汇总
        </h3>
        {costDenied ? (
          <EmptyState title="仅财务与管理员可见" hint="成本数据需要相应权限" />
        ) : projectCost.error && !isPermissionError(projectCost.error) ? (
          <EmptyState title="成本数据加载失败" hint="请调整筛选条件重试或刷新页面" />
        ) : projectCost.loading ? (
          <Skeleton className="h-80" />
        ) : projectCost.data?.length === 0 ? (
          <EmptyState title="暂无成本数据" />
        ) : (
            <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
              {projectCost.data?.map((project) => (
                <div key={project.projectId} className="rounded-lg bg-bg-soft p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-text-primary">{project.projectName}</span>
                    <div className="text-right">
                      <div className="font-mono text-sm">
                        预算: <span className="text-brand">{project.totalBudget.toLocaleString()}</span> RMB
                      </div>
                      <div className="font-mono text-sm">
                        支出: <span className="text-warn">{project.totalExpense.toLocaleString()}</span> RMB
                      </div>
                      <div className="font-mono text-sm">
                        剩余: <span className={project.remainingBudget >= 0 ? 'text-success' : 'text-danger'}>
                          {project.remainingBudget.toLocaleString()}
                        </span> RMB
                      </div>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-bg-border overflow-hidden">
                    <div
                      className={cn('h-full', project.totalBudget > 0 ? 'bg-brand' : 'bg-bg-border')}
                      style={{ width: project.totalBudget > 0 ? Math.min(100, (project.totalExpense / project.totalBudget) * 100) + '%' : '0%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <PieChart className="h-5 w-5 text-brand-soft" /> 成本分类统计
        </h3>
        {costDenied ? (
          <EmptyState title="仅财务与管理员可见" hint="成本数据需要相应权限" />
        ) : projectCost.error && !isPermissionError(projectCost.error) ? (
          <EmptyState title="成本数据加载失败" hint="请调整筛选条件重试或刷新页面" />
        ) : projectCost.loading ? (
          <Skeleton className="h-80" />
        ) : categoryChartData.length === 0 ? (
          <EmptyState title="暂无成本数据" />
        ) : (
            <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} layout="vertical">
                    <CartesianGrid stroke="rgba(148,163,184,0.08)" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={80}
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#16203A',
                        border: '1px solid #243054',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="budget" name="预算" fill="#6366F1" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="expense" name="支出" fill="#F59E0B" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {projectCost.data?.map((project) => (
                  <div key={project.projectId} className="rounded-lg bg-bg-soft/50 p-3">
                    <div className="text-sm font-medium text-text-primary mb-2">{project.projectName}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {project.costByCategory.map((cat) => (
                        <div key={cat.category} className="text-xs">
                          <span className="text-muted">{categoryLabels[cat.category]}:</span>
                          <span className="ml-2 font-mono text-text-secondary">预算 {cat.budget.toLocaleString()}</span>
                          <span className="ml-2 font-mono text-warn">支出 {cat.expense.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
          <Users2 className="h-5 w-5 text-brand-soft" /> 人员成本明细
        </h3>
        {costDenied ? (
          <EmptyState title="仅财务与管理员可见" hint="人员成本数据需要相应权限" />
        ) : projectCost.error && !isPermissionError(projectCost.error) ? (
          <EmptyState title="成本数据加载失败" hint="请调整筛选条件重试或刷新页面" />
        ) : projectCost.loading ? (
          <Skeleton className="h-64" />
        ) : projectCost.data?.length === 0 ? (
          <EmptyState title="暂无成本数据" />
        ) : (
          <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
            {projectCost.data?.map((project) => (
              <div key={project.projectId}>
                <div className="mb-2 font-medium text-text-primary">{project.projectName}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-bg-border">
                        {COST_SORTABLE.map((c) => (
                          <SortTh
                            key={c.key}
                            col={c}
                            sort={costSort}
                            onToggle={toggleCostSort}
                            align={c.align}
                            className="sticky top-0 z-10 bg-bg-soft py-2 px-3"
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(sortedMemberCosts[project.projectId] || project.memberCosts).map((member) => (
                        <tr key={member.userId} className="border-b border-bg-border/50">
                          <td className="py-2 px-3 text-text-secondary">{member.userName}</td>
                          <td className="py-2 px-3">
                            <span className={cn('px-2 py-0.5 rounded-full text-xs', member.isOutsourced ? 'bg-warn/20 text-warn' : 'bg-success/20 text-success')}>
                              {member.isOutsourced ? '外包' : '内部'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-text-secondary">
                            {member.hourlyRate || '-'}
                            {RATE_SOURCE_BADGE[member.rateSource || ''] && (
                              <span title={`单价来源：${RATE_SOURCE_BADGE[member.rateSource || '']}`} className="ml-1 text-[10px] text-muted align-middle">
                                {RATE_SOURCE_BADGE[member.rateSource || '']}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-text-secondary">{member.totalHours.toFixed(1)}</td>
                          <td className="py-2 px-3 text-right font-mono text-text-primary">{member.totalCost.toLocaleString()}</td>
                        </tr>
                      ))}
                      {project.memberCosts.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-muted">暂无人员工时记录</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
          <TrendingUp className="h-5 w-5 text-brand-soft" /> 工时记录明细
        </h3>
        {hoursRes.loading ? (
          <Skeleton className="h-64" />
        ) : filteredHours.length === 0 ? (
          <EmptyState title="当前筛选条件下暂无记录" hint="可调整项目 / 人员 / 日期范围；在任务详情中登记工时后这里会显示明细" />
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border">
                  {DETAIL_SORTABLE.map((c) => (
                    <SortTh
                      key={c.key}
                      col={c}
                      sort={detailSort}
                      onToggle={toggleDetailSort}
                      align={c.align}
                      className="sticky top-0 z-20 bg-bg-soft px-4"
                    />
                  ))}
                  <th className="sticky top-0 z-20 bg-bg-soft text-left py-3 px-4 font-medium text-muted">说明</th>
                </tr>
              </thead>
              <tbody>
                {sortedHours.map((h) => (
                  <tr key={h.id} className="border-b border-bg-border/50 hover:bg-bg-soft/50">
                    <td className="py-3 px-4 text-text-secondary">{h.date}</td>
                    <td className="py-3 px-4 text-text-secondary">{h.projectName || '-'}</td>
                    <td className="py-3 px-4 text-text-secondary">{h.taskTitle || `任务 #${h.taskId.slice(0, 8)}`}</td>
                    <td className="py-3 px-4 text-text-secondary">{users.data?.find((u) => u.id === h.userId)?.name || '未知用户'}</td>
                    <td className="py-3 px-4 text-right font-mono text-text-secondary">{h.plannedHours.toFixed(1)}h</td>
                    <td className="py-3 px-4 text-right font-mono text-text-secondary">{h.actualHours.toFixed(1)}h</td>
                    <td className="py-3 px-4 text-right font-mono text-brand">{(h.billedHours || 0).toFixed(1)}h</td>
                    <td className={cn('py-3 px-4 text-right font-mono', (h.actualHours - h.plannedHours) >= 0 ? 'text-warn' : 'text-success')}>
                      {(h.actualHours - h.plannedHours) >= 0 ? '+' : ''}{(h.actualHours - h.plannedHours).toFixed(1)}h
                    </td>
                    <td className="py-3 px-4 text-muted">{h.description || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}