// 项目列表页

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, ArrowRight, Download, Trash2, Check, X, LayoutGrid, List, Pencil } from 'lucide-react'
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
  // 视图切换（卡片/表格），localStorage 记住偏好
  const [view, setView] = useState<'card' | 'table'>(() => (localStorage.getItem('projects:view') === 'table' ? 'table' : 'card'))
  const switchView = (v: 'card' | 'table') => {
    setView(v)
    localStorage.setItem('projects:view', v)
  }
  // 表格排序：默认序号升序
  const [sortKey, setSortKey] = useState<'seq' | 'name' | 'dueDate'>('seq')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = (key: 'seq' | 'name' | 'dueDate') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }
  // 卡片排序：默认最新创建在前，可切序号升/降序（localStorage 记住偏好）
  const [cardSort, setCardSort] = useState<'seq-asc' | 'seq-desc' | 'created-desc' | 'created-asc'>(() => {
    const v = localStorage.getItem('projects:cardSort')
    return v === 'seq-asc' || v === 'seq-desc' || v === 'created-asc' ? v : 'created-desc'
  })
  const switchCardSort = (v: 'seq-asc' | 'seq-desc' | 'created-desc' | 'created-asc') => {
    setCardSort(v)
    localStorage.setItem('projects:cardSort', v)
  }
  const navigate = useNavigate()
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

  // 排序：表格按列排序（默认序号升序）；卡片按排序器（默认最新创建在前）
  const seqVal = (s: number | null | undefined) => (s ?? Number.MAX_SAFE_INTEGER)
  const sorted = [...filtered].sort((a, b) => {
    if (view === 'table') {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'seq') return (seqVal(a.seq) - seqVal(b.seq)) * dir
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'zh') * dir
      const av = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      const bv = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      return (av - bv) * dir
    }
    if (cardSort === 'seq-asc' || cardSort === 'seq-desc') {
      return (seqVal(a.seq) - seqVal(b.seq)) * (cardSort === 'seq-asc' ? 1 : -1)
    }
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * (cardSort === 'created-asc' ? 1 : -1)
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
        {view === 'card' && (
          <select
            value={cardSort}
            onChange={(e) => switchCardSort(e.target.value as 'seq-asc' | 'seq-desc' | 'created-desc' | 'created-asc')}
            title="卡片排序"
            className="rounded-lg border border-bg-border bg-bg-soft px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-brand"
          >
            <option value="created-desc">最新创建</option>
            <option value="created-asc">最早创建</option>
            <option value="seq-asc">序号升序</option>
            <option value="seq-desc">序号降序</option>
          </select>
        )}
        <div className="ml-auto flex gap-1 rounded-lg bg-bg-soft p-1">
          <button
            onClick={() => switchView('card')}
            title="卡片视图"
            className={'rounded-md px-2 py-1.5 transition ' + (view === 'card' ? 'bg-brand text-text-primary' : 'text-muted hover:text-text-secondary')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => switchView('table')}
            title="表格视图"
            className={'rounded-md px-2 py-1.5 transition ' + (view === 'table' ? 'bg-brand text-text-primary' : 'text-muted hover:text-text-secondary')}
          >
            <List className="h-4 w-4" />
          </button>
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
      ) : view === 'table' ? (
        <div className="overflow-hidden rounded-2xl border border-bg-border bg-bg-panel/70 shadow-card backdrop-blur animate-fade-up">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">
                    <button onClick={() => toggleSort('seq')} className="flex items-center gap-1 hover:text-text-secondary">
                      序号{sortKey === 'seq' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-text-secondary">
                      项目名称{sortKey === 'name' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">负责人</th>
                  <th className="px-4 py-3 font-medium">进度</th>
                  <th className="px-4 py-3 font-medium">
                    <button onClick={() => toggleSort('dueDate')} className="flex items-center gap-1 hover:text-text-secondary">
                      截止日期{sortKey === 'dueDate' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="cursor-pointer border-b border-bg-border/60 transition last:border-0 hover:bg-bg-soft/60"
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <SeqCell project={p} canEdit={user?.role === 'admin' || p.ownerId === user?.id} onSaved={reload} />
                    </td>
                    <td className="max-w-[18rem] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <NameCell project={p} canEdit={user?.role === 'admin' || p.ownerId === user?.id} onSaved={reload} />
                        {p.mergedIntoProjectId && (
                          <span className="whitespace-nowrap rounded-md bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-400">已合并</span>
                        )}
                        {p.deleteRequestedAt && (
                          <span className="whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">删除审批中</span>
                        )}
                      </div>
                      {p.description && <div className="mt-0.5 line-clamp-1 text-xs text-muted">{p.description}</div>}
                    </td>
                    <td className="px-4 py-3"><ProjectTypeBadge type={p.projectType} /></td>
                    <td className="px-4 py-3"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted" title="项目负责人">
                        <span className="h-2 w-2 rounded-full" style={{ background: p.ownerAvatar || '#475569' }} />
                        <span className="max-w-[8rem] truncate text-text-secondary">{p.ownerName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-soft">
                          <div className="h-full rounded-full bg-brand-grad" style={{ width: `${p.progress}%` }} />
                        </div>
                        <span className="font-mono text-xs text-muted">{p.progress}%</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {p.dueDate ? fmtDate(p.dueDate, 'yyyy-MM-dd') : '无截止'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 animate-stagger sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="group h-full p-5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-glow">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-muted" title="项目序号">
                      #{p.seq ?? '-'}
                    </span>
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
                <h3 className="mb-1 font-display text-lg text-text-primary">
                  <NameCell project={p} canEdit={user?.role === 'admin' || p.ownerId === user?.id} onSaved={reload} />
                </h3>
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
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted" title="项目负责人">
                      <span className="h-2 w-2 rounded-full" style={{ background: p.ownerAvatar || '#475569' }} />
                      <span className="max-w-[8rem] truncate text-text-secondary">{p.ownerName}</span>
                    </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl max-h-[85vh] overflow-y-auto">
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

// 表格视图的序号单元格：项目负责人/管理员可点击编辑，保存后按插入式顺延重排
function SeqCell({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const notify = useAppStore((s) => s.notify)

  async function commit() {
    setEditing(false)
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n === project.seq) return
    try {
      await api.updateProjectSeq(project.id, n)
      notify('success', '序号已更新，受影响项目已自动顺延')
      onSaved()
    } catch (err) {
      notify('error', getErrorMessage(err, '修改序号失败'))
    }
  }

  if (!canEdit) {
    return <span className="font-mono text-sm text-text-secondary" title="项目序号">#{project.seq ?? '-'}</span>
  }
  if (!editing) {
    return (
      <button
        onClick={() => { setValue(String(project.seq ?? '')); setEditing(true) }}
        className="group/seq flex items-center gap-1 font-mono text-sm text-text-secondary"
        title="点击修改序号"
      >
        #{project.seq ?? '-'}
        <Pencil className="h-3 w-3 opacity-0 transition group-hover/seq:opacity-60" />
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={value}
      inputMode="numeric"
      onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className="w-16 rounded-md border border-brand bg-bg-soft px-1.5 py-0.5 text-center font-mono text-sm text-text-primary outline-none"
    />
  )
}

// 项目名称单元格：项目负责人/管理员可点击原位改名（卡片/表格通用）；点击时阻断外层卡片/行的跳转
function NameCell({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const notify = useAppStore((s) => s.notify)

  async function commit() {
    setEditing(false)
    const name = value.trim()
    if (!name || name === project.name) return
    try {
      await api.updateProject(project.id, { name })
      notify('success', '项目名称已更新')
      onSaved()
    } catch (err) {
      notify('error', getErrorMessage(err, '修改项目名称失败'))
    }
  }

  const blockNav = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation() }

  if (editing) {
    return (
      <span onClick={blockNav} className="min-w-0 flex-1">
        <input
          autoFocus
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full min-w-0 rounded-md border border-brand bg-bg-soft px-1.5 py-0.5 text-sm text-text-primary outline-none"
        />
      </span>
    )
  }
  if (!canEdit) {
    return <span className="truncate font-medium text-text-primary">{project.name}</span>
  }
  return (
    <span
      onClick={blockNav}
      className="group/name inline-flex min-w-0 max-w-full items-center gap-1"
    >
      <button
        onClick={() => { setValue(project.name); setEditing(true) }}
        className="max-w-full truncate text-left font-medium text-text-primary hover:text-brand-soft"
        title="点击修改项目名称"
      >
        {project.name}
      </button>
      <Pencil className="h-3 w-3 flex-shrink-0 opacity-0 transition group-hover/name:opacity-60" />
    </span>
  )
}