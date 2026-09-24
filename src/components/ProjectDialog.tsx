// 创建/编辑项目的对话框

import { useState, type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, User, Layers } from 'lucide-react'
import { Button, Input, Textarea } from '@/components/ui'
import { cn, sortUsers } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import type { ProjectStatus, User as UserType, ProjectTemplate, ProjectType, TemplateCategory } from '../../shared/types'
import { PROJECT_TYPES, TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_DEFAULT_TYPE } from '../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    description: string
    status: ProjectStatus
    projectType: ProjectType
    dueDate: string | null
    ownerId?: string
    templateId?: string
  }) => Promise<void>
  title?: string
  defaultValues?: Partial<{ name: string; description: string; status: ProjectStatus; projectType: ProjectType; dueDate: string; ownerId: string }>
}

const statusOptions: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: '规划中' },
  { value: 'active', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

export default function ProjectDialog({
  open,
  onClose,
  onSubmit,
  title = '新建项目',
  defaultValues,
}: Props) {
  const [name, setName] = useState(defaultValues?.name || '')
  const [projectType, setProjectType] = useState<ProjectType | ''>(defaultValues?.projectType || '')
  const [description, setDescription] = useState(defaultValues?.description || '')
  const [status, setStatus] = useState<ProjectStatus>(defaultValues?.status || 'planning')
  const [dueDate, setDueDate] = useState(defaultValues?.dueDate?.slice(0, 10) || '')
  const [ownerId, setOwnerId] = useState(defaultValues?.ownerId || '')
  const [templateId, setTemplateId] = useState('')
  const [typeError, setTypeError] = useState('')
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<UserType[]>([])
  const [templates, setTemplates] = useState<(ProjectTemplate & { taskCount: number; budgetCount: number; kanbanColumnCount: number })[]>([])
  const currentUser = useAppStore((s) => s.user)

  useEffect(() => {
    if (open) {
      api.listUsers().then((r) => setUsers(sortUsers(r.users || []))).catch(() => {})
      api.listProjectTemplates().then((r) => setTemplates(r.templates || [])).catch(() => {})
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setName(defaultValues?.name || '')
      setProjectType(defaultValues?.projectType || '')
      setDescription(defaultValues?.description || '')
      setStatus(defaultValues?.status || 'planning')
      setDueDate(defaultValues?.dueDate?.slice(0, 10) || '')
      setOwnerId(defaultValues?.ownerId || '')
      setTemplateId('')
    }
  }, [open, defaultValues])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const isAdmin = currentUser?.role === 'admin'
  const selectedTemplate = templates.find(t => t.id === templateId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // v1.8.5：项目类型必选
    if (!projectType) {
      setTypeError('请先选择项目类型')
      return
    }
    setTypeError('')
    setLoading(true)
    try {
      await onSubmit({
        name,
        projectType: projectType as ProjectType,
        description,
        status,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        ownerId: isAdmin && ownerId ? ownerId : undefined,
        templateId: templateId || undefined,
      })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-6 animate-pop-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-text-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted">项目类型 <span className="text-rose-400">*</span></label>
            <div className="grid grid-cols-6 gap-2">
              {PROJECT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setProjectType(t); setTypeError('') }}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-xs font-medium transition',
                    projectType === t
                      ? 'border-brand bg-brand/15 text-brand-soft'
                      : 'border-bg-border bg-bg-soft text-text-secondary hover:border-brand/40',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            {typeError ? (
              <p className="mt-1 text-[11px] text-rose-400">{typeError}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted">运维项目/运维增强登记运维台账，其余类型记录课题表</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">项目名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="如:Fortune 后台重构" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">描述</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="用一两句话说明项目目标"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-muted">状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted">截止日期</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
              <Layers className="h-3 w-3" /> 项目模板（可选）
            </label>
            <select
              value={templateId}
              onChange={(e) => {
                const id = e.target.value
                setTemplateId(id)
                // v1.8.6：选择模板后按模板分类预填项目类型（仍可手动修改）
                const tpl = templates.find((t) => t.id === id)
                if (tpl?.category) {
                  setProjectType(TEMPLATE_CATEGORY_DEFAULT_TYPE[tpl.category as TemplateCategory])
                  setTypeError('')
                }
              }}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
            >
              <option value="">不使用模板</option>
              {/* 按模板分类分组（v1.8.6）；历史未分类模板放最后 */}
              {TEMPLATE_CATEGORIES.map((cat) => {
                const group = templates.filter((t) => t.category === cat)
                if (!group.length) return null
                return (
                  <optgroup key={cat} label={cat}>
                    {group.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.taskCount}个任务, {t.budgetCount}个预算类别)
                      </option>
                    ))}
                  </optgroup>
                )
              })}
              {templates.some((t) => !t.category) && (
                <optgroup label="未分类">
                  {templates.filter((t) => !t.category).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.taskCount}个任务, {t.budgetCount}个预算类别)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {selectedTemplate && (
              <div className="mt-2 rounded-lg bg-bg-soft p-2 text-xs text-muted">
                <p className="font-medium text-text-secondary">{selectedTemplate.description || '暂无描述'}</p>
                {selectedTemplate.category && (
                  <p className="mt-1 text-brand-soft">分类：{selectedTemplate.category}（已按分类预填项目类型，可修改）</p>
                )}
                <div className="mt-1 flex gap-3">
                  <span>任务: {selectedTemplate.taskCount}</span>
                  <span>预算类别: {selectedTemplate.budgetCount}</span>
                  <span>看板列: {selectedTemplate.kanbanColumnCount}</span>
                </div>
              </div>
            )}
          </div>
          {isAdmin && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
                <User className="h-3 w-3" /> 项目负责人
              </label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
              >
                <option value="">默认(创建者)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted">创建后自动加入项目成员</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '保存中…' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

// 共享:类型徽章（v1.8.5 项目类型，v1.8.7 扩为五类 / v1.8.6 模板分类同色）
const typeCls: Record<ProjectType, string> = {
  运维项目: 'bg-sky-500/15 text-sky-400',
  开发项目: 'bg-violet-500/15 text-violet-400',
  咨询项目: 'bg-amber-500/15 text-amber-500',
  实施项目: 'bg-emerald-500/15 text-emerald-500',
  产品迭代: 'bg-fuchsia-500/15 text-fuchsia-400',
  运维增强: 'bg-orange-500/15 text-orange-400',
}
export function ProjectTypeBadge({ type }: { type?: ProjectType | null }) {
  if (!type) return null
  return <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', typeCls[type])}>{type}</span>
}

// 共享:模板分类徽章（v1.8.6，与项目类型同色系）
const categoryCls: Record<TemplateCategory, string> = { ...typeCls }
export function TemplateCategoryBadge({ category }: { category?: TemplateCategory | null }) {
  if (!category) return null
  return <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', categoryCls[category])}>{category}</span>
}

// 共享:状态徽章
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const map: Record<ProjectStatus, { cls: string; label: string }> = {
    planning: { cls: 'bg-bg-soft text-text-secondary', label: '规划中' },
    active: { cls: 'bg-brand/15 text-brand-soft', label: '进行中' },
    completed: { cls: 'bg-ok/15 text-ok', label: '已完成' },
    archived: { cls: 'bg-muted/15 text-muted', label: '已归档' },
  }
  const s = map[status]
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', s.cls)}>
      {s.label}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  children,
  title,
  wide,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('glass relative max-h-[85vh] w-full overflow-y-auto rounded-2xl p-6 animate-pop-in', wide ? 'max-w-2xl' : 'max-w-md')}>
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <div className="font-display text-xl text-text-primary">{title}</div>
            <button onClick={onClose} className="text-muted hover:text-text-secondary">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}