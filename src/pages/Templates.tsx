// 项目模板管理页面

import { useState, useEffect } from 'react'
import { Layers, Plus, Trash2, Edit2, FileText, DollarSign, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errors'
import { useAppStore } from '@/stores/app'
import type { ProjectTemplate, TemplateCategory } from '../../shared/types'
import { TEMPLATE_CATEGORIES } from '../../shared/types'
import { TemplateCategoryBadge } from '@/components/ProjectDialog'

export default function Templates() {
  const [templates, setTemplates] = useState<(ProjectTemplate & { taskCount: number; budgetCount: number; kanbanColumnCount: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ProjectTemplate | null>(null)
  const user = useAppStore((s) => s.user)

  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    try {
      setLoading(true)
      const res = await api.listProjectTemplates()
      setTemplates(res.templates || [])
    } catch (e) {
      console.error('加载模板列表失败:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定要删除这个模板吗？')) return
    try {
      await api.deleteProjectTemplate(id)
      await loadTemplates()
    } catch (e) {
      alert(getErrorMessage(e, '删除失败'))
    }
  }

  async function handleCreate(data: { name: string; description: string; category: TemplateCategory }) {
    try {
      await api.createProjectTemplate(data)
      setCreating(false)
      await loadTemplates()
    } catch (e) {
      alert(getErrorMessage(e, '创建失败'))
    }
  }

  async function handleUpdate(id: string, data: { name: string; description: string; category: TemplateCategory }) {
    try {
      await api.updateProjectTemplate(id, data)
      setEditingTemplate(null)
      await loadTemplates()
    } catch (e) {
      alert(getErrorMessage(e, '更新失败'))
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-text-primary">项目模板</h1>
          <p className="mt-1 text-sm text-muted">管理项目模板，加速项目创建流程</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> 新建模板
          </Button>
        )}
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted">加载中...</div>
      ) : templates.length === 0 ? (
        <div className="py-20 text-center text-muted">暂无模板</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="group relative rounded-xl border border-bg-border bg-bg-soft p-4 transition hover:border-brand/30 hover:shadow-glow"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand/15">
                    <Layers className="h-5 w-5 text-brand" />
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 font-medium text-text-primary">
                      {template.name}
                      <TemplateCategoryBadge category={template.category} />
                    </h3>
                    {template.isSystem && (
                      <span className="text-[11px] text-brand">系统模板</span>
                    )}
                  </div>
                </div>
                {isAdmin && !template.isSystem && (
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      onClick={() => setEditingTemplate(template)}
                      className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-text-primary"
                      title="编辑"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mb-3 text-sm text-muted line-clamp-2">{template.description || '暂无描述'}</p>
              <div className="flex gap-4 text-xs text-muted">
                <div className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  <span>{template.taskCount} 任务</span>
                </div>
                <div className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>{template.budgetCount} 预算</span>
                </div>
                <div className="flex items-center gap-1">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>{template.kanbanColumnCount} 看板列</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建模板对话框 */}
      {creating && (
        <TemplateFormDialog
          title="新建模板"
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* 编辑模板对话框 */}
      {editingTemplate && (
        <TemplateFormDialog
          title="编辑模板"
          defaultValues={{
            name: editingTemplate.name,
            description: editingTemplate.description,
            category: editingTemplate.category || '',
          }}
          onClose={() => setEditingTemplate(null)}
          onSubmit={(data) => handleUpdate(editingTemplate.id, data)}
        />
      )}
    </div>
  )
}

// 模板表单对话框组件
function TemplateFormDialog({
  title,
  defaultValues,
  onClose,
  onSubmit,
}: {
  title: string
  defaultValues?: { name: string; description: string; category?: TemplateCategory | '' }
  onClose: () => void
  onSubmit: (data: { name: string; description: string; category: TemplateCategory }) => Promise<void>
}) {
  const [name, setName] = useState(defaultValues?.name || '')
  const [description, setDescription] = useState(defaultValues?.description || '')
  const [category, setCategory] = useState<TemplateCategory | ''>(defaultValues?.category || '')
  const [categoryError, setCategoryError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      alert('请输入模板名称')
      return
    }
    // v1.8.6：模板分类必选（决定创建项目时预填的项目类型）
    if (!category) {
      setCategoryError('请选择模板分类')
      return
    }
    setLoading(true)
    try {
      await onSubmit({ name, description, category })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-6 animate-pop-in">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-text-secondary">
            <span className="sr-only">关闭</span>
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted">模板分类 <span className="text-rose-400">*</span></label>
            <div className="grid grid-cols-5 gap-2">
              {TEMPLATE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => { setCategory(cat); setCategoryError('') }}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-xs font-medium transition',
                    category === cat
                      ? 'border-brand bg-brand/15 text-brand-soft'
                      : 'border-bg-border bg-bg-soft text-text-secondary hover:border-brand/40',
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
            {categoryError ? (
              <p className="mt-1 text-[11px] text-rose-400">{categoryError}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted">创建项目选择模板后，将按分类自动预填同名项目类型</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">模板名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
              placeholder="如:网站开发模板"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
              placeholder="模板的用途和说明"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}