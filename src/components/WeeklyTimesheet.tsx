// 按周工时表：行 = 我负责的任务（进行中/待办 + 近期有登记的已完成任务），列 = 周一到周日
// 每格 = 该任务当天的实际工时总数；提交时只发送有变动的格子（替换语义，见 /api/hours/bulk）
// 限制：单日单任务不超过计划工时的 20%（未设计划工时不限）；计费工时跟随内部工时（自定义过计费比例的记录不受影响）

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button } from '@/components/ui'
import { useAppStore } from '@/stores/app'

const DAY_MS = 86400000

function mondayOf(d: Date): string {
  const day = (d.getDay() + 6) % 7 // 周一 = 0
  return new Date(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day * DAY_MS)
    .toISOString().slice(0, 10)
}

function fmtMD(iso: string) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
}

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

interface Row {
  taskId: string
  taskTitle: string
  taskStatus: string
  plannedHours: number
  projectId: string
  projectName: string
}

// 单日单任务上限 = 计划工时 × 20%（未设计划工时不限制）
const capOf = (r: Row) => (r.plannedHours > 0 ? Math.round(r.plannedHours * 0.2 * 10) / 10 : Infinity)

export default function WeeklyTimesheet({ onSaved }: { onSaved?: () => void }) {
  const notify = useAppStore((s) => s.notify)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const sheet = useAsync(() => api.myTimesheet(weekStart), [weekStart])

  // 未提交的编辑：`${taskId}|${date}` -> 输入框原始字符串
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [extraRows, setExtraRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)

  // 添加任务行：搜索我负责的其他任务（含历史已完成）
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<Row[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // 切周时丢弃未提交编辑与临时行
    setEdits({})
    setExtraRows([])
    setSearchResults([])
    setKeyword('')
  }, [weekStart])

  function runSearch(kw: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (kw.trim().length < 2) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api.myTimesheet(weekStart, kw.trim())
        setSearchResults(r.rows)
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 300)
  }

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(weekStart) + i * DAY_MS).toISOString().slice(0, 10)),
    [weekStart],
  )

  const rows: Row[] = useMemo(() => {
    const base = sheet.data?.rows || []
    const seen = new Set(base.map((r) => r.taskId))
    return [...base, ...extraRows.filter((r) => !seen.has(r.taskId))]
  }, [sheet.data, extraRows])

  // 已有登记合计（服务端保证同任务同天一条，但按合计口径更稳）
  const baseCell = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of sheet.data?.cells || []) {
      const k = `${c.taskId}|${c.date}`
      m[k] = (m[k] || 0) + c.actualHours
    }
    return m
  }, [sheet.data])

  function cellValue(taskId: string, date: string): string {
    const k = `${taskId}|${date}`
    if (k in edits) return edits[k]
    const v = baseCell[k]
    return v ? String(v) : ''
  }

  function setCell(taskId: string, date: string, raw: string) {
    setEdits((prev) => ({ ...prev, [`${taskId}|${date}`]: raw }))
  }

  // 变动格：与基准不同的才提交
  const dirtyEntries = useMemo(() => {
    const out: { taskId: string; date: string; hours: number }[] = []
    for (const [key, raw] of Object.entries(edits)) {
      const [taskId, date] = key.split('|')
      const hours = Math.min(24, Math.max(0, Number(raw) || 0))
      const base = baseCell[key] || 0
      if (Math.abs(hours - base) < 1e-9) continue
      out.push({ taskId, date, hours })
    }
    return out
  }, [edits, baseCell])

  const rowSum = (taskId: string) =>
    weekDates.reduce((s, d) => s + (Number(cellValue(taskId, d)) || 0), 0)
  const daySum = (date: string) =>
    rows.reduce((s, r) => s + (Number(cellValue(r.taskId, date)) || 0), 0)
  const weekSum = weekDates.reduce((s, d) => s + daySum(d), 0)

  async function submit() {
    if (dirtyEntries.length === 0) { notify('info', '没有需要保存的改动'); return }
    // 单日上限预检：计划工时 × 20%
    const offender = dirtyEntries.find((e) => {
      const row = rows.find((r) => r.taskId === e.taskId)
      return row && e.hours > capOf(row) + 1e-9
    })
    if (offender) {
      const row = rows.find((r) => r.taskId === offender.taskId)!
      const cap = capOf(row)
      notify('error', `「${row.taskTitle}」${offender.date} 最多 ${cap}h/天（计划工时 ${row.plannedHours}h × 20%），请分摊到多天`)
      return
    }
    setSaving(true)
    try {
      const { result } = await api.bulkHours(dirtyEntries)
      const parts = [
        result.created ? `新增 ${result.created}` : '',
        result.updated ? `更新 ${result.updated}` : '',
        result.removed ? `清除 ${result.removed}` : '',
      ].filter(Boolean).join('、')
      notify('success', parts ? `工时表已保存（${parts}）` : '工时表已保存')
      setEdits({})
      await sheet.reload()
      onSaved?.()
    } catch (e) {
      notify('error', getErrorMessage(e, '工时表保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'h-8 w-14 rounded-md border border-bg-border bg-bg-soft px-1 text-center text-xs text-text-primary outline-none focus:border-brand'

  return (
    <div>
      {/* 周导航 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(new Date(Date.parse(weekStart) - 7 * DAY_MS).toISOString().slice(0, 10))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-36 text-center text-sm text-text-primary">
            {fmtMD(weekStart)} - {fmtMD(weekDates[6])}
            {weekStart === mondayOf(new Date()) && <span className="ml-1 text-xs text-brand-soft">本周</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(new Date(Date.parse(weekStart) + 7 * DAY_MS).toISOString().slice(0, 10))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {weekStart !== mondayOf(new Date()) && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setWeekStart(mondayOf(new Date()))}>回到本周</Button>
          )}
        </div>
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? '保存中…' : dirtyEntries.length ? `保存 ${dirtyEntries.length} 项改动` : '保存'}
        </Button>
      </div>

      {/* 网格 */}
      <div className="overflow-x-auto rounded-xl border border-bg-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-bg-border bg-bg-soft/60 text-xs text-muted">
              <th className="sticky left-0 z-10 bg-bg-panel px-3 py-2 text-left font-medium">任务</th>
              {weekDates.map((d, i) => (
                <th key={d} className={`px-1 py-2 text-center font-medium ${i >= 5 ? 'text-warn' : ''}`}>
                  周{DAY_LABELS[i]}<div className="text-[10px] font-normal">{fmtMD(d)}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-center font-medium">合计</th>
            </tr>
          </thead>
          <tbody>
            {sheet.loading && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-muted"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            )}
            {!sheet.loading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-muted">本周没有候选任务，用下方搜索添加一行</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.taskId} className="border-b border-bg-border/60 last:border-0">
                <td className="sticky left-0 z-10 max-w-56 bg-bg-panel px-3 py-1.5">
                  <div className="truncate text-xs text-text-primary" title={`${r.projectName} · ${r.taskTitle}`}>{r.taskTitle}</div>
                  <div className="truncate text-[10px] text-muted">
                    {r.projectName}
                    {r.plannedHours > 0 && <span className="ml-1 text-warn/80">上限 {capOf(r)}h/天</span>}
                  </div>
                </td>
                {weekDates.map((d) => (
                  <td key={d} className="px-1 py-1.5 text-center">
                    <input
                      type="number" min="0" max={r.plannedHours > 0 ? capOf(r) : 24} step="0.5" placeholder="·"
                      className={inputCls}
                      value={cellValue(r.taskId, d)}
                      onChange={(e) => setCell(r.taskId, d, e.target.value)}
                    />
                  </td>
                ))}
                <td className={`px-2 text-center text-xs font-medium ${rowSum(r.taskId) ? 'text-text-primary' : 'text-muted'}`}>
                  {rowSum(r.taskId) || '·'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-bg-border bg-bg-soft/60 text-xs">
              <td className="sticky left-0 z-10 bg-bg-panel px-3 py-2 text-muted">当日合计</td>
              {weekDates.map((d) => (
                <td key={d} className="px-1 py-2 text-center text-text-secondary">{daySum(d) || '·'}</td>
              ))}
              <td className="px-2 py-2 text-center font-medium text-text-primary">{weekSum || '·'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 添加任务行 */}
      <div className="relative mt-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              className="h-9 w-full rounded-lg border border-bg-border bg-bg-soft pl-8 pr-8 text-sm text-text-primary outline-none focus:border-brand"
              placeholder="搜索我负责的其他任务加入工时表（标题至少 2 字）"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); runSearch(e.target.value) }}
            />
            {searching && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" />}
            {!searching && keyword && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text-primary" onClick={() => { setKeyword(''); setSearchResults([]) }}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {searchResults.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-bg-border bg-bg-panel shadow-lg">
            {searchResults.map((t) => {
              const added = rows.some((r) => r.taskId === t.taskId)
              return (
                <button
                  key={t.taskId}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-bg-soft disabled:opacity-50"
                  disabled={added}
                  onClick={() => {
                    setExtraRows((prev) => [...prev, t])
                    setKeyword(''); setSearchResults([])
                  }}
                >
                  <span className="truncate text-text-primary">{t.taskTitle}</span>
                  <span className="flex shrink-0 items-center gap-1 text-muted">
                    {t.projectName && <span>{t.projectName}</span>}
                    {added ? <span className="text-success">已添加</span> : <Plus className="h-3.5 w-3.5" />}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        只显示你负责的任务；每格为该任务当天实际工时，单日不超过任务计划工时的 20%（未设计划工时不限）。清空格子提交即删除当天登记；备注请用「快速登记」。
      </p>
    </div>
  )
}
