// 测试文档面板：文档列表 + 类 Excel 在线网格编辑器 + 版本履历 + Excel 导入导出
// 权限：项目成员均可查看/编辑/导入/导出；删除/恢复仅项目负责人或管理员（服务端强制）
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Plus, Download, History, Trash2, ArrowLeft, Upload,
  X, ChevronLeft, RotateCcw, FileText,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, Button, EmptyState, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { Project, User, TestDoc, TestDocColumn, TestDocRow, TestDocVersion, TestDocVersionMeta } from '../../shared/types'

function fmtTime(s: string | null | undefined): string {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 图标按钮悬停即时显示名称（原生 title 有约 1 秒延迟，网格内紧凑按钮改用 CSS 提示）
function IconTip({ label, align = 'center', onClick, className, children }: {
  label: string
  align?: 'center' | 'right'
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <span className="relative inline-flex group/tip">
      <button onClick={onClick} className={className} title={label}>{children}</button>
      <span
        className={cn(
          'pointer-events-none absolute top-full z-20 mt-1 whitespace-nowrap rounded-md border border-bg-border bg-bg-panel px-1.5 py-0.5 text-[10px] leading-4 text-text-secondary opacity-0 shadow-md transition-opacity group-hover/tip:opacity-100',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0',
        )}
      >
        {label}
      </span>
    </span>
  )
}

export default function TestDocPanel({ project, currentUser }: { project: Project; currentUser: User }) {
  const notify = useAppStore((s) => s.notify)
  const [docs, setDocs] = useState<TestDoc[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // 服务端强制删除权限，这里只控制入口显隐
  const canManage = currentUser.id === project.ownerId || currentUser.role === 'admin'
  const canEdit = currentUser.role !== 'guest'

  const reload = useCallback(async () => {
    try {
      const { testDocs } = await api.listTestDocs(project.id)
      setDocs(testDocs)
    } catch (e) {
      notify('error', getErrorMessage(e, '加载测试文档失败'))
      setDocs([])
    }
  }, [project.id, notify])

  useEffect(() => { reload() }, [reload])

  async function handleCreate() {
    const title = window.prompt('请输入测试文档标题', '测试用例')
    if (!title?.trim()) return
    setCreating(true)
    try {
      const { testDoc } = await api.createTestDoc(project.id, { title: title.trim() })
      await reload()
      setActiveId(testDoc.id)
    } catch (e) {
      notify('error', getErrorMessage(e, '创建失败'))
    } finally {
      setCreating(false)
    }
  }

  async function handleImport(file: File) {
    try {
      const { testDoc } = await api.importTestDoc(project.id, file)
      notify('success', `已导入《${testDoc.title}》`)
      await reload()
      setActiveId(testDoc.id)
    } catch (e) {
      notify('error', getErrorMessage(e, '导入失败'))
    }
  }

  const activeDoc = docs?.find((d) => d.id === activeId) || null

  if (activeId && activeDoc) {
    return (
      <TestDocEditor
        key={activeDoc.id}
        doc={activeDoc}
        canEdit={canEdit}
        canManage={canManage}
        onChanged={reload}
        onBack={() => { setActiveId(null); reload() }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-text-primary">测试文档</h2>
          <p className="mt-0.5 text-xs text-muted">在线编辑测试用例，随时导出 Excel；保存自动记录修改履历并通知项目负责人</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> 从 Excel 导入
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCreate} disabled={creating}>
                <Plus className="h-3.5 w-3.5" /> 新建文档
              </Button>
            </>
          )}
        </div>
      </div>

      {docs === null ? (
        <Card className="p-12 text-center text-muted">加载中…</Card>
      ) : docs.length === 0 ? (
        <EmptyState title="暂无测试文档" hint="新建空白用例文档，或从现有 Excel 一键导入" />
      ) : (
        <Card className="divide-y divide-bg-border">
          <div className="flex items-center gap-4 px-4 py-2.5 text-xs font-medium text-muted">
            <div className="flex-1">文档</div>
            <div className="w-16 text-center">版本</div>
            <div className="w-16 text-center">行数</div>
            <div className="w-20">创建人</div>
            <div className="w-36 text-right">更新时间</div>
          </div>
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-bg-soft/50">
              <div className="flex flex-1 min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted" />
                <button
                  onClick={() => setActiveId(d.id)}
                  className="truncate text-left text-sm text-text-primary hover:text-brand"
                >
                  {d.title}
                </button>
              </div>
              <div className="w-16 text-center text-xs text-muted">v{d.version}</div>
              <div className="w-16 text-center text-xs text-muted">{d.rows.length}</div>
              <div className="w-20 truncate text-xs text-muted">{d.createdByName || '-'}</div>
              <div className="w-36 text-right text-xs text-muted">{fmtTime(d.updatedAt)}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

// ===== 在线编辑器 =====

function TestDocEditor({ doc, canEdit, canManage, onBack, onChanged }: {
  doc: TestDoc
  canEdit: boolean
  canManage: boolean
  onBack: () => void
  onChanged: () => Promise<void> | void
}) {
  const notify = useAppStore((s) => s.notify)
  const [title, setTitle] = useState(doc.title)
  const [columns, setColumns] = useState<TestDocColumn[]>(doc.columns)
  const [rows, setRows] = useState<TestDocRow[]>(doc.rows)
  const [version, setVersion] = useState(doc.version)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<TestDocVersionMeta[] | null>(null)
  const [preview, setPreview] = useState<TestDocVersion | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const markDirty = () => setDirty(true)

  // 保存：乐观锁（baseVersion 不一致时 409，提示刷新）
  const save = useCallback(async (silent = false) => {
    if (saving) return
    setSaving(true)
    try {
      const { testDoc } = await api.updateTestDoc(doc.id, { title, columns, rows, baseVersion: version })
      setTitle(testDoc.title)
      setColumns(testDoc.columns)
      setRows(testDoc.rows)
      setVersion(testDoc.version)
      setDirty(false)
      onChanged()
      if (!silent) notify('success', `已保存 · v${testDoc.version}（修改履历已通知项目负责人）`)
    } catch (e) {
      const msg = (e as Error & { status?: number }).status === 409
        ? '文档已被他人修改，正在加载最新内容，请重新编辑'
        : getErrorMessage(e, '保存失败')
      notify('error', msg)
      if ((e as Error & { status?: number }).status === 409) {
        try {
          const { testDoc } = await api.getTestDoc(doc.id)
          setTitle(testDoc.title)
          setColumns(testDoc.columns)
          setRows(testDoc.rows)
          setVersion(testDoc.version)
          setDirty(false)
        } catch { /* 保持现状 */ }
      }
    } finally {
      setSaving(false)
    }
  }, [doc.id, title, columns, rows, version, saving, notify, onChanged])

  // Ctrl/Cmd+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (canEdit && dirty) save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, dirty, canEdit])

  // 离开前提示未保存
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function addRow() {
    setRows((rs) => [...rs, { id: crypto.randomUUID(), cells: {} }])
    markDirty()
  }
  function removeRow(rowId: string) {
    setRows((rs) => rs.filter((r) => r.id !== rowId))
    markDirty()
  }
  function addColumn() {
    const label = window.prompt('新列名称', '新列')
    if (!label?.trim()) return
    setColumns((cs) => [...cs, { id: crypto.randomUUID(), label: label.trim(), width: 160 }])
    markDirty()
  }
  function renameColumn(colId: string, label: string) {
    setColumns((cs) => cs.map((c) => (c.id === colId ? { ...c, label } : c)))
    markDirty()
  }
  function removeColumn(colId: string) {
    if (columns.length <= 1) {
      notify('error', '至少保留一列')
      return
    }
    setColumns((cs) => cs.filter((c) => c.id !== colId))
    markDirty()
  }
  function setCell(rowId: string, colId: string, value: string) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r)))
    markDirty()
  }

  async function openHistory() {
    const next = !showHistory
    setShowHistory(next)
    setPreview(null)
    if (next && versions === null) {
      try {
        const { versions: vs } = await api.listTestDocVersions(doc.id)
        setVersions(vs)
      } catch (e) {
        notify('error', getErrorMessage(e, '加载履历失败'))
      }
    }
  }

  async function viewVersion(v: number) {
    try {
      const { version: snapshot } = await api.getTestDocVersion(doc.id, v)
      setPreview(snapshot)
    } catch (e) {
      notify('error', getErrorMessage(e, '加载版本失败'))
    }
  }

  async function rollback(v: number) {
    if (!window.confirm(`确定回滚到 v${v}？当前内容将保存为新版本（可在履历中追溯）。`)) return
    try {
      const { testDoc } = await api.rollbackTestDoc(doc.id, v)
      setTitle(testDoc.title)
      setColumns(testDoc.columns)
      setRows(testDoc.rows)
      setVersion(testDoc.version)
      setDirty(false)
      setPreview(null)
      setVersions(null)
      onChanged()
      notify('success', `已回滚到 v${v} · 当前 v${testDoc.version}`)
    } catch (e) {
      notify('error', getErrorMessage(e, '回滚失败'))
    }
  }

  async function handleDownload() {
    try {
      await api.downloadTestDocXlsx(doc.id, title || doc.title)
      notify('success', 'Excel 已开始下载')
    } catch (e) {
      notify('error', getErrorMessage(e, '下载失败'))
    }
  }

  async function handleDelete() {
    try {
      await api.deleteTestDoc(doc.id)
      notify('success', '已移入回收站，项目负责人可随时恢复')
      onChanged()
      onBack()
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> 返回列表
        </Button>
        <Input
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty() }}
          disabled={!canEdit}
          className="max-w-xs flex-1 font-medium"
          placeholder="文档标题"
        />
        <span className="rounded-md bg-bg-soft px-2 py-1 text-xs text-muted">v{version}</span>
        {dirty && <span className="text-xs text-warn">未保存</span>}
        <div className="flex-1" />
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => save()} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" /> 下载 Excel
        </Button>
        <Button variant={showHistory ? 'primary' : 'ghost'} size="sm" onClick={openHistory}>
          <History className="h-3.5 w-3.5" /> 修改履历
        </Button>
        {canManage && (
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        )}
      </div>

      <div className={cn('grid gap-4', showHistory ? 'lg:grid-cols-[1fr_320px]' : '')}>
        {/* 网格 */}
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-bg-soft/60">
                <th className="w-10 border-b border-r border-bg-border px-2 py-2 text-xs font-medium text-muted">#</th>
                {columns.map((c) => (
                  <th key={c.id} className="min-w-[120px] border-b border-r border-bg-border p-1" style={{ width: c.width }}>
                    <div className="flex items-center gap-1">
                      {canEdit ? (
                        <input
                          value={c.label}
                          onChange={(e) => renameColumn(c.id, e.target.value)}
                          className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-center text-xs font-semibold text-text-secondary outline-none focus:bg-bg-panel focus:ring-1 focus:ring-brand/40"
                        />
                      ) : (
                        <span className="flex-1 px-1 text-center text-xs font-semibold text-text-secondary">{c.label}</span>
                      )}
                      {canEdit && (
                        <IconTip
                          label={`删除列「${c.label}」`}
                          onClick={() => removeColumn(c.id)}
                          className="shrink-0 rounded p-0.5 text-muted opacity-30 transition hover:text-danger hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </IconTip>
                      )}
                    </div>
                  </th>
                ))}
                {canEdit && (
                  <th className="w-10 border-b border-bg-border p-1 text-center">
                    <IconTip
                      label="添加列"
                      align="right"
                      onClick={addColumn}
                      className="rounded p-1 text-muted transition hover:text-brand"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </IconTip>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} className="py-10 text-center text-xs text-muted">
                    暂无数据行，点击下方「添加行」开始录入
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id} className="group/row transition-colors hover:bg-bg-soft/30">
                  <td className="border-b border-r border-bg-border px-2 py-1 text-center text-xs text-muted">{i + 1}</td>
                  {columns.map((c) => (
                    <td key={c.id} className="border-b border-r border-bg-border p-0 align-top">
                      {canEdit ? (
                        <AutoTextarea
                          value={r.cells[c.id] ?? ''}
                          onChange={(v) => setCell(r.id, c.id, v)}
                        />
                      ) : (
                        <div className="whitespace-pre-wrap px-2 py-1.5 text-text-primary">{r.cells[c.id] ?? ''}</div>
                      )}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="border-b border-bg-border p-0 text-center">
                      <IconTip
                        label="删除此行"
                        align="right"
                        onClick={() => removeRow(r.id)}
                        className="rounded p-1 text-muted opacity-0 transition hover:text-danger group-hover/row:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconTip>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div className="border-t border-bg-border p-2">
              <Button variant="ghost" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> 添加行
              </Button>
            </div>
          )}
        </Card>

        {/* 修改履历侧栏 */}
        {showHistory && (
          <Card className="h-fit divide-y divide-bg-border p-0">
            <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-text-primary">
              <History className="h-4 w-4 text-muted" /> 修改履历
            </div>
            {versions === null ? (
              <div className="px-4 py-6 text-center text-xs text-muted">加载中…</div>
            ) : versions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted">暂无版本记录</div>
            ) : (
              versions.map((v) => (
                <div key={v.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => viewVersion(v.version)}
                      className="text-xs font-semibold text-brand hover:underline"
                      title="查看此版本快照"
                    >
                      v{v.version}
                    </button>
                    <span className="text-[11px] text-muted">{fmtTime(v.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">{v.changeSummary || '—'}</div>
                  <div className="mt-0.5 text-[11px] text-muted">编辑人：{v.editedByName || '-'}</div>
                </div>
              ))
            )}
          </Card>
        )}
      </div>

      {/* 版本快照预览（只读 + 回滚） */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-bg-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <ChevronLeft className="h-4 w-4 text-muted" />
                v{preview.version} 快照 · {preview.changeSummary} · {preview.editedByName || '-'} · {fmtTime(preview.createdAt)}
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button variant="soft" size="sm" onClick={() => rollback(preview.version)}>
                    <RotateCcw className="h-3.5 w-3.5" /> 回滚到此版本
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>关闭</Button>
              </div>
            </div>
            <div className="overflow-auto p-4">
              <SnapshotGrid columns={preview.columns} rows={preview.rows} />
            </div>
          </Card>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-text-primary">删除测试文档</h3>
            <p className="mt-2 text-sm text-muted">
              《{title}》将移入回收站，项目负责人可随时恢复。确定要删除吗？
            </p>
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button variant="danger" onClick={handleDelete}>移入回收站</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// 自适应高度的单元格编辑器（支持换行）
function AutoTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      spellCheck={false}
      className="block w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-sm text-text-primary outline-none transition focus:bg-bg-panel"
    />
  )
}

// 只读快照网格
function SnapshotGrid({ columns, rows }: { columns: TestDocColumn[]; rows: TestDocRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-bg-soft/60">
          <th className="w-10 border border-bg-border px-2 py-2 text-xs text-muted">#</th>
          {columns.map((c) => (
            <th key={c.id} className="border border-bg-border px-2 py-2 text-xs font-semibold text-text-secondary">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td className="border border-bg-border px-2 py-1.5 text-center text-xs text-muted">{i + 1}</td>
            {columns.map((c) => (
              <td key={c.id} className="whitespace-pre-wrap border border-bg-border px-2 py-1.5 text-text-primary">
                {r.cells[c.id] ?? ''}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={columns.length + 1} className="py-6 text-center text-xs text-muted">此版本暂无数据行</td></tr>
        )}
      </tbody>
    </table>
  )
}
