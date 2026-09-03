import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ResponsiveContainer,
} from 'recharts'
import { Clock, TrendingUp, Users2, Building2, DollarSign, PieChart } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Skeleton, EmptyState, Input } from '@/components/ui'
import { cn, sortUsers, getUserSortOrder } from '@/lib/utils'
import type { TaskHours, User, Project, HoursByUserProject, ProjectCostSummary } from '../../shared/types'

const categoryLabels: Record<string, string> = {
  labor: '内部人力',
  outsource: '外包费用',
  hardware: '硬件设备',
  software: '软件服务',
  other: '其他',
}

export default function HoursReport() {
  const [projectId, setProjectId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const projects = useAsync<Project[]>(() => api.listProjects().then((r) => r.projects), [])
  const users = useAsync<User[]>(() => api.listUsers().then((r) => r.users), [])
  const myHours = useAsync<TaskHours[]>(() => api.listMyHours().then((r) => r.hours), [])
  const hoursByUser = useAsync<HoursByUserProject[]>(() => api.listHoursByUser(startDate, endDate).then((r) => r.data), [startDate, endDate])
  const projectCost = useAsync<ProjectCostSummary[]>(() => api.listProjectCost(projectId || undefined).then((r) => r.data), [projectId])

  const filteredHours = useMemo(() => {
    return myHours.data?.filter((h) => {
      if (userId && h.userId !== userId) return false
      if (startDate && h.date < startDate) return false
      if (endDate && h.date > endDate) return false
      return true
    }) || []
  }, [myHours.data, userId, startDate, endDate])

  const totalPlanned = useMemo(() => filteredHours.reduce((sum, h) => sum + h.plannedHours, 0), [filteredHours])
  const totalActual = useMemo(() => filteredHours.reduce((sum, h) => sum + h.actualHours, 0), [filteredHours])
  const variance = totalActual - totalPlanned
  const variancePercent = totalPlanned > 0 ? ((variance / totalPlanned) * 100).toFixed(1) : '0'

  const hoursByDate = useMemo(() => {
    return filteredHours.reduce((acc, h) => {
      acc[h.date] = acc[h.date] || { date: h.date, planned: 0, actual: 0 }
      acc[h.date].planned += h.plannedHours
      acc[h.date].actual += h.actualHours
      return acc
    }, {} as Record<string, { date: string; planned: number; actual: number }>)
  }, [filteredHours])

  const chartData = useMemo(() => Object.values(hoursByDate).sort((a, b) => a.date.localeCompare(b.date)), [hoursByDate])

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
      hoursByUser.data?.forEach((u) => {
        const p = u.projects.find((proj) => proj.projectId === pid)
        if (p) {
          planned += p.plannedHours
          actual += p.actualHours
        }
      })
      acc[pid] = { planned, actual }
      return acc
    }, {} as Record<string, { planned: number; actual: number }>)
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
        <p className="mt-1 text-sm text-muted">查看计划工时与实际工时的统计分析</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted">项目</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
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
              {sortUsers(users.data || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
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

      <div className="grid gap-6 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">计划工时</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text-primary">{totalPlanned.toFixed(1)}</span>
            <span className="text-xs text-muted">小时</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">实际工时</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-text-primary">{totalActual.toFixed(1)}</span>
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
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">偏差率</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn('font-mono text-2xl font-semibold', variance >= 0 ? 'text-warn' : 'text-success')}>
              {variancePercent}%
            </span>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <Clock className="h-5 w-5 text-brand-soft" /> 工时趋势
          </h3>
          {myHours.loading ? (
            <Skeleton className="h-64" />
          ) : chartData.length === 0 ? (
            <EmptyState title="暂无工时数据" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
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
                  <Bar dataKey="planned" name="计划" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name="实际" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-text-primary">
            <Users2 className="h-5 w-5 text-brand-soft" /> 人员工时统计
          </h3>
          {myHours.loading ? (
            <Skeleton className="h-64" />
          ) : Object.keys(hoursByUserSimple).length === 0 ? (
            <EmptyState title="暂无工时数据" />
          ) : (
            <div className="space-y-3">
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
        {hoursByUser.loading ? (
          <Skeleton className="h-80" />
        ) : hoursByUser.data?.length === 0 ? (
          <EmptyState title="暂无工时数据" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border">
                  <th className="sticky left-0 z-10 bg-bg-soft text-left py-3 px-4 font-medium text-muted">人员</th>
                  {uniqueProjects.map((pid) => (
                    <th key={pid} className="text-center py-3 px-4 font-medium text-muted">
                      {projectNames[pid]}
                    </th>
                  ))}
                  <th className="text-center py-3 px-4 font-medium text-muted">合计</th>
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
                              <div className="font-mono text-sm text-text-secondary">{p.actualHours.toFixed(1)}h</div>
                              <div className="text-xs text-muted">计划: {p.plannedHours.toFixed(1)}h</div>
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="text-center py-3 px-4">
                      <div className="space-y-1">
                        <div className="font-mono font-medium text-text-primary">{u.totalActual.toFixed(1)}h</div>
                        <div className="text-xs text-muted">计划: {u.totalPlanned.toFixed(1)}h</div>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="bg-bg-soft">
                  <td className="sticky left-0 z-10 bg-bg-soft py-3 px-4 font-semibold text-text-primary">项目合计</td>
                  {uniqueProjects.map((pid) => {
                    const totals = totalHoursByProject[pid]
                    return (
                      <td key={pid} className="text-center py-3 px-4 font-semibold">
                        <div className="space-y-1">
                          <div className="font-mono text-success">{totals?.actual.toFixed(1) || '0'}h</div>
                          <div className="text-xs text-muted">计划: {(totals?.planned || 0).toFixed(1)}h</div>
                        </div>
                      </td>
                    )
                  })}
                  <td className="text-center py-3 px-4 font-semibold text-brand">
                    <div className="space-y-1">
                      <div className="font-mono">{(hoursByUser.data?.reduce((sum, u) => sum + u.totalActual, 0) || 0).toFixed(1)}h</div>
                      <div className="text-xs text-muted">计划: {(hoursByUser.data?.reduce((sum, u) => sum + u.totalPlanned, 0) || 0).toFixed(1)}h</div>
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
          {projectCost.loading ? (
            <Skeleton className="h-80" />
          ) : projectCost.data?.length === 0 ? (
            <EmptyState title="暂无成本数据" />
          ) : (
            <div className="space-y-4">
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
          {projectCost.loading ? (
            <Skeleton className="h-80" />
          ) : categoryChartData.length === 0 ? (
            <EmptyState title="暂无成本数据" />
          ) : (
            <div className="space-y-4">
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
        {projectCost.loading ? (
          <Skeleton className="h-64" />
        ) : projectCost.data?.length === 0 ? (
          <EmptyState title="暂无成本数据" />
        ) : (
          <div className="space-y-4">
            {projectCost.data?.map((project) => (
              <div key={project.projectId}>
                <div className="mb-2 font-medium text-text-primary">{project.projectName}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-bg-border">
                        <th className="text-left py-2 px-3 font-medium text-muted">人员</th>
                        <th className="text-left py-2 px-3 font-medium text-muted">类型</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">单价(RMB/h)</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">总工数(h)</th>
                        <th className="text-right py-2 px-3 font-medium text-muted">总成本(RMB)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.memberCosts.map((member) => (
                        <tr key={member.userId} className="border-b border-bg-border/50">
                          <td className="py-2 px-3 text-text-secondary">{member.userName}</td>
                          <td className="py-2 px-3">
                            <span className={cn('px-2 py-0.5 rounded-full text-xs', member.isOutsourced ? 'bg-warn/20 text-warn' : 'bg-success/20 text-success')}>
                              {member.isOutsourced ? '外包' : '内部'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-text-secondary">{member.hourlyRate || '-'}</td>
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
        {myHours.loading ? (
          <Skeleton className="h-64" />
        ) : filteredHours.length === 0 ? (
          <EmptyState title="暂无工时记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border">
                  <th className="text-left py-3 px-4 font-medium text-muted">日期</th>
                  <th className="text-left py-3 px-4 font-medium text-muted">任务</th>
                  <th className="text-right py-3 px-4 font-medium text-muted">计划工时</th>
                  <th className="text-right py-3 px-4 font-medium text-muted">实际工时</th>
                  <th className="text-right py-3 px-4 font-medium text-muted">偏差</th>
                  <th className="text-left py-3 px-4 font-medium text-muted">说明</th>
                </tr>
              </thead>
              <tbody>
                {filteredHours.map((h) => (
                  <tr key={h.id} className="border-b border-bg-border/50 hover:bg-bg-soft/50">
                    <td className="py-3 px-4 text-text-secondary">{h.date}</td>
                    <td className="py-3 px-4 text-text-secondary">任务 #{h.taskId.slice(0, 8)}</td>
                    <td className="py-3 px-4 text-right font-mono text-text-secondary">{h.plannedHours.toFixed(1)}h</td>
                    <td className="py-3 px-4 text-right font-mono text-text-secondary">{h.actualHours.toFixed(1)}h</td>
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