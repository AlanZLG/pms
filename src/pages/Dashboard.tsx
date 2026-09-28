import { Link } from 'react-router-dom'
import {
  FolderKanban,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ListTodo,
  ArrowRight,
  TrendingUp,
  Clock,
  Users2,
  Calendar,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { useSwr } from '@/lib/cache'
import { api } from '@/lib/api'
import { Card, Skeleton as UiSkeleton, EmptyState, PriorityBadge, StatusBadge } from '@/components/ui'
import { StatSkeleton, CardSkeleton, Skeleton } from '@/components/Skeleton'
import { useAppStore } from '@/stores/app'
import { dueLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task, StatsOverview, BurndownData, Project, BudgetWithProject } from '../../shared/types'
import { STATUS_COLORS_HEX, PROJECT_STATUS_META } from '@/lib/constants'
import { useMemo, useState } from 'react'

const PROJECT_STATUS_ORDER: Record<string, number> = { active: 0, planning: 1, completed: 2, archived: 3 }

const STAT_CARD_TONES: Record<string, string> = {
  brand: 'from-brand/20 to-brand/5 text-brand-soft',
  sky: 'from-sky-500/20 to-sky-500/5 text-sky-300',
  ok: 'from-emerald-500/20 to-emerald-500/5 text-ok',
  warn: 'from-amber-500/20 to-amber-500/5 text-warn',
}

const BUDGET_CATEGORY_LABELS: Record<string, string> = {
  labor: '内部人力',
  outsource: '外包费用',
  hardware: '硬件设备',
  software: '软件服务',
  other: '其他',
}

const APPROVAL_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
  rejected: '已拒绝',
}

