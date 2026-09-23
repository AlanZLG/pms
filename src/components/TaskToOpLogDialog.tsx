// 任务 → 运维台账 转换对话框
// 将任务相关内容复制到台账表单，可修改后保存，并通过扩展字段 __sourceTaskId 关联来源任务

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link2 } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button, Input, Textarea } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import type { Task } from '../../shared/types'

const STATUSES = ['待处理', '处理中', '已完成', '已关闭']

/** 任务状态 → 台账状态 */
const TASK_STATUS_MAP: Record<string, string> = {
  todo: '待处理',
  in_progress: '处理中',
  review: '处理中',
  done: '已完成',
}

interface Props {
  open: boolean
  task: Task | null
  onClose: () => void
  onCreated?: () => void
}

export default function TaskToOpLogDialog({ open, task, onClose, onCreated }: Props) {
  const notify = useAppStore((s) => s.notify)
  const currentUser = useAppStore((s) => s.user)
  const options = useAsync(() => api.getOpLogOptions(task?.projectId || undefined), [task?.projectId])

  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('待处理')
  const [proposer, setProposer] = useState('')
  const [system, setSystem] = useState('')
  const [department, setDepartment] = useState('')
  const [logDate, setLogDate] = useState('')
  const [recorder, setRecorder] = useState('')
  const [problem, setProblem] = useState('')
  const [completionDate, setCompletionDate] = useState('')
  const [hours, setHours] = useState('')
  const [detail, setDetail] = useState('')
  const [cause, setCause] = useState('')
  const [solution, setSolution] = useState('')
  const [saving, setSaving] = useState(false)

  // 打开时从任务复制内容（可修改）
  useEffect(() => {
    if (!open || !task) return
    setCategory('')
    setStatus(TASK_STATUS_MAP[task.status] || '待处理')
    setProposer('')
    setSystem('')
    setDepartment('')
    setLogDate(new Date().toISOString().slice(0, 10))
    setRecorder(currentUser?.name || '')
    setProblem(task.title)
    setCompletionDate(task.status === 'done' ? (task.updatedAt || '').slice(0, 10) : '')
    setHours(task.plannedHours ? String(task.plannedHours) : '')
    setDetail(task.description || '')
    setCause('')
    setSolution('')
  }, [open, task, currentUser])

  if (!open || !task) return null

  async function save() {
    if (!problem.trim()) {
      notify('error', '「问题」为必填项')
      return
    }
    setSaving(true)
    try {
      await api.createOpLog({
        projectId: task.projectId,
        category: category.trim() || '其他',
        status,
        proposer: proposer.trim(),
        system: system.trim(),
        department: department.trim(),
        logDate,
        recorder: recorder.trim(),
        problem: problem.trim(),
        completionDate: completionDate || null,
        hours: Number(hours) || 0,
        detail,
        cause,
        solution,
        // 通过隐藏扩展字段关联来源任务
        extraFields: {
          __sourceTaskId: task.id,
          __sourceTaskTitle: task.title,
        },
      })
      notify('success', '已转为运维台账/课题表并关联该任务')
      onCreated?.()
      onClose()
    } catch (e) {
      notify('error', getErrorMessage(e, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'h-9 rounded-lg border border-bg-border bg-bg-soft px-3 text-sm text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand/40'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
      <div className="w-full max-w-3xl rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl animate-fade-up">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-medium text-text-primary">任务转运维台账/课题表</h3>
          <button onClick={onClose} className="text-muted transition hover:text-text-primary">
            ✕
          </button>
        </div>
        <p className="mb-5 flex items-center gap-1.5 text-xs text-muted">
          <Link2 className="h-3.5 w-3.5 text-brand-soft" />
          已从任务「{task.title}」复制相关内容，修改后保存将自动关联来源任务
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">分类</label>
            <input
              className={inputCls + ' w-full'}
              list="task-oplog-category-options"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="如：系统故障 / 需求变更 / 例行维护"
            />
            <datalist id="task-oplog-category-options">
              {(options.data?.categories || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">状态</label>
            <select className={inputCls + ' w-full'} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">提出人</label>
            <input className={inputCls + ' w-full'} value={proposer} onChange={(e) => setProposer(e.target.value)} placeholder="问题提出人姓名" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">系统</label>
            <input
              className={inputCls + ' w-full'}
              list="task-oplog-system-options"
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="如：OA系统 / ERP"
            />
            <datalist id="task-oplog-system-options">
              {(options.data?.systems || []).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">部门</label>
            <input
              className={inputCls + ' w-full'}
              list="task-oplog-department-options"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="提出人所在部门"
            />
            <datalist id="task-oplog-department-options">
              {(options.data?.departments || []).map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">日期</label>
            <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">记录人</label>
            <input className={inputCls + ' w-full'} value={recorder} onChange={(e) => setRecorder(e.target.value)} placeholder="台账记录人" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">工时（小时）</label>
            <Input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              问题 <span className="text-danger">*</span>
            </label>
            <Textarea rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="问题描述（必填）" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">完成日</label>
            <Input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">详细描述</label>
            <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="问题的详细描述、现象、影响范围等" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">原因</label>
            <Textarea rows={2} value={cause} onChange={(e) => setCause(e.target.value)} placeholder="问题根本原因分析" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">解决方案</label>
            <Textarea rows={2} value={solution} onChange={(e) => setSolution(e.target.value)} placeholder="处理过程与解决方法" />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={save} disabled={saving || !problem.trim()}>
            {saving ? '保存中…' : '保存并关联任务'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
