import { useEffect, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import type { Task } from '../../shared/types'

interface Props {
  task: Task
  onClose: () => void
  onSave: (data: Partial<Task>) => Promise<void> | void
  onOpenDetail: (task: Task) => void
}

/** date input 值(yyyy-MM-dd) → ISO；空串 → null（清除该字段） */
function toIso(v: string): string | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

/** 甘特图行内快速编辑面板：点击左侧任务名称弹出，5 个字段 + 进度 */
export default function GanttTaskEditPanel({ task, onClose, onSave, onOpenDetail }: Props) {
  const [startDate, setStartDate] = useState(toDateInput(task.startDate))
  const [dueDate, setDueDate] = useState(toDateInput(task.dueDate))
  const [actualStartDate, setActualStartDate] = useState(toDateInput(task.actualStartDate))
  const [actualEndDate, setActualEndDate] = useState(toDateInput(task.actualEndDate))
  // 兼容历史数据：库中 0-100，甘特拖拽旧值为 0-1
  const [progress, setProgress] = useState<number>(() => {
    const raw = task.progress ?? (task.status === 'done' ? 100 : 0)
    return raw > 1 ? Math.round(raw) : Math.round(raw * 100)
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    setSaving(true)
    try {
      await onSave({
        startDate: toIso(startDate),
        dueDate: toIso(dueDate),
        actualStartDate: toIso(actualStartDate),
        actualEndDate: toIso(actualEndDate),
        progress,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const dateInputCls = 'w-full bg-bg-soft border border-bg-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-brand transition-colors'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-[350px] max-w-[92vw] bg-bg-panel border border-bg-border rounded-xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
          <span className="text-sm font-semibold text-text-primary truncate" title={task.title}>{task.title}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-border transition-colors">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>

        {/* 表单 */}
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="text-[11px] text-muted block mb-1.5">计划日期</label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-muted block mb-1">开始日期</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={dateInputCls} />
              </label>
              <label className="block">
                <span className="text-[10px] text-muted block mb-1">截止日期</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={dateInputCls} />
              </label>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted block mb-1.5">
              实际日期 <span className="text-[10px] opacity-70">（选填，填写后甘特图显示计划/实际对比条）</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-emerald-400 block mb-1">实际开始</span>
                <input type="date" value={actualStartDate} onChange={(e) => setActualStartDate(e.target.value)} className={dateInputCls} />
              </label>
              <label className="block">
                <span className="text-[10px] text-sky-400 block mb-1">实际截止</span>
                <input type="date" value={actualEndDate} onChange={(e) => setActualEndDate(e.target.value)} className={dateInputCls} />
              </label>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted block mb-1.5">
              进度 <span className="font-mono text-text-primary">{progress}%</span>
            </label>
            <input
              type="range" min={0} max={100} step={5} value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="w-full accent-brand"
            />
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-bg-border">
          <button
            onClick={() => { onOpenDetail(task) }}
            className="text-xs text-muted hover:text-brand transition-colors flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" /> 查看完整详情
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-muted hover:text-text-primary transition-colors">
              取消
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-brand text-white rounded hover:bg-brand-soft transition-colors disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
