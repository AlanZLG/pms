// 项目详情页 - 列表/看板/甘特视图切换

import React, { useMemo, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import {
  Plus,
  ArrowLeft,
  LayoutGrid,
  List,
  Pencil,
  GitMerge,
  Trash2,
  CheckSquare,
  X,
  Square,
  Download,
  GanttChart as GanttIcon,
  Filter,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Trash,
  Settings2,
  Users,
} from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import {
  Button,
  Input,
  Skeleton,
  EmptyState,
  PriorityBadge,
  StatusBadge,
  LabelTag,
} from '@/components/ui'
import ProjectDialog, { ProjectStatusBadge, ProjectTypeBadge } from '@/components/ProjectDialog'
import { MergeProjectDialog } from '@/components/MergeProjectDialog'
import TaskDialog from '@/components/TaskDialog'
import TaskDrawer from '@/components/TaskDrawer'
import BudgetPanel from '@/components/BudgetPanel'
import OpLogsPanel from '@/components/OpLogsPanel'
import GanttChart from '@/components/GanttChart'
import KanbanColumnDialog from '@/components/KanbanColumnDialog'
import MemberImportDialog from '@/components/MemberImportDialog'
import { useAppStore } from '@/stores/app'
import { fmtDate, dueLabel } from '@/lib/date'
import { getUserSortOrder } from '@/lib/utils'
import type { Project, Task, TaskStatus, User, TaskDependency, TaskFilter, SavedFilter, KanbanColumn } from '../../shared/types'
import { projectLedgerLabel } from '../../shared/types'

const columns: { status: TaskStatus; label: string; accent: string }[] = [
  { status: 'todo', label: '待办', accent: 'text-text-secondary' },
  { status: 'in_progress', label: '进行中', accent: 'text-warn' },
  { status: 'review', label: '审核中', accent: 'text-sky-300' },
  { status: 'done', label: '已完成', accent: 'text-ok' },
]

// 看板列内排序模式
type KanbanSortMode = 'manual' | 'due_asc' | 'due_desc' | 'start_asc' | 'start_desc' | 'priority' | 'created_desc'
const KANBAN_SORT_OPTIONS: { value: KanbanSortMode; label: string }[] = [
  { value: 'manual', label: '手动排序（可拖拽）' },
  { value: 'due_asc', label: '截止时间 ↑' },
  { value: 'due_desc', label: '截止时间 ↓' },
  { value: 'start_asc', label: '开始时间 ↑' },
  { value: 'start_desc', label: '开始时间 ↓' },
  { value: 'priority', label: '优先级 高→低' },
  { value: 'created_desc', label: '最近创建' },
]

// 无日期的任务始终排在末尾
function dateCompare(key: (t: Task) => string | null | undefined, dir: 1 | -1) {
  return (a: Task, b: Task) => {
    const av = key(a)
    const bv = key(b)
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av.localeCompare(bv) * dir
  }
}
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export default function ProjectDetail() {
  const { projectId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const data = useAsync(() => api.listTasks(projectId), [projectId])
  const users = useAsync(() => api.listUsers(), [])
  const currentUser = useAppStore((s) => s.user)
  const notify = useAppStore((s) => s.notify)

  const [view, setView] = useState<'list' | 'kanban' | 'gantt'>('gantt')
  const [sortMode, setSortMode] = useState<KanbanSortMode>('manual')
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [presetStatus, setPresetStatus] = useState<TaskStatus>('todo')
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [mergeTargetName, setMergeTargetName] = useState('')
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null)
  const [showBudget, setShowBudget] = useState(false)
  const [showOpLogs, setShowOpLogs] = useState(false)
  const [taskInitialDates, setTaskInitialDates] = useState<{ startDate?: string; dueDate?: string }>({})

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)

  // 高级筛选状态
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false)
  const [advancedFilter, setAdvancedFilter] = useState<TaskFilter>({})
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [saveFilterName, setSaveFilterName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)

  // 看板列配置
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([])
  const [kanbanColumnDialogOpen, setKanbanColumnDialogOpen] = useState(false)

  // 成员导入
  const [memberImportOpen, setMemberImportOpen] = useState(false)

  const project: Project | undefined = data.data?.project
  const tasks: Task[] = useMemo(() => data.data?.tasks ?? [], [data.data])
  const allUsers: User[] = useMemo(() => users.data?.users ?? [], [users.data])

  // 检查当前用户是否可以配置看板列
  const canConfigKanban = useMemo(() => {
    if (!project || !currentUser) return false
    // 管理员或项目所有者可以配置
    return currentUser.role === 'admin' || project.ownerId === currentUser.id
  }, [project, currentUser])

  // 加载项目依赖关系
  const depsData = useAsync(() => api.getProjectDependencies(projectId), [projectId, view])
  const dependencies: TaskDependency[] = depsData.data?.dependencies || []

  // 自动刷新：窗口重新聚焦时立即刷新，页面可见期间每 20s 轮询
  // 有对话框/抽屉打开时暂停，避免打断用户操作
  const hasBlockingUI = taskDialogOpen || projectDialogOpen || drawerTaskId !== null || showSaveDialog || memberImportOpen
  const { reload: reloadProjectData } = data
  useEffect(() => {
    if (!projectId) return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (hasBlockingUI) return
      reloadProjectData()
    }
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(refresh, 20000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [projectId, hasBlockingUI, reloadProjectData])

  // 加载筛选方案
  useEffect(() => {
    if (projectId) {
      api.listFilters(projectId).then((res) => {
        setSavedFilters(res.filters)
      }).catch(() => {
        // 忽略加载失败
      })
    }
  }, [projectId])

  // 加载看板列配置
  useEffect(() => {
    if (projectId) {
      api.getKanbanColumns(projectId).then((res) => {
        setKanbanColumns(res.columns)
      }).catch(() => {
        // 忽略加载失败，使用默认列
      })
    }
  }, [projectId])

  // 处理 URL 中的 taskId 参数（来自全局搜索）
  useEffect(() => {
    const taskId = searchParams.get('taskId')
    if (taskId) {
      setDrawerTaskId(taskId)
      // 清除 URL 中的 taskId 参数
      searchParams.delete('taskId')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // 获取所有标签
  const allLabels = useMemo(() => {
    const labelSet = new Set<string>()
    tasks.forEach((t) => t.labels.forEach((l) => labelSet.add(l)))
    return Array.from(labelSet).sort()
  }, [tasks])

  const projectMembers = useMemo(() => {
    return (project?.members || allUsers.map((u) => ({ userId: u.id, user: { name: u.name } })))
      .map((m) => ({
        id: m.userId,
        name: m.user?.name || '未知',
        user: allUsers.find((u) => u.id === m.userId),
      }))
      .sort((a, b) => {
        const orderA = getUserSortOrder(a.user)
        const orderB = getUserSortOrder(b.user)
        if (orderA !== orderB) return orderA - orderB
        return a.name.localeCompare(b.name)
      })
      .map(({ id, name }) => ({ id, name }))
  }, [project, allUsers])

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      // 基础筛选
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (keyword && !t.title.includes(keyword)) return false

      // 高级筛选
      if (advancedFilter.status && advancedFilter.status.length > 0 && !advancedFilter.status.includes(t.status)) return false
      if (advancedFilter.assigneeId !== undefined) {
        if (advancedFilter.assigneeId === null && t.assigneeId !== null) return false
        if (advancedFilter.assigneeId !== null && t.assigneeId !== advancedFilter.assigneeId) return false
      }
      if (advancedFilter.priority && advancedFilter.priority.length > 0 && !advancedFilter.priority.includes(t.priority)) return false
      if (advancedFilter.labels && advancedFilter.labels.length > 0) {
        const hasLabel = advancedFilter.labels.some((l) => t.labels.includes(l))
        if (!hasLabel) return false
      }
      if (advancedFilter.startDateFrom && t.startDate) {
        if (new Date(t.startDate) < new Date(advancedFilter.startDateFrom)) return false
      }
      if (advancedFilter.startDateTo && t.startDate) {
        if (new Date(t.startDate) > new Date(advancedFilter.startDateTo)) return false
      }
      if (advancedFilter.dueDateFrom && t.dueDate) {
        if (new Date(t.dueDate) < new Date(advancedFilter.dueDateFrom)) return false
      }
      if (advancedFilter.dueDateTo && t.dueDate) {
        if (new Date(t.dueDate) > new Date(advancedFilter.dueDateTo)) return false
      }
      if (advancedFilter.keyword && !t.title.includes(advancedFilter.keyword) && !t.description.includes(advancedFilter.keyword)) return false

      return true
    })
  }, [tasks, keyword, statusFilter, advancedFilter])

  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = {}
    // 使用动态看板列或默认列
    const cols = kanbanColumns.length > 0 ? kanbanColumns : columns
    cols.forEach((col) => {
      const statusKey = 'statusKey' in col ? col.statusKey : col.status
      map[statusKey] = []
    })
    // 将任务分配到对应的列
    tasks.forEach((t) => {
      // 如果有自定义状态，使用自定义状态；否则使用标准状态
      const statusKey = t.customStatus || t.status
      if (map[statusKey]) {
        map[statusKey].push(t)
      } else {
        // 如果没有匹配的列，放到标准状态列
        if (map[t.status]) {
          map[t.status].push(t)
        }
      }
    })
    // 列内排序
    const comparators: Record<KanbanSortMode, (a: Task, b: Task) => number> = {
      manual: (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt),
      due_asc: dateCompare((t) => t.dueDate, 1),
      due_desc: dateCompare((t) => t.dueDate, -1),
      start_asc: dateCompare((t) => t.startDate ?? null, 1),
      start_desc: dateCompare((t) => t.startDate ?? null, -1),
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
      created_desc: (a, b) => b.createdAt.localeCompare(a.createdAt),
    }
    const cmp = comparators[sortMode]
    Object.keys(map).forEach((k) => map[k].sort(cmp))
    return map
  }, [tasks, kanbanColumns, sortMode])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    const t = tasks.find((x) => x.id === activeId)
    if (!t) return
    // over 是列空白区（droppable id = statusKey）还是另一张卡片
    const overTask = tasks.find((x) => x.id === overId)
    const keyOf = (task: Task) => task.customStatus || task.status
    try {
      if (!overTask) {
        // 拖到列空白处 → 状态变更，排到该列末尾（新建时 sort_order 已是最大）
        const newStatus = overId as TaskStatus
        if (t.status === newStatus) return
        await api.updateTaskStatus(activeId, newStatus)
        notify('success', '状态已更新')
      } else if (keyOf(t) === keyOf(overTask)) {
        // 同列内拖拽 → 持久化新顺序（仅手动排序模式）
        if (sortMode !== 'manual') return
        const ids = (grouped[keyOf(t)] || []).map((x) => x.id)
        if (!ids.includes(overId)) return
        const next = arrayMove(ids, ids.indexOf(activeId), ids.indexOf(overId))
        await api.reorderTasks(next)
        notify('success', '顺序已保存')
      } else {
        // 跨列拖到卡片上 → 改状态并插入到落点位置
        const targetKey = keyOf(overTask)
        const targetIds = (grouped[targetKey] || []).map((x) => x.id)
        const idx = targetIds.indexOf(overId)
        const next = targetIds.includes(activeId)
          ? arrayMove(targetIds, targetIds.indexOf(activeId), idx)
          : [...targetIds.slice(0, idx), activeId, ...targetIds.slice(idx)]
        await api.updateTaskStatus(activeId, overTask.status)
        if (sortMode === 'manual') await api.reorderTasks(next)
        notify('success', '状态已更新')
      }
      data.reload()
    } catch (err) {
      notify('error', getErrorMessage(err, '操作失败'))
    }
  }, [tasks, grouped, sortMode, notify, data])

  const openCreate = useCallback((status: TaskStatus = 'todo') => {
    setEditingTask(null)
    setPresetStatus(status)
    setTaskInitialDates({})
    setTaskDialogOpen(true)
  }, [])

  const openCreateWithDates = useCallback((startDate: string, dueDate: string) => {
    setEditingTask(null)
    setPresetStatus('todo')
    setTaskInitialDates({ startDate, dueDate })
    setTaskDialogOpen(true)
  }, [])

  const openEdit = useCallback((t: Task) => {
    setEditingTask(t)
    setPresetStatus(t.status)
    setTaskDialogOpen(true)
  }, [])

  const deleteTask = useCallback(async (t: Task) => {
    if (!confirm(`确认删除任务「${t.title}」?`)) return
    try {
      await api.deleteTask(t.id)
      notify('success', '已删除')
      data.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }, [notify, data])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)))
    }
  }, [selectedIds.size, filtered])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const batchUpdateStatus = useCallback(async (status: TaskStatus) => {
    if (selectedIds.size === 0) return
    const snapshots = tasks
      .filter((t) => selectedIds.has(t.id))
      .map((t) => ({ id: t.id, status: t.status }))
    setBatchBusy(true)
    try {
      let ok = 0
      for (const id of selectedIds) {
        await api.updateTaskStatus(id, status)
        ok++
      }
      notify('success', `已更新 ${ok} 个任务状态`, {
        undoLabel: '撤销',
        onUndo: async () => {
          for (const snap of snapshots) {
            await api.updateTask(snap.id, { status: snap.status })
          }
          data.reload()
        },
      })
      setSelectedIds(new Set())
      data.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '批量更新失败'))
    } finally {
      setBatchBusy(false)
    }
  }, [selectedIds, tasks, notify, data])

  const batchUpdateAssignee = useCallback(async (assigneeId: string | null) => {
    if (selectedIds.size === 0) return
    const snapshots = tasks
      .filter((t) => selectedIds.has(t.id))
      .map((t) => ({ id: t.id, assigneeId: t.assigneeId }))
    setBatchBusy(true)
    try {
      let ok = 0
      for (const id of selectedIds) {
        await api.updateTask(id, { assigneeId })
        ok++
      }
      notify('success', `已更新 ${ok} 个任务负责人`, {
        undoLabel: '撤销',
        onUndo: async () => {
          for (const snap of snapshots) {
            await api.updateTask(snap.id, { assigneeId: snap.assigneeId })
          }
          data.reload()
        },
      })
      setSelectedIds(new Set())
      data.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '批量更新失败'))
    } finally {
      setBatchBusy(false)
    }
  }, [selectedIds, tasks, notify, data])

  const batchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`确认删除选中的 ${selectedIds.size} 个任务?`)) return
    const deletedIds = Array.from(selectedIds)
    setBatchBusy(true)
    try {
      let ok = 0
      for (const id of selectedIds) {
        await api.deleteTask(id)
        ok++
      }
      notify('success', `已删除 ${ok} 个任务`, {
        undoLabel: '撤销',
        onUndo: async () => {
          for (const id of deletedIds) {
            await api.restoreTask(id)
          }
          data.reload()
        },
      })
      setSelectedIds(new Set())
      data.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '批量删除失败'))
    } finally {
      setBatchBusy(false)
    }
  }, [selectedIds, notify, data])

  const saveProject = useCallback(async (d: Partial<Project>) => {
    if (!project) return
    await api.updateProject(project.id, d)
    notify('success', '项目已更新')
    setProjectDialogOpen(false)
    data.reload()
  }, [project, notify, data])

  // 筛选相关方法
  const handleSaveFilter = useCallback(async () => {
    if (!saveFilterName.trim()) {
      notify('error', '请输入方案名称')
      return
    }
    try {
      const res = await api.createFilter(projectId, {
        name: saveFilterName.trim(),
        filterConfig: advancedFilter,
      })
      setSavedFilters((prev) => [res.filter, ...prev])
      setSaveFilterName('')
      setShowSaveDialog(false)
      notify('success', '筛选方案已保存')
    } catch (e) {
      notify('error', getErrorMessage(e, '保存失败'))
    }
  }, [projectId, saveFilterName, advancedFilter, notify])

  const handleDeleteFilter = useCallback(async (id: string) => {
    if (!confirm('确认删除此筛选方案?')) return
    try {
      await api.deleteFilter(id)
      setSavedFilters((prev) => prev.filter((f) => f.id !== id))
      notify('success', '筛选方案已删除')
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }, [notify])

  const handleApplyFilter = useCallback((filter: SavedFilter) => {
    setAdvancedFilter(filter.filterConfig)
    setShowAdvancedFilter(false)
    // 重新加载任务数据
    data.reload()
  }, [data])

  const handleClearFilter = useCallback(() => {
    setAdvancedFilter({})
  }, [])

  const ganttUsers = useMemo(() => {
    return allUsers.map((u) => ({ id: u.id, name: u.name }))
  }, [allUsers])

  const handleGanttTaskUpdate = useCallback(async (taskId: string, updateData: Partial<Task>) => {
    await api.updateTask(taskId, updateData)
    notify('success', '任务已更新')
    data.reload()
  }, [notify, data])

  const handleAddDependency = useCallback(async (taskId: string, dependsOnTaskId: string, type: 'fs' | 'ss' | 'ff' | 'sf', lagDays = 0) => {
    await api.addDependency(taskId, dependsOnTaskId, type, lagDays)
    notify('success', '依赖关系已添加')
    depsData.reload()
  }, [notify, depsData])

  const handleUpdateDependency = useCallback(async (depId: string, type: 'fs' | 'ss' | 'ff' | 'sf', lagDays: number) => {
    await api.updateDependency(depId, type, lagDays)
    notify('success', '依赖关系已更新')
    depsData.reload()
  }, [notify, depsData])

  const handleRemoveDependency = useCallback(async (depId: string) => {
    await api.removeDependency(depId)
    notify('success', '依赖关系已删除')
    depsData.reload()
  }, [notify, depsData])

  const handleTaskClick = useCallback((task: Task) => {
    setDrawerTaskId(task.id)
  }, [])

  const handleTaskSaved = useCallback(async () => {
    notify('success', editingTask ? '任务已更新' : '任务已创建')
    await data.reload()
  }, [editingTask, notify, data])

  if (data.loading && !project) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (!project) {
    return <EmptyState title="项目不存在或已删除" hint="返回项目列表查看" />
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* 顶部 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/projects"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-text-secondary"
          >
            <ArrowLeft className="h-3 w-3" /> 返回项目
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl text-text-primary">{project.name}</h2>
            <ProjectTypeBadge type={project.projectType} />
            {project.mergedIntoProjectId && (
              <span className="rounded-md bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-400">
                已合并{mergeTargetName ? ` → ${mergeTargetName}` : ''}
              </span>
            )}
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {project.description || '暂无描述'} · 截止 {fmtDate(project.dueDate, 'yyyy-MM-dd')}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted">
            <span>进度 {project.progress}%</span>
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-soft">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand to-brand-soft"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <span>{tasks.length} 个任务</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={async () => {
            try {
              await api.exportTasksCsv(project.id)
              notify('success', '任务导出成功')
            } catch (e) {
              notify('error', getErrorMessage(e, '导出失败'))
            }
          }}>
            <Download className="h-3.5 w-3.5" /> 导出任务
          </Button>
          <Button variant="ghost" size="sm" onClick={async () => {
            try {
              await api.exportProgressXlsx(project.id)
              notify('success', '进度导出成功')
            } catch (e) {
              notify('error', getErrorMessage(e, '导出失败'))
            }
          }}>
            <Download className="h-3.5 w-3.5" /> 导出进度
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setProjectDialogOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> 编辑项目
          </Button>
          {project.projectType === '运维增强' && !project.mergedIntoProjectId && currentUser
            && (currentUser.role === 'admin' || currentUser.id === project.ownerId) && (
            <Button variant="ghost" size="sm" onClick={() => setMergeDialogOpen(true)}>
              <GitMerge className="h-3.5 w-3.5" /> 合并到运维项目
            </Button>
          )}
          {view === 'kanban' && (
            <Button variant="ghost" size="sm" onClick={() => setKanbanColumnDialogOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" /> 配置看板
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setMemberImportOpen(true)}>
            <Users className="h-3.5 w-3.5" /> 批量导入成员
          </Button>
          <Button onClick={() => openCreate('todo')}>
            <Plus className="h-4 w-4" /> 新建任务
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowBudget(!showBudget)}>
            预算
          </Button>
          <Button variant={showOpLogs ? 'primary' : 'ghost'} size="sm" onClick={() => setShowOpLogs(!showOpLogs)}>
            {projectLedgerLabel(project.projectType)}
          </Button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Input
            placeholder="搜索任务"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            disabled={selectMode}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={Object.keys(advancedFilter).length > 0 ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
          >
            <Filter className="h-3.5 w-3.5" />
            {Object.keys(advancedFilter).length > 0 ? `筛选中 (${filtered.length})` : '高级筛选'}
            {showAdvancedFilter ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          {view === 'list' && !selectMode && (
            <Button variant="ghost" size="sm" onClick={() => setSelectMode(true)}>
              <CheckSquare className="h-3.5 w-3.5" /> 批量操作
            </Button>
          )}
          {view === 'list' && selectMode && (
            <Button variant="ghost" size="sm" onClick={exitSelectMode}>
              <X className="h-3.5 w-3.5" /> 退出
            </Button>
          )}
          {view === 'list' && (
            <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
              {(['all', 'todo', 'in_progress', 'review', 'done'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-medium transition ' +
                    (statusFilter === s
                      ? 'bg-brand text-text-primary'
                      : 'text-muted hover:text-text-secondary')
                  }
                >
                  {s === 'all' ? '全部' : columns.find((c) => c.status === s)?.label}
                </button>
              ))}
            </div>
          )}
          {view === 'kanban' && (
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as KanbanSortMode)}
              className="h-8 rounded-lg border border-bg-border bg-bg-panel px-2 text-xs text-text-secondary outline-none transition focus:border-brand/50"
              title="看板列内排序方式"
            >
              {KANBAN_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <div className="flex gap-1 rounded-lg bg-bg-soft p-1">
            <button
              onClick={() => setView('list')}
              className={
                'rounded-md p-1.5 transition ' +
                (view === 'list' ? 'bg-brand text-text-primary' : 'text-muted hover:text-text-secondary')
              }
              title="列表"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('kanban')}
              className={
                'rounded-md p-1.5 transition ' +
                (view === 'kanban' ? 'bg-brand text-text-primary' : 'text-muted hover:text-text-secondary')
              }
              title="看板"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('gantt')}
              className={
                'rounded-md p-1.5 transition ' +
                (view === 'gantt' ? 'bg-brand text-text-primary' : 'text-muted hover:text-text-secondary')
              }
              title="甘特图"
            >
              <GanttIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 高级筛选面板 */}
      {showAdvancedFilter && (
        <div className="rounded-xl border border-bg-border bg-bg-panel/60 p-4 animate-fade-up">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* 状态多选 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">状态</label>
              <div className="flex flex-wrap gap-1.5">
                {columns.map((col) => (
                  <button
                    key={col.status}
                    onClick={() => {
                      const current = advancedFilter.status || []
                      if (current.includes(col.status)) {
                        setAdvancedFilter({
                          ...advancedFilter,
                          status: current.filter((s) => s !== col.status),
                        })
                      } else {
                        setAdvancedFilter({
                          ...advancedFilter,
                          status: [...current, col.status],
                        })
                      }
                    }}
                    className={
                      'rounded-md px-2.5 py-1.5 text-xs font-medium transition ' +
                      ((advancedFilter.status || []).includes(col.status)
                        ? 'bg-brand text-text-primary'
                        : 'bg-bg-soft text-muted hover:text-text-secondary')
                    }
                  >
                    {col.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 负责人下拉 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">负责人</label>
              <select
                value={advancedFilter.assigneeId === undefined ? '' : advancedFilter.assigneeId || 'null'}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === '') {
                    setAdvancedFilter({ ...advancedFilter, assigneeId: undefined })
                  } else if (value === 'null') {
                    setAdvancedFilter({ ...advancedFilter, assigneeId: null })
                  } else {
                    setAdvancedFilter({ ...advancedFilter, assigneeId: value })
                  }
                }}
                className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
              >
                <option value="">全部</option>
                <option value="null">未指派</option>
                {projectMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            {/* 优先级多选 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">优先级</label>
              <div className="flex flex-wrap gap-1.5">
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      const current = advancedFilter.priority || []
                      if (current.includes(p)) {
                        setAdvancedFilter({
                          ...advancedFilter,
                          priority: current.filter((pr) => pr !== p),
                        })
                      } else {
                        setAdvancedFilter({
                          ...advancedFilter,
                          priority: [...current, p],
                        })
                      }
                    }}
                    className={
                      'rounded-md px-2.5 py-1.5 text-xs font-medium transition ' +
                      ((advancedFilter.priority || []).includes(p)
                        ? 'bg-brand text-text-primary'
                        : 'bg-bg-soft text-muted hover:text-text-secondary')
                    }
                  >
                    {p === 'low' ? '低' : p === 'medium' ? '中' : p === 'high' ? '高' : '紧急'}
                  </button>
                ))}
              </div>
            </div>

            {/* 标签多选 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">标签</label>
              <div className="flex flex-wrap gap-1.5">
                {allLabels.length > 0 ? (
                  allLabels.slice(0, 10).map((l) => (
                    <button
                      key={l}
                      onClick={() => {
                        const current = advancedFilter.labels || []
                        if (current.includes(l)) {
                          setAdvancedFilter({
                            ...advancedFilter,
                            labels: current.filter((lb) => lb !== l),
                          })
                        } else {
                          setAdvancedFilter({
                            ...advancedFilter,
                            labels: [...current, l],
                          })
                        }
                      }}
                      className={
                        'rounded-md px-2.5 py-1.5 text-xs font-medium transition ' +
                        ((advancedFilter.labels || []).includes(l)
                          ? 'bg-brand text-text-primary'
                          : 'bg-bg-soft text-muted hover:text-text-secondary')
                      }
                    >
                      {l}
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-muted">暂无标签</span>
                )}
              </div>
            </div>

            {/* 开始日期范围 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">开始日期范围</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={advancedFilter.startDateFrom || ''}
                  onChange={(e) =>
                    setAdvancedFilter({ ...advancedFilter, startDateFrom: e.target.value || undefined })
                  }
                  className="flex-1 rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
                  placeholder="开始"
                />
                <input
                  type="date"
                  value={advancedFilter.startDateTo || ''}
                  onChange={(e) =>
                    setAdvancedFilter({ ...advancedFilter, startDateTo: e.target.value || undefined })
                  }
                  className="flex-1 rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
                  placeholder="结束"
                />
              </div>
            </div>

            {/* 截止日期范围 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">截止日期范围</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={advancedFilter.dueDateFrom || ''}
                  onChange={(e) =>
                    setAdvancedFilter({ ...advancedFilter, dueDateFrom: e.target.value || undefined })
                  }
                  className="flex-1 rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
                  placeholder="开始"
                />
                <input
                  type="date"
                  value={advancedFilter.dueDateTo || ''}
                  onChange={(e) =>
                    setAdvancedFilter({ ...advancedFilter, dueDateTo: e.target.value || undefined })
                  }
                  className="flex-1 rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
                  placeholder="结束"
                />
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleClearFilter}>
                清除筛选
              </Button>
              {Object.keys(advancedFilter).length > 0 && (
                <span className="text-xs text-muted">
                  已筛选 {filtered.length} / {tasks.length} 个任务
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* 筛选方案 */}
              {savedFilters.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    onChange={(e) => {
                      const filterId = e.target.value
                      if (filterId) {
                        const filter = savedFilters.find((f) => f.id === filterId)
                        if (filter) handleApplyFilter(filter)
                      }
                    }}
                    className="rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
                    defaultValue=""
                  >
                    <option value="" disabled>加载方案</option>
                    {savedFilters.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSaveDialog(true)}
                disabled={Object.keys(advancedFilter).length === 0}
              >
                <Bookmark className="h-3.5 w-3.5" /> 保存方案
              </Button>
            </div>
          </div>

          {/* 已保存的筛选方案列表 */}
          {savedFilters.length > 0 && (
            <div className="mt-3 border-t border-bg-border pt-3">
              <div className="mb-2 text-xs font-medium text-muted">已保存的方案</div>
              <div className="flex flex-wrap gap-2">
                {savedFilters.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-1 rounded-lg border border-bg-border bg-bg-soft px-2 py-1"
                  >
                    <button
                      onClick={() => handleApplyFilter(f)}
                      className="text-xs text-text-secondary hover:text-brand"
                    >
                      {f.name}
                    </button>
                    <button
                      onClick={() => handleDeleteFilter(f.id)}
                      className="text-muted hover:text-danger"
                    >
                      <Trash className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 保存筛选方案对话框 */}
      {showSaveDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-bg-panel p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-medium text-text-primary">保存筛选方案</h3>
            <Input
              placeholder="方案名称"
              value={saveFilterName}
              onChange={(e) => setSaveFilterName(e.target.value)}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowSaveDialog(false)}>
                取消
              </Button>
              <Button onClick={handleSaveFilter}>
                保存
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 批量操作工具栏 */}
      {view === 'list' && selectMode && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
          <span className="text-sm font-medium text-brand-soft">
            已选中 {selectedIds.size} 项 / 共 {filtered.length} 项
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              disabled={batchBusy}
              onChange={(e) => {
                if (e.target.value) batchUpdateStatus(e.target.value as TaskStatus)
              }}
              className="rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
              defaultValue=""
            >
              <option value="" disabled>更新状态</option>
              {columns.map((c) => (
                <option key={c.status} value={c.status}>{c.label}</option>
              ))}
            </select>
            <select
              disabled={batchBusy}
              onChange={(e) => {
                batchUpdateAssignee(e.target.value || null)
              }}
              className="rounded-lg border border-bg-border bg-bg-soft px-3 py-1.5 text-sm text-text-primary outline-none focus:border-brand"
              defaultValue=""
            >
              <option value="" disabled>更新负责人</option>
              <option value="">未指派</option>
              {projectMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Button variant="danger" size="sm" onClick={batchDelete} disabled={batchBusy}>
              <Trash2 className="h-3.5 w-3.5" /> 批量删除
            </Button>
          </div>
        </div>
      )}

      {/* 内容 */}
      {showBudget && <BudgetPanel projectId={projectId} />}
      {showOpLogs && (
        <div className="mb-4 rounded-2xl border border-bg-border bg-bg-panel/40 p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">
            {projectLedgerLabel(project.projectType)}（本项目）
          </h3>
          <OpLogsPanel projectId={projectId} />
        </div>
      )}

      <div key={view} className="animate-fade-up">
      {view === 'list' ? (
        filtered.length === 0 ? (
          <EmptyState title="没有匹配的任务" hint="调整筛选条件或新建任务" />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-bg-border">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft text-xs text-muted">
                <tr>
                  {selectMode && (
                    <th className="w-10 px-3 py-3">
                      <button
                        onClick={selectAll}
                        className="grid h-5 w-5 place-items-center rounded border border-bg-border bg-bg-soft transition hover:border-brand"
                        title={selectedIds.size === filtered.length ? '取消全选' : '全选'}
                      >
                        {selectedIds.size === filtered.length && filtered.length > 0 ? (
                          <CheckSquare className="h-3.5 w-3.5 text-brand" />
                        ) : selectedIds.size > 0 ? (
                          <Square className="h-3.5 w-3.5 text-brand" />
                        ) : (
                          <Square className="h-3.5 w-3.5 text-muted" />
                        )}
                      </button>
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-medium">任务</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">优先级</th>
                  <th className="px-4 py-3 text-left font-medium">截止</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {filtered.map((t) => {
                  const dl = dueLabel(t.dueDate, t.status === 'done')
                  const isSelected = selectedIds.has(t.id)
                  return (
                    <tr
                      key={t.id}
                      className={
                        'transition hover:bg-bg-soft/60 ' +
                        (selectMode ? 'cursor-pointer ' : 'cursor-pointer ') +
                        (isSelected ? 'bg-brand/10' : '')
                      }
                      onClick={() => {
                        if (selectMode) toggleSelect(t.id)
                        else setDrawerTaskId(t.id)
                      }}
                    >
                      {selectMode && (
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => toggleSelect(t.id)}
                            className={
                              'grid h-5 w-5 place-items-center rounded border transition ' +
                              (isSelected
                                ? 'border-brand bg-brand text-text-primary'
                                : 'border-bg-border hover:border-brand')
                            }
                          >
                            {isSelected && <CheckSquare className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="font-medium text-text-primary">{t.title}</div>
                        {t.labels.length > 0 && (
                          <div className="mt-1 flex gap-1">
                            {t.labels.map((l) => (
                              <LabelTag key={l} label={l} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        <span
                          className={
                            dl.tone === 'overdue'
                              ? 'text-danger'
                              : dl.tone === 'soon'
                                ? 'text-warn'
                                : ''
                          }
                        >
                          {dl.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {!selectMode && (
                          <>
                            <button
                              className="mr-2 text-muted hover:text-brand-soft"
                              onClick={() => openEdit(t)}
                              title="编辑"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="text-muted hover:text-danger"
                              onClick={() => deleteTask(t)}
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(kanbanColumns.length > 0 ? kanbanColumns : columns).map((col) => {
              const statusKey = 'statusKey' in col ? col.statusKey : col.status
              const label = 'label' in col ? col.label : col.label
              const color = 'color' in col ? col.color : undefined
              const list = grouped[statusKey] || []
              return (
                <KanbanColumn
                  key={statusKey}
                  status={statusKey as TaskStatus}
                  label={label}
                  accent={color ? '' : ('accent' in col ? col.accent : 'text-text-secondary')}
                  color={color}
                  count={list.length}
                  onAdd={() => openCreate(statusKey as TaskStatus)}
                  showConfigButton={canConfigKanban}
                  onConfig={() => setKanbanColumnDialogOpen(true)}
                >
                  <SortableContext items={list.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    {list.map((t) => (
                      <KanbanCard
                        key={t.id}
                        task={t}
                        statusKey={statusKey}
                        onOpen={() => setDrawerTaskId(t.id)}
                        onEdit={() => openEdit(t)}
                        onDelete={() => deleteTask(t)}
                      />
                    ))}
                  </SortableContext>
                  {list.length === 0 && (
                    <div className="rounded-xl border border-dashed border-bg-border px-3 py-6 text-center text-xs text-muted">
                      暂无
                    </div>
                  )}
                </KanbanColumn>
              )
            })}
          </div>
        </DndContext>
      )}

      {view === 'gantt' && (
        <div className="h-[calc(100vh-220px)] min-h-[500px]">
          {tasks.length === 0 ? (
            <EmptyState title="暂无任务" hint="创建任务后查看甘特图" />
          ) : (
            <GanttChart
              tasks={tasks}
              dependencies={dependencies}
              users={ganttUsers}
              onTaskUpdate={handleGanttTaskUpdate}
              onAddDependency={handleAddDependency}
              onUpdateDependency={handleUpdateDependency}
              onRemoveDependency={handleRemoveDependency}
              onTaskClick={handleTaskClick}
              onCreateTask={(data) => openCreateWithDates(data.startDate, data.dueDate)}
            />
          )}
        </div>
      )}
      </div>

      {/* 对话框 */}
      <ProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onSubmit={saveProject}
        title="编辑项目"
        defaultValues={{
          name: project.name,
          description: project.description,
          status: project.status,
          projectType: project.projectType || undefined,
          dueDate: project.dueDate || '',
        }}
      />
      <MergeProjectDialog
        open={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        sourceProject={project}
        onSuccess={(_updated, moved, targetName) => {
          setMergeDialogOpen(false)
          setMergeTargetName(targetName)
          notify('success', `已合并到「${targetName}」，${moved} 条台账/课题记录完成转绑`)
          data.reload()
        }}
      />
      <TaskDialog
        open={taskDialogOpen}
        onClose={() => setTaskDialogOpen(false)}
        projectId={projectId}
        task={editingTask}
        defaultStatus={presetStatus}
        initialStartDate={taskInitialDates.startDate}
        initialDueDate={taskInitialDates.dueDate}
        onSaved={handleTaskSaved}
      />

      <TaskDrawer
        taskId={drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onChanged={data.reload}
      />

      <KanbanColumnDialog
        projectId={projectId}
        open={kanbanColumnDialogOpen}
        onClose={() => setKanbanColumnDialogOpen(false)}
        onChanged={() => {
          // 重新加载看板列配置
          api.getKanbanColumns(projectId).then((res) => {
            setKanbanColumns(res.columns)
          })
          data.reload()
        }}
      />

      <MemberImportDialog
        projectId={projectId}
        open={memberImportOpen}
        onClose={() => setMemberImportOpen(false)}
        onImported={() => {
          // 重新加载项目数据
          data.reload()
        }}
      />
    </div>
  )
}

// ===== 看板列 =====
function KanbanColumn({
  status,
  label,
  accent,
  color,
  count,
  onAdd,
  showConfigButton,
  onConfig,
  children,
}: {
  status: TaskStatus
  label: string
  accent: string
  color?: string
  count: number
  onAdd: () => void
  showConfigButton?: boolean
  onConfig?: () => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={
        'flex flex-col rounded-2xl border bg-bg-panel/60 p-3 transition ' +
        (isOver ? 'border-brand/60 bg-brand/5' : 'border-bg-border')
      }
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {color ? (
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          ) : null}
          <span className={'text-sm font-medium ' + (color ? '' : accent)} style={color ? { color } : undefined}>
            {label}
          </span>
          <span className="rounded-full bg-bg-soft px-1.5 py-0.5 text-xs text-muted">{count}</span>
        </div>
        <div className="flex items-center gap-1">
          {showConfigButton && onConfig && (
            <button
              className="text-muted transition hover:text-brand-soft"
              onClick={onConfig}
              title="配置列"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          <button
            className="text-muted transition hover:text-brand-soft"
            onClick={onAdd}
            title="在该列新建"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// ===== 看板卡片 =====
function KanbanCard({
  task,
  statusKey,
  onOpen,
  onEdit,
  onDelete,
}: {
  task: Task
  statusKey: string
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: statusKey },
  })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition }
    : undefined
  const dl = dueLabel(task.dueDate, task.status === 'done')
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation()
          onOpen()
        }
      }}
      className={
        'group cursor-pointer rounded-xl border border-bg-border bg-bg/60 p-3 shadow-sm transition hover:border-brand/40 hover:shadow-glow ' +
        (isDragging ? 'opacity-60' : '')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">{task.title}</p>
        <div className="flex opacity-0 transition group-hover:opacity-100">
          <button
            className="text-muted hover:text-brand-soft"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            title="编辑"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="ml-1 text-muted hover:text-danger"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <LabelTag key={l} label={l} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <PriorityBadge priority={task.priority} />
        <div className="flex items-center gap-2">
          {task.dueDate && (
            <span
              className={
                'text-xs ' +
                (dl.tone === 'overdue'
                  ? 'text-danger'
                  : dl.tone === 'soon'
                    ? 'text-warn'
                    : 'text-muted')
              }
            >
              {dl.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}