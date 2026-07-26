// 进度跟踪与统计页

import { useState } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar,
} from 'recharts'
import { TrendingUp, Flame, Users2 } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Skeleton, EmptyState, Avatar } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { StatsOverview, BurndownData, WorkloadItem, Project } from '../../shared/types'

const statusColors: Record<string, string> = {
  todo: '#94A3B8',
  in_progress: '#F59E0B',
  review: '#38BDF8',
  done: '#10B981',
}

const ranges = [{ v: 14, l: '近 14 天' }, { v: 30, l: '近 30 天' }] as const

export default function Stats() {
  const [range, setRange] = useState<number>(14)
  const overview = useAsync<StatsOverview>(() => api.overview(), [])
  const projects = useAsync<Project[]>(() => api.listProjects().then((r) => r.projects), [])
  const workload = useAsync<WorkloadItem[]>(() => api.workload().then((r) => r.workload), [])
  const [projectId, setProjectId] = useState<string>('')
  const burndown = useAsync<BurndownData>(() => api.burndown(projectId), [projectId])

  const pieItems = overview.data
    ? [
        { name: 'todo', value: overview.data.tasksByStatus.todo },
        { name: 'in_progress', value: overview.data.tasksByStatus.in_progress },
        { name: 'review', value: overview.data.tasksByStatus.review },
        { name: 'done', value: overview.data.tasksByStatus.done },
      ].filter((d) => d.value > 0)
    : []

  const totalTasks = pieItems.reduce((s, d) => s + d.value, 0)

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-white">进度跟踪与统计</h2>
          <p className="mt-1 text-sm text-muted">从数据视角总览团队节奏与交付轨迹</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
          {ranges.map((r) => (
            <button
              key={r.v}
              onClick={() => setRange(r.v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition',
                range === r.v ? 'bg-brand text-white' : 'text-muted hover:text-slate-200',
              )}
            >
              {r.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 任务状态分布 */}
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-slate-100">
            <TrendingUp className="h-5 w-5 text-brand-soft" /> 任务状态分布
          </h3>
          {overview.loading ? (
            <Skeleton className="h-56" />
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
                        <Cell key={d.name} fill={statusColors[d.name]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-3xl font-semibold text-white">{totalTasks}</span>
                  <span className="text-xs text-muted">任务总数</span>
                </div>
              </div>
              <div className="mt-4 w-full space-y-1.5 text-xs">
                {pieItems.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: statusColors[d.name] }} />
                    <span className="text-muted">{statusLabel(d.name)}</span>
                    <span className="ml-auto font-mono text-slate-200">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* 燃尽图 */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-display text-lg text-slate-100">
              <Flame className="h-5 w-5 text-warn" /> 燃尽图
            </h3>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-brand"
            >
              <option value="">选择项目…</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {!projectId ? (
            <EmptyState title="选择一个项目查看燃尽图" />
          ) : burndown.loading ? (
            <Skeleton className="h-64" />
          ) : burndown.data?.dates.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={burndown.data.dates.map((d, i) => ({
                    date: d.slice(5),
                    ideal: burndown.data!.ideal[i],
                    actual: burndown.data!.actual[i],
                  }))}
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

      {/* 成员工作量 */}
      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-slate-100">
          <Users2 className="h-5 w-5 text-brand-soft" /> 成员工作量
        </h3>
        {workload.loading ? (
          <Skeleton className="h-64" />
        ) : workload.data && workload.data.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={workload.data}
                layout="vertical"
                margin={{ left: 60, right: 20 }}
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