// 项目列表页

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FolderKanban, ArrowRight, Download } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Button, Input, Skeleton, EmptyState, Avatar } from '@/components/ui'
import ProjectDialog, { ProjectStatusBadge } from '@/components/ProjectDialog'
import { useAppStore } from '@/stores/app'
import { fmtDate } from '@/lib/date'
import type { Project } from '../../shared/types'

export default function Projects() {
  const projects = useAsync<Project[]>(() => api.listProjects().then((r) => r.projects), [])
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const notify = useAppStore((s) => s.notify)
  const reload = projects.reload

  const filtered = (projects.data || []).filter((p) => {
    if (filter === 'active' && p.status !== 'active') return false
    if (filter === 'completed' && p.status !== 'completed') return false
    if (keyword && !p.name.includes(keyword) && !p.description.includes(keyword)) return false
    return true
  })

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-white">项目</h2>
          <p className="mt-1 text-sm text-muted">管理你的全部项目与协作进度</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => api.exportProjectsCsv()}>
            <Download className="h-4 w-4" /> 导出 CSV
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> 新建项目
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="搜索项目"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
          {([['all', '全部'], ['active', '进行中'], ['completed', '已完成']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={
                'rounded-md px-3 py-1.5 text-xs font-medium transition ' +
                (filter === v ? 'bg-brand text-white shadow-glow' : 'text-muted hover:text-slate-200')
              }
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {projects.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无项目" hint="点击右上角新建项目开始协作" />
      ) : (
        <div className="grid gap-4 animate-stagger sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="group h-full p-5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-glow">
                <div className="mb-3 flex items-center justify-between">
                  <ProjectStatusBadge status={p.status} />
                  <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-1 group-hover:text-brand-soft" />
                </div>
                <h3 className="mb-1 font-display text-lg text-slate-100">{p.name}</h3>
                <p className="mb-4 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{p.description}</p>
                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>进度</span>
                    <span className="font-mono text-slate-200">{p.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-soft">
                    <div
                      className="h-full rounded-full bg-brand-grad"
                      style={{ width: `${p.progress}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {p.members.slice(0, 4).map((m) => (
                      <Avatar
                        key={m.userId}
                        name={m.user?.name || '?'}
                        color={m.user?.avatarColor || '#475569'}
                        size={26}
                      />
                    ))}
                    {p.members.length > 4 && (
                      <div className="grid h-[26px] w-[26px] place-items-center rounded-full border border-bg bg-bg-soft text-[10px] text-muted">
                        +{p.members.length - 4}
                      </div>
                    )}
                    {p.members.length === 0 && (
                      <div className="grid h-[26px] w-[26px] place-items-center rounded-full border border-dashed border-bg-border text-[10px] text-muted">
                        0
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted">
                    {p.dueDate ? `截止 ${fmtDate(p.dueDate, 'MM-dd')}` : '无截止'}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <ProjectDialog
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={async (data) => {
          await api.createProject(data)
          notify('success', '项目已创建')
          reload()
        }}
      />
    </div>
  )
}