export default function Dashboard() {
  const user = useAppStore((s) => s.user)
  const userId = user?.id || ''
  const overview = useSwr<StatsOverview>('overview', () => api.overview())
  const burndown = useSwr<BurndownData>('burndown:all', () => api.burndown(''))
  const projects = useSwr<{ projects: Project[] }>('projects:list', () => api.listProjects())
// 待办任务 + 我负责项目的逾期任务（同一批请求内派生，避免重复拉取）
type OverdueTask = Task & { projectName: string }
const tasks = useSwr<{ mine: Task[]; overdue: OverdueTask[] }>(userId ? `tasks:user:${userId}` : null, async () => {
  if (!userId) return { mine: [], overdue: [] }
  const { projects } = await api.listProjects()
  const all: Task[] = []
  const nameById = new Map<string, string>()
  const ownedIds = new Set(projects.filter((p) => p.ownerId === userId).map((p) => p.id))
  await Promise.all(
    projects.map(async (p) => {
      nameById.set(p.id, p.name)
      const { tasks } = await api.listTasks(p.id)
      all.push(...tasks)
    }),
  )
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const mine = all.filter((t) => t.assigneeId === userId && t.status !== 'done')
  const overdue: OverdueTask[] = all
    .filter(
      (t) =>
        ownedIds.has(t.projectId) &&
        t.status !== 'done' &&
        !!t.dueDate &&
        t.dueDate.slice(0, 10) < todayStr,
    )
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .map((t) => ({ ...t, projectName: nameById.get(t.projectId) || '' }))
  return { mine, overdue }
})
const [todoTab, setTodoTab] = useState<'mine' | 'overdue' | 'budget'>('mine')
const myBudgets = useSwr<BudgetWithProject[]>(userId ? 'budgets:mine' : null, async () => {
  const { budgets } = await api.myBudgets()
  return budgets
})

  const trend = overview.data?.trend || []
  const totalTasks =
    overview.data?.tasksByStatus.todo +
    overview.data?.tasksByStatus.in_progress +
    overview.data?.tasksByStatus.review +
    overview.data?.tasksByStatus.done || 0

  const projectList: Project[] = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const sortedProjects = useMemo(() => {
    return [...projectList].sort((a, b) => {
      return PROJECT_STATUS_ORDER[a.status] - PROJECT_STATUS_ORDER[b.status]
    })
  }, [projectList])

  const pieChartData = useMemo(() => pieData(overview.data), [overview.data])

  const isInitialLoading = overview.loading && burndown.loading && projects.loading && tasks.loading

  if (isInitialLoading) {
    return (
      <div className="space-y-6 animate-fade-up">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Skeleton width={180} height={36} className="mb-2" />
            <Skeleton width={240} height={16} />
          </div>
          <Skeleton width={110} height={38} rounded="lg" />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatSkeleton />
          <StatSkeleton />
          <StatSkeleton />
          <StatSkeleton />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <CardSkeleton rows={5} className="lg:col-span-1" />
          <CardSkeleton rows={6} className="lg:col-span-2" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton rows={4} />
          <CardSkeleton rows={4} />
          <CardSkeleton rows={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-3xl text-text-primary">你好,{user?.name?.split('')[0]} 👋</p>
          <p className="mt-1 text-sm text-muted">今天有 {tasks.data?.mine.length || 0} 个任务待你推进。</p>
        </div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-soft transition hover:bg-brand/20"
        >
          打开项目 <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

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
        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg text-text-primary">
              <Activity className="h-5 w-5 text-brand-soft" /> 任务状态分布
            </h3>
          </div>
          {overview.loading ? (
            <UiSkeleton className="h-56" />
          ) : (
            <div className="flex flex-col items-center">
              <div className="relative h-48 w-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      dataKey="value"
                      innerRadius={56}
                      outerRadius={80}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieChartData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS_HEX[entry.name as keyof typeof STATUS_COLORS_HEX]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-3xl font-semibold text-text-primary">{totalTasks}</span>
                  <span className="text-xs text-muted">任务总数</span>
                </div>
              </div>
              <div className="mt-4 grid w-full grid-cols-2 gap-2 text-xs">
                {pieChartData.map((d) => (
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

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-lg text-text-primary">
              <TrendingUp className="h-5 w-5 text-brand-soft" /> 14 天任务趋势
            </h3>
          </div>
          {overview.loading ? (
            <UiSkeleton className="h-56" />
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

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg text-text-primary flex items-center gap-2">
            <Clock className="h-5 w-5 text-brand-soft" /> 项目进度一览
          </h3>
          <Link to="/projects" className="text-xs text-brand-soft hover:underline">
            查看全部项目
          </Link>
        </div>
        {projects.loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <UiSkeleton key={i} className="h-36" />
            ))}
          </div>
        ) : projectList.length > 0 ? (
          <div className="grid gap-4 animate-stagger sm:grid-cols-2 lg:grid-cols-3">
            {sortedProjects.map((project) => (
              <ProjectProgressCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState title="暂无项目" hint="创建一个新项目开始吧" />
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg text-text-primary">我的待办任务</h3>
          <div className="flex items-center gap-1 rounded-lg bg-bg-soft p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTodoTab('mine')}
              className={cn(
                'rounded-md px-2.5 py-1 transition',
                todoTab === 'mine' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-muted hover:text-text-secondary',
              )}
            >
              指派给我 {tasks.data ? `(${tasks.data.mine.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setTodoTab('overdue')}
              className={cn(
                'rounded-md px-2.5 py-1 transition',
                todoTab === 'overdue' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-muted hover:text-text-secondary',
              )}
            >
              负责项目逾期 {tasks.data ? `(${tasks.data.overdue.length})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setTodoTab('budget')}
              className={cn(
                'rounded-md px-2.5 py-1 transition',
                todoTab === 'budget' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-muted hover:text-text-secondary',
              )}
            >
              我的预算 {myBudgets.data ? `(${myBudgets.data.length})` : ''}
            </button>
          </div>
        </div>
        {(todoTab === 'budget' ? myBudgets.loading : tasks.loading) ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <UiSkeleton key={i} className="h-14" />
            ))}
          </div>
        ) : (
          (() => {
            if (todoTab === 'budget') {
              const list = myBudgets.data ?? []
              if (list.length === 0) {
                return <EmptyState title="暂无预算申请" hint="在项目详情的预算面板提交" />
              }
              return (
                <ul className="divide-y divide-bg-border">
                  {list.slice(0, 8).map((b) => (
                    <Link
                      key={b.id}
                      to={`/projects/${b.projectId}`}
                      className="flex items-center gap-3 py-3 transition hover:bg-bg-soft/40"
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', b.approvalStatus === 'rejected' ? 'bg-danger' : b.approvalStatus === 'pending' ? 'bg-warn' : 'bg-ok')} />
                      <span className="max-w-28 shrink-0 truncate rounded bg-bg-soft px-1.5 py-0.5 text-xs text-muted">
                        {b.projectName}
                      </span>
                      <span className="flex-1 truncate text-sm text-text-primary">
                        {BUDGET_CATEGORY_LABELS[b.category] || b.category}
                        {b.description ? ` · ${b.description}` : ''}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-text-secondary">
                        ¥{b.amount.toLocaleString()}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs',
                          b.approvalStatus === 'pending' && 'text-warn',
                          b.approvalStatus === 'approved' && 'text-ok',
                          b.approvalStatus === 'rejected' && 'text-danger',
                        )}
                      >
                        {APPROVAL_LABELS[b.approvalStatus] || b.approvalStatus}
                      </span>
                    </Link>
                  ))}
                </ul>
              )
            }
            const list = todoTab === 'mine' ? tasks.data?.mine ?? [] : tasks.data?.overdue ?? []
            if (list.length === 0) {
              return todoTab === 'mine' ? (
                <EmptyState title="今日暂无任务" hint="先到项目中认领一些吧" />
              ) : (
                <EmptyState title="负责的项目没有逾期任务" hint="继续保持" />
              )
            }
            return (
              <ul className="divide-y divide-bg-border">
                {list.slice(0, 8).map((t) => {
                  const due = dueLabel(t.dueDate, t.status === 'done')
                  return (
                    <Link
                      key={t.id}
                      to={`/projects/${t.projectId}`}
                      className="flex items-center gap-3 py-3 transition hover:bg-bg-soft/40"
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', todoTab === 'overdue' ? 'bg-danger' : 'bg-brand')} />
                      {todoTab === 'overdue' && (
                        <span className="max-w-28 shrink-0 truncate rounded bg-bg-soft px-1.5 py-0.5 text-xs text-muted">
                          {(t as OverdueTask).projectName}
                        </span>
                      )}
                      <span className="flex-1 truncate text-sm text-text-primary">{t.title}</span>
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                      <span
                        className={cn(
                          'text-xs',
                          due.tone === 'overdue' && 'text-danger',
                          due.tone === 'soon' && 'text-warn',
                          due.tone === 'none' && 'text-muted',
                          due.tone === 'normal' && 'text-text-secondary',
                        )}
                      >
                        {due.text}
                      </span>
                    </Link>
                  )
                })}
              </ul>
            )
          })()
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
  return (
    <Card className="overflow-hidden">
      <div className={cn('flex items-center gap-3 bg-gradient-to-br px-5 py-4', STAT_CARD_TONES[tone])}>
        <div>{icon}</div>
        <div>
          <p className="text-xs text-muted">{title}</p>
          <p className="font-mono text-2xl font-semibold text-text-primary">
            {value.toString().padStart(2, '0')}
          </p>
        </div>
      </div>
    </Card>
  )
}

function ProjectProgressCard({ project }: { project: Project }) {
  const status = PROJECT_STATUS_META[project.status]
  const due = dueLabel(project.dueDate, project.status === 'completed')

  return (
    <Link to={`/projects/${project.id}`} className="group">
      <Card className="p-4 h-full transition hover:border-brand/40 hover:shadow-lg">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-text-primary truncate group-hover:text-brand-soft transition">
              {project.name}
            </h4>
            {project.description && (
              <p className="text-xs text-muted mt-0.5 line-clamp-2">{project.description}</p>
            )}
          </div>
          <span className={cn('shrink-0 ml-2 px-2 py-1 rounded text-xs font-medium', status.bg, status.text)}>
            {status.label}
          </span>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted">进度</span>
            <span className="text-xs font-mono font-semibold text-text-primary">{project.progress}%</span>
          </div>
          <div className="h-1.5 bg-bg-border rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                project.progress === 100 ? 'bg-emerald-500' :
                project.progress > 70 ? 'bg-brand' :
                project.progress > 40 ? 'bg-amber-500' : 'bg-sky-500'
              )}
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="flex items-center gap-1">
            <Users2 className="h-3.5 w-3.5" />
            <span>{project.members.length} 人</span>
          </div>
          {project.dueDate && (
            <div className={cn('flex items-center gap-1', due.tone === 'overdue' && 'text-danger', due.tone === 'soon' && 'text-warn')}>
              <Calendar className="h-3.5 w-3.5" />
              <span>{due.text}</span>
            </div>
          )}
        </div>
      </Card>
    </Link>
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
