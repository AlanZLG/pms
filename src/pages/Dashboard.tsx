// 仪表板首页

import { Link } from 'react-router-dom'
import {
  FolderKanban,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ListTodo,
  ArrowRight,
  TrendingUp,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { useAsync } from '@/hooks/useAsync'
import { api, getToken } from '@/lib/api'
import { Card, Skeleton, EmptyState, Avatar, PriorityBadge, StatusBadge } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { dueLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task, StatsOverview, BurndownData } from '../../shared/types'

const statusColors: Record<string, string> = {
  todo: '#94A3B8',
  in_progress: '#F59E0B',
  review: '#38BDF8',
  done: '#10B981',
}

export default function Dashboard() {
  const user = useAppStore((s) => s.user)
  const userId = user?.id || ''
  const overview = useAsync<StatsOverview>(() => api.overview(), [])
  const burndown = useAsync<BurndownData>(() => api.burndown(''), [])
  const tasks = useAsync<Task[]>(async () => {
    if (!userId) return []
    const { listUsers } = api
    const { users } = await listUsers()
    const mine = users.find((u) => u.id === userId)
    if (!mine) return []
    // 这里通过 listTasks 需要项目 id,直接用全部项目里我的任务有点麻烦,
    // 简化:拉取所有项目,再拉每个项目的任务;取属于我的未完成任务
    const { projects } = await api.listProjects()
    const all: Task[] = []
    await Promise.all(
      projects.map(async (p) => {
        const { tasks } = await api.listTasks(p.id)
        all.push(...tasks)
      }),
    )
    return all.filter((t) => t.assigneeId === userId && t.status !== 'done')
  }, [userId])

  const trend = overview.data?.trend || []
  const totalTasks =
    overview.data?.tasksByStatus.todo +
    overview.data?.tasksByStatus.in_progress +
    overview.data?.tasksByStatus.review +
    overview.data?.tasksByStatus.done || 0

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 顶部欢迎区 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-3xl text-white">你好,{user?.name?.split('')[0]} 👋</p>
          <p className="mt-1 text-sm text-muted">今天有 {tasks.data?.length || 0} 个任务待你推进。</p>
        </div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-soft transition hover:bg-brand/20"
        >
          打开项目 <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-4 animate-stagger lg:grid-cols-4">
        <StatCard
          title="进行中项目"
          value={overview.data?.activeProjects ?? 0}
          icon={<FolderKanban className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          title="任务总量"
          value={totalTasks}
          icon={<ListTodo className="h-5 w-5" />}
          tone="sky"
        />
        <StatCard
          title="已完成项目"
          value={overview.data?.completedProjects ?? 0}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="ok"
        />
        <StatCard
          title="逾期项目"
          value={overview.data?.overdueProjects ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="warn"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 任务状态分布 */}
        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg text-slate-100">
              <Activity className="h-5 w-5 text-brand-soft" /> 任务状态分布
            </h3>
          </div>
          {overview.loading ? (
            <Skeleton className="h-56" />
          ) : (
            <div className="flex flex-col items-center">
              <div className="relative h-48 w-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData(overview.data)}
                      dataKey="value"
                      innerRadius={56}
                      outerRadius={80}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData(overview.data).map((entry) => (
                        <Cell key={entry.name} fill={statusColors[entry.name]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-3xl font-semibold text-white">{totalTasks}</span>
                  <span className="text-xs text-muted">任务总数</span>
                </div>
              </div>
              <div className="mt-4 grid w-full grid-cols-2 gap-2 text-xs">
                {pieData(overview.data).map((d) => (
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

        {/* 近 14 天趋势 */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg text-slate-100">
              <TrendingUp className="h-5 w-5 text-brand-soft" /> 14 天任务趋势
            </h3>
          </div>
          {overview.loading ? (
            <Skeleton className="h-56" />
          ) : trend.length === 0 ? (
            <EmptyState title="暂无数据" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="g-created" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366F1" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g-done" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    contentStyle={{
                      background: '#16203A',
                      border: '1px solid #243054',
                      borderRadius: 12,
                      color: '#E2E8F0',
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="created" name="新建" stroke="#6366F1" fill="url(#g-created)" strokeWidth={2} />
                  <Area type="monotone" dataKey="completed" name="完成" stroke="#10B981" fill="url(#g-done)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* 我的今日任务 */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg text-slate-100">我的待办任务</h3>
          <Link to="/projects" className="text-xs text-brand-soft hover:underline">
            查看全部
          </Link>
        </div>
        {tasks.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : tasks.data && tasks.data.length > 0 ? (
          <ul className="divide-y divide-bg-border">
            {tasks.data.slice(0, 8).map((t) => {
              const due = dueLabel(t.dueDate)
              return (
                <Link
                  key={t.id}
                  to={`/projects/${t.projectId}`}
                  className="flex items-center gap-3 py-3 transition hover:bg-bg-soft/40"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="flex-1 truncate text-sm text-slate-100">{t.title}</span>
                  <PriorityBadge priority={t.priority} />
                  <StatusBadge status={t.status} />
                  <span
                    className={cn(
                      'text-xs',
                      due.tone === 'overdue' && 'text-danger',
                      due.tone === 'soon' && 'text-warn',
                      due.tone === 'none' && 'text-muted',
                      due.tone === 'normal' && 'text-slate-300',
                    )}
                  >
                    {due.text}
                  </span>
                </Link>
              )
            })}
          </ul>
        ) : (
          <EmptyState title="今日暂无任务" hint="先到项目中认领一些吧" />
        )}
      </Card>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string
  value: number
  icon: React.ReactNode
  tone: 'brand' | 'sky' | 'ok' | 'warn'
}) {
  const tones = {
    brand: 'from-brand/20 to-brand/5 text-brand-soft',
    sky: 'from-sky-500/20 to-sky-500/5 text-sky-300',
    ok: 'from-emerald-500/20 to-emerald-500/5 text-ok',
    warn: 'from-amber-500/20 to-amber-500/5 text-warn',
  }
  return (
    <Card className="overflow-hidden">
      <div className={cn('flex items-center gap-3 bg-gradient-to-br px-5 py-4', tones[tone])}>
        <div>{icon}</div>
        <div>
          <p className="text-xs text-muted">{title}</p>
          <p className="font-mono text-2xl font-semibold text-white">
            {value.toString().padStart(2, '0')}
          </p>
        </div>
      </div>
    </Card>
  )
}

function pieData(o?: StatsOverview) {
  return [
    { name: 'todo', value: o?.tasksByStatus.todo || 0 },
    { name: 'in_progress', value: o?.tasksByStatus.in_progress || 0 },
    { name: 'review', value: o?.tasksByStatus.review || 0 },
    { name: 'done', value: o?.tasksByStatus.done || 0 },
  ].filter((d) => d.value > 0)
}

function statusLabel(s: string) {
  return s === 'todo' ? '待办' : s === 'in_progress' ? '进行中' : s === 'review' ? '审核中' : '已完成'
}