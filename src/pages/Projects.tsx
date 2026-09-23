// 项目列表页

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, ArrowRight, Download, Trash2, Check, X } from 'lucide-react'
import { useSwr } from '@/lib/cache'
import { useDebounce } from '@/hooks/useDebounce'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Card, Button, Input, EmptyState, Avatar } from '@/components/ui'
import { CardSkeleton } from '@/components/Skeleton'
import ProjectDialog, { ProjectStatusBadge, ProjectTypeBadge } from '@/components/ProjectDialog'
import { useAppStore } from '@/stores/app'
import { fmtDate } from '@/lib/date'
import type { Project } from '../../shared/types'

export default function Projects() {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [rejecting, setRejecting] = useState<Project | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [rejectError, setRejectError] = useState('')
  const debouncedKeyword = useDebounce(keyword, 300)
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const projects = useSwr<Project[]>(
    `projects:list:kw=${debouncedKeyword}:status=${filter}`,
    () => api.listProjects().then((r) => r.projects),
  )
  const notify = useAppStore((s) => s.notify)
  const user = useAppStore((s) => s.user)
  // 管理员/项目核算人员可审批删除申请
  const isApprover = user?.role === 'admin' || user?.role === 'finance'
  const reload = projects.revalidate

  const filtered = (projects.data || []).filter((p) => {
    if (filter === 'active' && p.status !== 'active') return false
    if (filter === 'completed' && p.status !== 'completed') return false
    if (debouncedKeyword && !p.name.includes(debouncedKeyword) && !p.description.includes(debouncedKeyword)) return false
    return true
  })

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-text-primary">项目</h2>
          <p className="mt-1 text-sm text-muted">管理你的全部项目与协作进度</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={async () => {
            try {
              await api.exportProjectsCsv()
              notify('success', '项目导出成功')
            } catch (e) {
              notify('error', getErrorMessage(e, '导出失败'))
            }
          }}>
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
                (filter === v ? 'bg-brand text-text-primary shadow-glow' : 'text-muted hover:text-text-secondary')
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
            <CardSkeleton key={i} rows={4} />
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
                  <div className="flex items-center gap-2">
                    <ProjectTypeBadge type={p.projectType} />
                    {p.mergedIntoProjectId && (
                      <span className="rounded-md bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-400">已合并</span>
                    )}
                    <ProjectStatusBadge status={p.status} />
                    {p.deleteRequestedAt && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                        删除审批中
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.deleteRequestedAt && isApprover && (
                      <>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (confirm(`批准删除项目「${p.name}」？该项目下所有任务将移入回收站。`)) {
                              api.approveProjectDeletion(p.id).then(() => { notify('success', '已批准并删除项目'); reload() }).catch((err) => notify('error', getErrorMessage(err, '操作失败')))
                            }
                          }}
                          className="rounded p-1 text-emerald-500 transition hover:bg-emerald-500/10"
                          title="批准删除"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setRejectComment('')
                            setRejectError('')
                            setRejecting(p)
                          }}
                          className="rounded p-1 text-muted transition hover:bg-bg-soft"
                          title="驳回删除申请"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {(user?.role === 'admin' || p.ownerId === user?.id) && !p.deleteRequestedAt && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const hint = user?.role === 'admin'
                            ? `确定删除项目「${p.name}」？该项目下所有任务将移入回收站。`
                            : `删除项目「${p.name}」需提交申请，经管理员或项目核算人员审批后才会删除。是否提交？`
                          if (!confirm(hint)) return
                          api.deleteProject(p.id).then((r) => {
                            notify(r.pendingApproval ? 'info' : 'success', r.pendingApproval ? (r.message || '已提交删除申请') : '项目已删除')
                            reload()
                          }).catch((err) => notify('error', getErrorMessage(err, '删除失败')))
                        }}
                        className="rounded p-1 text-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                        title="删除项目"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-1 group-hover:text-brand-soft" />
                  </div>
                </div>
                <h3 className="mb-1 font-display text-lg text-text-primary">{p.name}</h3>
                <p className="mb-4 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{p.description}</p>
                {p.deleteRejectComment && !p.deleteRequestedAt && (
                  <p className="mb-3 rounded-lg bg-danger/10 px-2 py-1.5 text-xs text-danger">
                    上次删除申请被驳回{p.deleteRejectComment ? `：${p.deleteRejectComment}` : ''}
                  </p>
                )}
                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>进度</span>
                    <span className="font-mono text-text-secondary">{p.progress}%</span>
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

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-text-primary">驳回删除申请</h3>
              <button onClick={() => setRejecting(null)} className="p-1 text-muted hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-bg-soft p-3">
                <div className="text-xs text-muted">项目</div>
                <div className="mt-1 text-sm text-text-primary">{rejecting.name}</div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">驳回原因（可选，将通知申请人）</label>
                <Input
                  value={rejectComment}
                  onChange={(e) => {
                    setRejectComment(e.target.value)
                    if (rejectError) setRejectError('')
                  }}
                  placeholder="请输入驳回原因..."
                />
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className={rejectError ? 'text-danger' : 'text-muted'}>
                    {rejectError || '最多 200 字，将随通知发送给申请人'}
                  </span>
                  <span className={
                    rejectComment.length > 200
                      ? 'font-medium text-danger'
                      : rejectComment.length >= 180
                        ? 'text-warn'
                        : 'text-muted'
                  }>
                    {rejectComment.length}/200
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setRejecting(null)} className="flex-1">取消</Button>
              <Button
                onClick={async () => {
                  const comment = rejectComment.trim()
                  if (comment.length > 200) {
                    setRejectError('驳回原因最多 200 字，请精简后再提交')
                    return
                  }
                  try {
                    await api.rejectProjectDeletion(rejecting.id, { comment })
                    notify('success', '已驳回删除申请')
                    setRejecting(null)
                    setRejectComment('')
                    reload()
                  } catch (err) {
                    notify('error', getErrorMessage(err, '操作失败'))
                  }
                }}
                className="flex-1 bg-danger hover:bg-danger/80"
              >
                确认驳回
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}