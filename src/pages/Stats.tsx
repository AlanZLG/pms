// 进度跟踪与统计页

import { useState, useMemo } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar, AreaChart, Area,
} from 'recharts'
import { TrendingUp, Flame, Users2, Activity } from 'lucide-react'
import { useSwr } from '@/lib/cache'
import { api } from '@/lib/api'
import { Card, Skeleton as UiSkeleton, EmptyState } from '@/components/ui'
import { CardSkeleton, Skeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'
import type { StatsOverview, BurndownData, WorkloadItem, Project } from '../../shared/types'
import { STATUS_COLORS_HEX } from '@/lib/constants'

const ranges = [{ v: 7, l: '近 7 天' }, { v: 14, l: '近 14 天' }, { v: 30, l: '近 30 天' }] as const

export default function Stats() {
  const [range, setRange] = useState<number>(14)
  const [projectId, setProjectId] = useState<string>('')
  const overview = useSwr<StatsOverview>(`overview:${projectId}:${range}`, () => api.overview(projectId || undefined, range))
  const projects = useSwr<Project[]>('projects:list:names', () => api.listProjects().then((r) => r.projects))
  const workload = useSwr<WorkloadItem[]>(`workload:${projectId}:${range}`, () => api.workload(projectId || undefined, range).then((r) => r.workload))
  const burndown = useSwr<BurndownData>(`burndown:${projectId}:${range}`, () => api.burndown(projectId || undefined, range))

  const pieItems = useMemo(() => {
    return overview.data
      ? [
          { name: 'todo', value: overview.data.tasksByStatus.todo },
          { name: 'in_progress', value: overview.data.tasksByStatus.in_progress },
          { name: 'review', value: overview.data.tasksByStatus.review },
          { name: 'done', value: overview.data.tasksByStatus.done },
        ].filter((d) => d.value > 0)
      : []
  }, [overview.data])

  const totalTasks = useMemo(() => pieItems.reduce((s, d) => s + d.value, 0), [pieItems])

  const burndownChartData = useMemo(() => {
    if (!burndown.data?.dates.length) return []
    return burndown.data.dates.map((d, i) => ({
      date: d.slice(5),
      ideal: burndown.data!.ideal[i],
      actual: burndown.data!.actual[i],
    }))
  }, [burndown.data])

  const trendChartData = useMemo(
    () => (overview.data?.trend || []).map((t) => ({ ...t, day: t.date.slice(5) })),
    [overview.data],
  )

  const isInitialLoading = overview.loading && projects.loading && workload.loading

  if (isInitialLoading) {
    return (
      <div className="space-y-6 animate-fade-up">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Skeleton width={200} height={28} className="mb-2" />
            <Skeleton width={280} height={16} />
          </div>
          <Skeleton width={170} height={36} rounded="lg" />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width={90} height={14} className="mb-3" />
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <CardSkeleton rows={5} className="lg:col-span-1" />
          <CardSkeleton rows={6} className="lg:col-span-2" />
        </div>

        <CardSkeleton rows={7} />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-text-primary">进度跟踪与统计</h2>
          <p className="mt-1 text-sm text-muted">
            {projectId
              ? `当前项目：${projects.data?.find((p) => p.id === projectId)?.name ?? ''}`
              : '从数据视角总览团队节奏与交付轨迹'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-xs text-text-primary outline-none focus:border-brand"
          >
            <option value="">全部项目</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
            {ranges.map((r) => (
              <button
                key={r.v}
                onClick={() => setRange(r.v)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition',
                  range === r.v ? 'bg-brand text-text-primary' : 'text-muted hover:text-text-secondary',
                )}
              >
                {r.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 任务状态分布 */}
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <TrendingUp className="h-5 w-5 text-brand-soft" /> 任务状态分布
          </h3>
          {overview.loading ? (
            <UiSkeleton className="h-56" />
          ) : totalTasks === 0 ? (
            <EmptyState title="暂无任务" />
          ) : (
            <div className="flex flex-col items-center">
              <div className="relative h-48 w-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieItems}
                      dataKey="value"
                      innerRadius={56}
                      outerRadius={80}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieItems.map((d) => (
                        <Cell key={d.name} fill={STATUS_COLORS_HEX[d.name as keyof typeof STATUS_COLORS_HEX]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-3xl font-semibold text-text-primary">{totalTasks}</span>
                  <span className="text-xs text-muted">任务总数</span>
                </div>
              </div>
              <div className="mt-4 w-full space-y-1.5 text-xs">
                {pieItems.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS_HEX[d.name as keyof typeof STATUS_COLORS_HEX] }} />
                    <span className="text-muted">{statusLabel(d.name)}</span>
                    <span className="ml-auto font-mono text-text-secondary">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* 燃尽图 */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <Flame className="h-5 w-5 text-warn" /> 燃尽图
          </h3>
          {burndown.loading ? (
            <UiSkeleton className="h-64" />
          ) : burndown.data?.dates.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={burndownChartData}
                >
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    contentStyle={{
                      background: '#16203A',
                      border: '1px solid #243054',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="ideal" name="理想剩余" stroke="#94A3B8" strokeDasharray="4 4" dot={false} />
                  <Line type="monotone" dataKey="actual" name="实际剩余" stroke="#6366F1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="暂无燃尽数据" />
          )}
        </Card>
      </div>

      {/* 任务趋势 */}
      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
          <Activity className="h-5 w-5 text-brand-soft" /> 任务趋势
        </h3>
        {overview.loading ? (
          <UiSkeleton className="h-56" />
        ) : trendChartData.length === 0 ? (
          <EmptyState title="暂无趋势数据" />
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendChartData}>
                <defs>
                  <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gDone" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#16203A',
                    border: '1px solid #243054',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="created" name="新建任务" stroke="#6366F1" fill="url(#gCreated)" strokeWidth={2} />
                <Area type="monotone" dataKey="completed" name="完成任务" stroke="#10B981" fill="url(#gDone)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* 成员工作量 */}
      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
          <Users2 className="h-5 w-5 text-brand-soft" /> 成员工作量
        </h3>
        {workload.loading ? (
          <UiSkeleton className="h-64" />
        ) : workload.data && workload.data.length > 0 ? (
          // 人数多时容器内纵向滚动：按每人 44px 计算图高，避免柱条被压得过细
          <div className="max-h-72 overflow-y-auto pr-1">
            <ResponsiveContainer width="100%" height={Math.max(288, workload.data.length * 44)}>
              <BarChart
                data={workload.data}
                layout="vertical"
                margin={{ left: 60, right: 20 }}
                maxBarSize={28}
              >
                <CartesianGrid stroke="rgba(148,163,184,0.08)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="userName"
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
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
                <Bar dataKey="total" name="总任务" fill="#6366F1" radius={[0, 6, 6, 0]} />
                <Bar dataKey="inProgress" name="进行中" fill="#F59E0B" radius={[0, 6, 6, 0]} />
                <Bar dataKey="done" name="已完成" fill="#10B981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState title="暂无成员数据" />
        )}
      </Card>
    </div>
  )
}

function statusLabel(s: string) {
  return s === 'todo' ? '待办' : s === 'in_progress' ? '进行中' : s === 'review' ? '审核中' : '已完成'
}