// 创建/编辑任务对话框

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ProjectDialog'
import { Button, Input, Textarea } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { Sparkles, Save, Trash2, X } from 'lucide-react'
import type { Task, TaskPriority, TaskStatus, Template } from '../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  task?: Task | null
  defaultStatus?: TaskStatus
  onSaved: () => void
}

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
]
const statuses: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'review', label: '审核中' },
  { value: 'done', label: '已完成' },
]

export default function TaskDialog({ open, onClose, projectId, task, defaultStatus, onSaved }: Props) {
  const users = useAsync(() => api.listUsers(), [projectId])
  const templatesData = useAsync(() => api.listTemplates(), [])
  const members = users.data?.users || []
  const templates: Template[] = templatesData.data?.templates || []
  const notify = useAppStore((s) => s.notify)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [labels, setLabels] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(task?.title || '')
      setDescription(task?.description || '')
      setStatus(task?.status || defaultStatus || 'todo')
      setPriority(task?.priority || 'medium')
      setAssigneeId(task?.assigneeId || null)
      setLabels(task?.labels.join(', ') || '')
      setDueDate(task?.dueDate?.slice(0, 10) || '')
      setSelectedTemplateId('')
      setShowSaveTemplate(false)
      setTemplateName('')
    }
  }, [open, task, defaultStatus])

  function applyTemplate(tplId: string) {
    setSelectedTemplateId(tplId)
    if (!tplId) return
    const tpl = templates.find((t) => t.id === tplId)
    if (tpl) {
      setTitle(tpl.title)
      setDescription(tpl.description)
      setPriority(tpl.priority)
      setLabels(tpl.labels.join(', '))
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return
    setTemplateBusy(true)
    try {
      await api.createTemplate({
        name: templateName.trim(),
        title,
        description,
        priority,
        labels: labels.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      })
      notify('success', '模板已保存')
      setShowSaveTemplate(false)
      setTemplateName('')
      templatesData.reload()
    } catch (e: any) {
      notify('error', e?.message || '保存模板失败')
    } finally {
      setTemplateBusy(false)
    }
  }

  async function deleteTemplateFn(tplId: string) {
    if (!confirm('确定删除该模板?')) return
    try {
      await api.deleteTemplate(tplId)
      notify('success', '模板已删除')
      if (selectedTemplateId === tplId) setSelectedTemplateId('')
      templatesData.reload()
    } catch (e: any) {
      notify('error', e?.message || '删除模板失败')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        title,
        description,
        status,
        priority,
        assigneeId: assigneeId || null,
        labels: labels
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      }
      if (task) {
        await api.updateTask(task.id, payload)
      } else {
        await api.createTask(projectId, payload)
      }
      onSaved()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const isNew = !task

  return (
    <Modal open={open} onClose={onClose} title={task ? '编辑任务' : '新建任务'} wide>
      <form onSubmit={submit} className="space-y-4">
        {isNew && templates.length > 0 && (
          <div className="rounded-xl border border-brand/30 bg-brand/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-brand-soft">
              <Sparkles className="h-3.5 w-3.5" /> 从模板创建
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="flex-1 rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
                defaultValue=""
              >
                <option value="">选择模板…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedTemplateId && (
                <button
                  type="button"
                  onClick={() => deleteTemplateFn(selectedTemplateId)}
                  className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-2 text-danger hover:bg-danger/20"
                  title="删除模板"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs text-muted">任务标题</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="简明扼要" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted">描述</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="更详细的说明"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs text-muted">状态</label>
            <SelectBox value={status} onChange={(v) => setStatus(v as TaskStatus)} options={statuses} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">优先级</label>
            <SelectBox value={priority} onChange={(v) => setPriority(v as TaskPriority)} options={priorities} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">负责人</label>
            <select
              value={assigneeId || ''}
              onChange={(e) => setAssigneeId(e.target.value || null)}
              className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
            >
              <option value="">未指派</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
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
          <label className="mb-1.5 block text-xs text-muted">标签(逗号分隔)</label>
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="前端, 设计" />
        </div>

        <div className="rounded-xl border border-dashed border-bg-border p-3">
          {showSaveTemplate ? (
            <div className="flex items-center gap-2">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="模板名称"
                className="flex-1"
              />
              <Button type="button" size="sm" onClick={saveAsTemplate} disabled={templateBusy || !templateName.trim()}>
                <Save className="h-3.5 w-3.5" /> 保存
              </Button>
              <button
                type="button"
                onClick={() => { setShowSaveTemplate(false); setTemplateName('') }}
                className="rounded-lg p-2 text-muted hover:bg-bg-soft"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSaveTemplate(true)}
              className="flex w-full items-center justify-center gap-2 text-xs text-muted hover:text-brand-soft"
            >
              <Sparkles className="h-3.5 w-3.5" /> 保存为模板,下次快速创建
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? '保存中…' : '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function SelectBox({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}