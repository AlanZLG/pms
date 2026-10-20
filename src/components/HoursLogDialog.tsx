// 快捷记工时弹窗（双 Tab：快速登记 / 按周填写）
// 可复用入口：任务卡片悬浮按钮 / 顶栏全局入口
// 传入 task 时直接登记该任务；不传时先选项目再选任务
// 快速登记：计费工时默认跟随内部工时，计划工时折叠进"更多选项"

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Clock, Zap } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import WeeklyTimesheet from '@/components/WeeklyTimesheet'
import type { Project, Task } from '../../shared/types'

interface Props {
  open: boolean
  /** 预选任务（看板卡片入口）。不传则由用户选择项目+任务 */
  task?: Task | null
  onClose: () => void
  onSaved?: () => void
}

// 记住"计费=内部"偏好（按浏览器区分）
const BILL_FOLLOW_KEY = 'hours_bill_follows_actual'

const PRESETS = [0.5, 1, 2, 4, 8]

export default function HoursLogDialog({ open, task, onClose, onSaved }: Props) {
  const notify = useAppStore((s) => s.notify)
  const me = useAppStore((s) => s.user)
  // 默认展示按周填写；从任务卡片进入（已预选任务）时直接落在快速登记
  const [tab, setTab] = useState<'quick' | 'week'>(task ? 'quick' : 'week')

  // 仅在弹窗打开时拉取数据，避免隐藏状态下发请求
  // 快速登记可选项目 = 我负责的项目 或 有我被分配任务的项目
  const projects = useAsync(
    (): Promise<{ projects: Array<Pick<Project, 'id' | 'name' | 'ownerId'>> }> =>
      open && !task ? api.listLoggableProjects() : Promise.resolve({ projects: [] }),
    [open, task],
  )
  const [projectId, setProjectId] = useState('')
  const tasks = useAsync(
    (): Promise<{ project: Project | null; tasks: Task[] }> => {
      if (!open || !projectId) return Promise.resolve({ project: null, tasks: [] })
      if (!me) return api.listTasks(projectId)
      // 我负责的项目可选全部任务；否则仅显示分配给我的任务
      const isOwner = projects.data?.projects.some((p) => p.id === projectId && p.ownerId === me.id)
      return api.listTasks(projectId, isOwner ? undefined : { assigneeId: me.id })
    },
    [open, projectId, projects.data, me],
  )

  const today = new Date().toISOString().slice(0, 10)
  const [taskId, setTaskId] = useState('')
  const [date, setDate] = useState(today)
  const [plannedHours, setPlannedHours] = useState('')
  const [actualHours, setActualHours] = useState('')
  const [billedHours, setBilledHours] = useState('')
  const [description, setDescription] = useState('')
  const [billFollow, setBillFollow] = useState(() => localStorage.getItem(BILL_FOLLOW_KEY) !== '0')
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving] = useState(false)

  // 打开时重置表单
  useEffect(() => {
    if (!open) return
    setProjectId(task?.projectId || '')
    setTaskId(task?.id || '')
    setDate(today)
    setPlannedHours('')
    setActualHours('')
    setBilledHours('')
    setDescription('')
    setTab(task ? 'quick' : 'week')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task])

  if (!open) return null

  const selectedTask = task || tasks.data?.tasks.find((t) => t.id === taskId)

  function toggleBillFollow(v: boolean) {
    setBillFollow(v)
    localStorage.setItem(BILL_FOLLOW_KEY, v ? '1' : '0')
  }

  async function save() {
    if (!selectedTask) {
      notify('error', '请先选择任务')
      return
    }
    const actual = Number(actualHours) || 0
    const billed = billFollow ? actual : Number(billedHours) || 0
    if (!date || (actual <= 0 && billed <= 0)) {
      notify('error', '请填写日期和至少一项工时')
      return
    }
    setSaving(true)
    try {
      // 单日不限量；累计实绩超计划 20% 时后端随响应返回提示（不拦截）
      const { warning } = await api.createTaskHours(selectedTask.id, {
        date,
        plannedHours: Number(plannedHours) || 0,
        actualHours: actual,
        billedHours: billed,
        description: description.trim(),
      })
      if (warning) {
        notify('warning', `已登记。${warning}`)
      } else {
        notify('success', `已为「${selectedTask.title}」登记工时`)
      }
      onSaved?.()
      onClose()
    } catch (e) {
      notify('error', getErrorMessage(e, '工时登记失败'))
    } finally {
      setSaving(false)
    }
  }

  const selectCls =
    'h-9 w-full rounded-lg border border-bg-border bg-bg-soft px-2 text-sm text-text-primary outline-none focus:border-brand'

  const tabBtn = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${active ? 'bg-brand-soft/15 text-brand-soft' : 'text-muted hover:text-text-primary'}`

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
      <div className={`w-full rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl animate-fade-up ${tab === 'week' ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-medium text-text-primary">
            <Clock className="h-5 w-5 text-brand-soft" />
            记工时
          </h3>
          <button onClick={onClose} className="text-muted transition hover:text-text-primary">
            ✕
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="mb-4 flex gap-1 rounded-xl bg-bg-soft p-1">
          <button className={tabBtn(tab === 'quick')} onClick={() => setTab('quick')}>
            <Zap className="h-3.5 w-3.5" /> 快速登记
          </button>
          <button className={tabBtn(tab === 'week')} onClick={() => setTab('week')}>
            <CalendarDays className="h-3.5 w-3.5" /> 按周填写
          </button>
        </div>

        {tab === 'week' ? (
          <WeeklyTimesheet onSaved={onSaved} />
        ) : (
          <>
            <p className="mb-4 text-xs text-muted">登记的是时间投入，建议按日登记、无需等任务完成；整周批量填写请切到「按周填写」。仅可选择自己负责的项目或被分配了任务的项目</p>
            <div className="space-y-4">
              {!task && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">项目</label>
                    <select
                      className={selectCls}
                      value={projectId}
                      onChange={(e) => {
                        setProjectId(e.target.value)
                        setTaskId('')
                      }}
                    >
                      <option value="">选择项目…</option>
                      {(projects.data?.projects || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                      {projects.data && projects.data.projects.length === 0 && (
                        <option value="" disabled>暂无可登记的项目（需为项目负责人或被分配任务）</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">任务</label>
                    <select className={selectCls} value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!projectId}>
                      <option value="">{projectId ? '选择任务…' : '先选择项目'}</option>
                      {(tasks.data?.tasks || []).map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {task && (
                <div className="rounded-lg bg-bg-soft px-3 py-2 text-sm text-text-secondary">
                  <span className="text-muted">任务：</span>{task.title}
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">日期</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted">内部工时（实际投入）</label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted" title="勾选后计费工时自动等于内部工时，无需重复填写">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--brand)]"
                      checked={billFollow}
                      onChange={(e) => toggleBillFollow(e.target.checked)}
                    />
                    计费=内部
                  </label>
                </div>
                <Input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  placeholder="0"
                  value={actualHours}
                  onChange={(e) => setActualHours(e.target.value)}
                />
                {selectedTask && (selectedTask.plannedHours || 0) > 0 && (
                  <p className="mt-1 text-[11px] text-muted">计划工时 {selectedTask.plannedHours}h，单日不限；累计实绩超出计划 20% 时会提示</p>
                )}
                <div className="mt-1.5 flex gap-1.5">
                  {PRESETS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setActualHours(String(h))}
                      className={`rounded-md border px-2 py-0.5 text-[11px] transition ${Number(actualHours) === h ? 'border-brand bg-brand-soft/15 text-brand-soft' : 'border-bg-border text-muted hover:border-brand hover:text-text-primary'}`}
                    >
                      {h === 4 ? '半天4h' : h === 8 ? '一天8h' : `${h}h`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">备注</label>
                <Input placeholder="做了什么（选填）" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              {/* 更多选项：计划工时 + 计费工数（计费未跟随时） */}
              <button
                type="button"
                className="text-xs text-muted transition hover:text-text-primary"
                onClick={() => setShowMore(!showMore)}
              >
                {showMore ? '▾ 收起更多选项' : '▸ 更多选项（计划 / 计费工时）'}
              </button>
              {showMore && (
                <div className={`grid gap-3 ${billFollow ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted" title="本次投入对应的计划工时（选填，计入报表「登记计划工时」）">计划工时</label>
                    <Input type="number" min="0" step="0.5" placeholder="0" value={plannedHours} onChange={(e) => setPlannedHours(e.target.value)} />
                  </div>
                  {!billFollow && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted" title="向客户结算的工数">计费工数</label>
                      <Input type="number" min="0" step="0.5" placeholder="0" value={billedHours} onChange={(e) => setBilledHours(e.target.value)} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
              <Button onClick={save} disabled={saving || !selectedTask}>
                {saving ? '保存中…' : '登记工时'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
