// v1.9.0 结项合并：把运维增强项目的台账/课题记录批量转绑到目标运维项目
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, GitMerge, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { Project } from '../../shared/types'

export function MergeProjectDialog({ open, onClose, sourceProject, onSuccess }: {
  open: boolean
  onClose: () => void
  sourceProject: Project
  onSuccess: (updatedProject: Project, movedOpLogs: number, targetName: string) => void
}) {
  const [candidates, setCandidates] = useState<Project[]>([])
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTargetId('')
    setError('')
    api.listProjects().then(({ projects }) => {
      setCandidates(projects.filter((p) => p.projectType === '运维项目' && !p.deletedAt && !p.mergedIntoProjectId))
    }).catch(() => setCandidates([]))
  }, [open])

  if (!open) return null

  const submit = async () => {
    if (!targetId) { setError('请选择目标运维项目'); return }
    setSubmitting(true)
    try {
      const result = await api.mergeProject(sourceProject.id, targetId)
      onSuccess(result.project, result.movedOpLogs, result.targetName)
    } catch (e) {
      setError(e instanceof Error ? e.message : '合并失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-bg-border bg-bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-text-primary">
            <GitMerge className="h-4.5 w-4.5 text-brand" /> 合并到运维项目
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-bg-soft hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            合并后，本项目名下的全部台账/课题记录将转绑到所选运维项目（工时随之归集），本项目标记为「已合并」并保留查看入口。合并操作不可撤销。
          </p>
        </div>

        <label className="mb-1.5 block text-xs text-muted">目标运维项目</label>
        <select
          value={targetId}
          onChange={(e) => { setTargetId(e.target.value); setError('') }}
          className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
        >
          <option value="">请选择…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {candidates.length === 0 && (
          <p className="mt-1.5 text-[11px] text-muted">暂无可选的运维项目</p>
        )}
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={submit} disabled={submitting} className={cn(submitting && 'opacity-60')}>
            {submitting ? '合并中…' : '确认合并'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
