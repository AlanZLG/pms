import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Link, Plus, Diamond, AlertTriangle, Filter, Users, ChevronDown } from 'lucide-react'
import type { Task, TaskDependency, TaskStatus } from '../../shared/types'
import { STATUS_META } from '@/lib/constants'
import { useDebounce } from '@/hooks/useDebounce'
import DependencyDialog from './DependencyDialog'

interface GanttChartProps {
  tasks: Task[]
  dependencies?: TaskDependency[]
  onTaskUpdate?: (taskId: string, data: { startDate?: string; dueDate?: string; progress?: number }) => void
  onAddDependency?: (taskId: string, dependsOnTaskId: string, type: 'fs' | 'ss' | 'ff' | 'sf', lagDays?: number) => void
  onUpdateDependency?: (depId: string, type: 'fs' | 'ss' | 'ff' | 'sf', lagDays: number) => void
  onRemoveDependency?: (depId: string) => void
  onTaskClick?: (task: Task) => void
  onCreateTask?: (data: { startDate: string; dueDate: string }) => void
  users?: { id: string; name: string }[]
}

type ZoomLevel = 'day' | 'week' | 'month'

const DAY_WIDTHS: Record<ZoomLevel, number> = {
  day: 60,
  week: 15,
  month: 5,
}

const ROW_HEIGHT = 48
const LEFT_COL_WIDTH = 180
const HEADER_HEIGHT = 84

function isOverdue(task: Task): boolean {
  if (task.status === 'done') return false
  if (!task.dueDate) return false
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return new Date(task.dueDate) < now
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getQuarter(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1
  return `${date.getFullYear()}年Q${q}`
}

export default function GanttChart({
  tasks,
  dependencies = [],
  onTaskUpdate,
  onAddDependency,
  onUpdateDependency,
  onRemoveDependency,
  onTaskClick,
  onCreateTask,
  users = [],
}: GanttChartProps) {
  const [zoom, setZoom] = useState<ZoomLevel>('day')
  const [dragging, setDragging] = useState<{ taskId: string; type: 'move' | 'resize-left' | 'resize-right' | 'progress'; startX: number; startDate: string; dueDate: string; currentStartDate: string; currentDueDate: string; progress?: number; currentProgress?: number } | null>(null)
  const [linking, setLinking] = useState<{ fromTaskId: string; mouseX: number; mouseY: number } | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // 依赖对话框状态
  const [depDialogOpen, setDepDialogOpen] = useState(false)
  const [depDialogSourceTask, setDepDialogSourceTask] = useState<Task | null>(null)
  const [depDialogTargetTask, setDepDialogTargetTask] = useState<Task | null>(null)
  const [editingDependency, setEditingDependency] = useState<TaskDependency | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [showCreateHint, setShowCreateHint] = useState(false)
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [filterLabel, setFilterLabel] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [showFilter, setShowFilter] = useState(false)
  const [groupByAssignee, setGroupByAssignee] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const GROUP_HEADER_HEIGHT = 32

  const scrollRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const taskPositionsRef = useRef<Record<string, { left: number; width: number; hasDates: boolean }>>({})

  const dayWidth = DAY_WIDTHS[zoom]

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop
    setScrollTop(st)
    setViewportHeight(e.currentTarget.clientHeight)
  }, [])

  const scrollByDays = useCallback((days: number) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: days * dayWidth, behavior: 'smooth' })
    }
  }, [dayWidth])

  const scrollToToday = useCallback(() => {
    if (scrollRef.current) {
      const today = new Date()
      const dayOffset = daysBetween(minDateRef.current || today, today)
      scrollRef.current.scrollTo({ left: dayOffset * dayWidth, behavior: 'smooth' })
    }
  }, [dayWidth])

  const minDateRef = useRef<Date | null>(null)

  const { minDate, totalDays } = useMemo(() => {
    const dates = tasks.flatMap((t) => [
      t.startDate ? new Date(t.startDate) : null,
      t.dueDate ? new Date(t.dueDate) : null,
    ]).filter(Boolean) as Date[]

    if (dates.length === 0) {
      const today = new Date()
      return {
        minDate: startOfWeek(today),
        maxDate: endOfMonth(today),
        totalDays: daysBetween(startOfWeek(today), endOfMonth(today)),
      }
    }

    let min = new Date(Math.min(...dates.map((d) => d.getTime())))
    let max = new Date(Math.max(...dates.map((d) => d.getTime())))

    min = startOfWeek(min)
    max = addDays(endOfWeek(max), 7)

    return { minDate: min, maxDate: max, totalDays: daysBetween(min, max) }
  }, [tasks])

  // Auto-scroll to put today at the leftmost position
  useEffect(() => {
    minDateRef.current = minDate
    if (scrollRef.current) {
      const today = new Date()
      const dayOffset = daysBetween(minDate, today)
      scrollRef.current.scrollTo({ left: dayOffset * dayWidth, behavior: 'auto' })
    }
  }, [minDate, dayWidth])

  // Keep horizontal scroll position when zoom changes
  const prevDayWidthRef = useRef(dayWidth)
  useEffect(() => {
    if (prevDayWidthRef.current !== dayWidth && scrollRef.current) {
      const currentScroll = scrollRef.current.scrollLeft
      const oldDayWidth = prevDayWidthRef.current
      const dayAtLeft = Math.round(currentScroll / oldDayWidth)
      scrollRef.current.scrollTo({ left: dayAtLeft * dayWidth, behavior: 'auto' })
      prevDayWidthRef.current = dayWidth
    }
  }, [dayWidth])

  const dateToX = useCallback(
    (date: Date) => {
      const dayDiff = daysBetween(minDate, date)
      return dayDiff * dayWidth
    },
    [minDate, dayWidth],
  )

  const snapToGrid = useCallback((dayDeltaFloat: number): number => {
    if (zoom === 'day') {
      return Math.round(dayDeltaFloat)
    }
    return Math.round(dayDeltaFloat)
  }, [zoom])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, task: Task, type: 'move' | 'resize-left' | 'resize-right' | 'progress') => {
      e.stopPropagation()
      const startDate = task.startDate || task.dueDate || new Date().toISOString()
      const dueDate = task.dueDate || task.startDate || new Date().toISOString()
      setDragging({
        taskId: task.id,
        type,
        startX: e.clientX,
        startDate,
        dueDate,
        currentStartDate: startDate,
        currentDueDate: dueDate,
        progress: task.status === 'done' ? 1 : task.status === 'in_progress' ? 0.5 : 0,
        currentProgress: task.status === 'done' ? 1 : task.status === 'in_progress' ? 0.5 : 0,
      })
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) {
        const deltaX = e.clientX - dragging.startX
        const dayDeltaFloat = deltaX / dayWidth
        const dayDelta = snapToGrid(dayDeltaFloat)

        if (dragging.type === 'move') {
          const currentStartDate = addDays(new Date(dragging.startDate), dayDelta).toISOString()
          const currentDueDate = addDays(new Date(dragging.dueDate), dayDelta).toISOString()
          setDragging({ ...dragging, currentStartDate, currentDueDate })
        } else if (dragging.type === 'resize-right') {
          const currentDueDate = addDays(new Date(dragging.dueDate), dayDelta).toISOString()
          setDragging({ ...dragging, currentDueDate })
        } else if (dragging.type === 'resize-left') {
          const currentStartDate = addDays(new Date(dragging.startDate), dayDelta).toISOString()
          setDragging({ ...dragging, currentStartDate })
        } else if (dragging.type === 'progress') {
          const totalWidth = taskPositionsRef.current[dragging.taskId]?.width || 100
          const progressDelta = deltaX / totalWidth
          let newProgress = Math.max(0, Math.min(1, (dragging.currentProgress || 0) + progressDelta))
          newProgress = Math.round(newProgress * 100) / 100
          setDragging({ ...dragging, currentProgress: newProgress })
        }
      }

      if (linking) {
        setLinking({ ...linking, mouseX: e.clientX, mouseY: e.clientY })
      }
    },
    [dragging, linking, dayWidth, snapToGrid],
  )

  const handleMouseUp = useCallback((e?: React.MouseEvent) => {
    if (linking && e) {
      const target = e.target as HTMLElement
      const taskEl = target.closest('[data-task-id]') as HTMLElement | null
      if (taskEl) {
        const targetTaskId = taskEl.getAttribute('data-task-id')
        if (targetTaskId && targetTaskId !== linking.fromTaskId) {
          const targetTask = tasks.find(t => t.id === targetTaskId)
          if (targetTask) {
            setDepDialogTargetTask(targetTask)
            setDepDialogOpen(true)
          }
        }
      }
    }
    if (dragging) {
      const { taskId, type, currentStartDate, currentDueDate, startDate, dueDate, currentProgress } = dragging
      const hasChanged = currentStartDate !== startDate || currentDueDate !== dueDate
      if (type === 'progress' && currentProgress !== undefined) {
        onTaskUpdate?.(taskId, { progress: currentProgress })
      } else if (hasChanged) {
        if (type === 'move') {
          onTaskUpdate?.(taskId, { startDate: currentStartDate, dueDate: currentDueDate })
        } else if (type === 'resize-right') {
          onTaskUpdate?.(taskId, { dueDate: currentDueDate })
        } else if (type === 'resize-left') {
          onTaskUpdate?.(taskId, { startDate: currentStartDate })
        }
      }
    }
    setDragging(null)
    setLinking(null)
  }, [dragging, linking, onTaskUpdate, tasks])

  const handleLinkStart = useCallback((e: React.MouseEvent, taskId: string) => {
    e.stopPropagation()
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    setDepDialogSourceTask(task)
    setDepDialogTargetTask(null)
    setEditingDependency(null)
    setLinking({ fromTaskId: taskId, mouseX: e.clientX, mouseY: e.clientY })
  }, [tasks])

  // 处理依赖对话框保存
  const handleDependencySave = useCallback((type: 'fs' | 'ss' | 'ff' | 'sf', lagDays: number) => {
    if (depDialogSourceTask && depDialogTargetTask) {
      onAddDependency?.(depDialogTargetTask.id, depDialogSourceTask.id, type, lagDays)
    } else if (editingDependency && onUpdateDependency) {
      onUpdateDependency(editingDependency.id, type, lagDays)
    }
    setDepDialogOpen(false)
    setDepDialogSourceTask(null)
    setDepDialogTargetTask(null)
    setEditingDependency(null)
  }, [depDialogSourceTask, depDialogTargetTask, editingDependency, onAddDependency, onUpdateDependency])

  // 处理依赖对话框删除
  const handleDependencyDelete = useCallback(() => {
    if (editingDependency && onRemoveDependency) {
      onRemoveDependency(editingDependency.id)
    }
    setDepDialogOpen(false)
    setDepDialogSourceTask(null)
    setDepDialogTargetTask(null)
    setEditingDependency(null)
  }, [editingDependency, onRemoveDependency])

  // 处理依赖线双击编辑
  const handleDependencyDoubleClick = useCallback((dep: TaskDependency) => {
    const sourceTask = tasks.find(t => t.id === dep.dependsOnTaskId)
    const targetTask = tasks.find(t => t.id === dep.taskId)
    setDepDialogSourceTask(sourceTask || null)
    setDepDialogTargetTask(targetTask || null)
    setEditingDependency(dep)
    setDepDialogOpen(true)
  }, [tasks])

  const handleZoom = useCallback((dir: 'in' | 'out') => {
    const levels: ZoomLevel[] = ['day', 'week', 'month']
    setZoom((z) => {
      const idx = levels.indexOf(z)
      return levels[Math.max(0, Math.min(levels.length - 1, dir === 'in' ? idx - 1 : idx + 1))]
    })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); handleZoom('in') }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); handleZoom('out') }
      else if (e.key === 'Escape') { setLinking(null); setSelectedTaskId(null) }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); scrollToToday() }
      else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setGroupByAssignee((g) => !g) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleZoom, scrollToToday])

  const handleTimelineDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!onCreateTask) return
    const target = e.target as HTMLElement
    if (target.closest('[data-task-id]')) return
    const rect = scrollRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0)
    const dayIndex = Math.floor(x / dayWidth)
    const startDate = addDays(minDate, dayIndex)
    const dueDate = addDays(startDate, 1)
    onCreateTask({
      startDate: startDate.toISOString(),
      dueDate: dueDate.toISOString(),
    })
  }, [onCreateTask, dayWidth, minDate])

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    setShowCreateHint(!target.closest('[data-task-id]') && !dragging && !linking)
  }, [dragging, linking])

  const handleTimelineMouseLeave = useCallback(() => {
    setShowCreateHint(false)
  }, [])

  const filteredTasks = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase()
    return tasks.filter((t) => {
      if (filterAssignee !== 'all' && t.assigneeId !== filterAssignee) return false
      if (filterStatus !== 'all' && t.status !== filterStatus) return false
      if (filterLabel !== 'all' && !t.labels.includes(filterLabel)) return false
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, filterAssignee, filterStatus, filterLabel, debouncedSearchQuery])

  // #6 泳道分组
  type GroupedTask = { task: Task; visualIndex: number }
  type SwimlaneGroup = {
    assigneeId: string
    assigneeName: string
    tasks: GroupedTask[]
    isCollapsed: boolean
  }

  const swimlaneGroups = useMemo<SwimlaneGroup[]>(() => {
    if (!groupByAssignee) return []
    const groupsMap = new Map<string, { assigneeId: string; assigneeName: string; tasks: GroupedTask[] }>()
    filteredTasks.forEach((task, idx) => {
      const assigneeId = task.assigneeId || 'unassigned'
      const assigneeName = users.find((u) => u.id === assigneeId)?.name || '未分配'
      if (!groupsMap.has(assigneeId)) {
        groupsMap.set(assigneeId, { assigneeId, assigneeName, tasks: [] })
      }
      groupsMap.get(assigneeId)!.tasks.push({ task, visualIndex: idx })
    })
    const groups: SwimlaneGroup[] = []
    let visualIdx = 0
    groupsMap.forEach((g, key) => {
      const isCollapsed = collapsedGroups.has(key)
      const groupTasks: GroupedTask[] = isCollapsed ? [] : g.tasks.map((t) => ({ task: t.task, visualIndex: visualIdx++ }))
      groups.push({
        assigneeId: g.assigneeId,
        assigneeName: g.assigneeName,
        tasks: groupTasks,
        isCollapsed,
      })
      if (isCollapsed) {
        visualIdx++ // still count the group header
      }
    })
    return groups
  }, [groupByAssignee, filteredTasks, users, collapsedGroups])

  // Get task visual index accounting for group headers
  const getTaskVisualIndex = useCallback((taskId: string): number => {
    if (!groupByAssignee) {
      return filteredTasks.findIndex((t) => t.id === taskId)
    }
    for (const group of swimlaneGroups) {
      for (const gt of group.tasks) {
        if (gt.task.id === taskId) return gt.visualIndex
      }
    }
    return 0
  }, [groupByAssignee, filteredTasks, swimlaneGroups])

  // Calculate total height accounting for group headers
  const VIRTUAL_BUFFER = 3
  const totalGroupHeaders = groupByAssignee ? swimlaneGroups.length : 0
  const totalContentHeight = useMemo(() => {
    const taskCount = groupByAssignee
      ? swimlaneGroups.reduce((sum, g) => sum + g.tasks.length, 0)
      : filteredTasks.length
    return taskCount * ROW_HEIGHT + totalGroupHeaders * GROUP_HEADER_HEIGHT
  }, [groupByAssignee, swimlaneGroups, filteredTasks.length, totalGroupHeaders])

  // Get visible tasks accounting for grouping
  const visibleTasksWithOffset = useMemo(() => {
    if (!groupByAssignee) {
      const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_BUFFER)
      const endRow = Math.min(
        filteredTasks.length,
        Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + VIRTUAL_BUFFER,
      )
      const visibleSlice = filteredTasks.slice(startRow, endRow)
      const topPadding = startRow * ROW_HEIGHT
      const bottomPadding = (filteredTasks.length - endRow) * ROW_HEIGHT
      return { visibleSlice, topPadding, bottomPadding, startRow }
    }
    // With groups - calculate offset accounting for group headers
    const effectiveScrollTop = scrollTop
    const taskCount = swimlaneGroups.reduce((sum, g) => sum + g.tasks.length, 0)
    const startRow = Math.max(0, Math.floor(effectiveScrollTop / ROW_HEIGHT) - VIRTUAL_BUFFER)
    const endRow = Math.min(
      taskCount,
      Math.ceil((effectiveScrollTop + viewportHeight) / ROW_HEIGHT) + VIRTUAL_BUFFER,
    )
    // Flatten visible tasks
    const flatTasks: Task[] = []
    swimlaneGroups.forEach((g) => {
      g.tasks.forEach((gt) => flatTasks.push(gt.task))
    })
    const visibleSlice = flatTasks.slice(startRow, endRow)
    const topPadding = startRow * ROW_HEIGHT
    const bottomPadding = (taskCount - endRow) * ROW_HEIGHT
    return { visibleSlice, topPadding, bottomPadding, startRow }
  }, [groupByAssignee, swimlaneGroups, filteredTasks, scrollTop, viewportHeight, totalGroupHeaders])

  const toggleGroup = useCallback((assigneeId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(assigneeId)) {
        next.delete(assigneeId)
      } else {
        next.add(assigneeId)
      }
      return next
    })
  }, [])

  const allLabels = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach((t) => t.labels.forEach((l) => s.add(l)))
    return Array.from(s)
  }, [tasks])

  const taskPositions = useMemo(() => {
    const positions: Record<string, { left: number; width: number; hasDates: boolean }> = {}
    filteredTasks.forEach((task) => {
      const isDraggingThis = dragging?.taskId === task.id
      const effectiveStart = isDraggingThis && dragging
        ? dragging.currentStartDate
        : task.startDate
      const effectiveDue = isDraggingThis && dragging
        ? dragging.currentDueDate
        : task.dueDate
      const hasDates = !!(effectiveStart && effectiveDue)
      const start = effectiveStart ? new Date(effectiveStart) : new Date()
      const end = effectiveDue ? new Date(effectiveDue) : addDays(start, 7)
      const left = dateToX(start)
      const width = Math.max(dayWidth, dateToX(end) - left)
      positions[task.id] = { left, width, hasDates }
    })
    return positions
  }, [filteredTasks, dateToX, dayWidth, dragging])

  useEffect(() => {
    taskPositionsRef.current = taskPositions
  }, [taskPositions])

  const tasksWithoutDates = filteredTasks.filter((t) => !t.startDate || !t.dueDate)
  const overdueTasks = filteredTasks.filter((t) => isOverdue(t))

  // #5 关键路径计算
  const criticalPathIds = useMemo(() => {
    if (filteredTasks.length === 0) return new Set<string>()
    const taskMap = new Map<string, Task>()
    filteredTasks.forEach((t) => taskMap.set(t.id, t))
    const taskIndexMap = new Map<string, number>()
    filteredTasks.forEach((t, i) => taskIndexMap.set(t.id, i))

    const durations = new Map<string, number>()
    filteredTasks.forEach((t) => {
      if (t.startDate && t.dueDate) {
        durations.set(t.id, daysBetween(new Date(t.startDate), new Date(t.dueDate)))
      } else {
        durations.set(t.id, 1)
      }
    })

    const successors = new Map<string, string[]>()
    const predecessors = new Map<string, string[]>()
    filteredTasks.forEach((t) => {
      successors.set(t.id, [])
      predecessors.set(t.id, [])
    })
    dependencies.forEach((dep) => {
      if (taskMap.has(dep.taskId) && taskMap.has(dep.dependsOnTaskId)) {
        successors.get(dep.dependsOnTaskId)?.push(dep.taskId)
        predecessors.get(dep.taskId)?.push(dep.dependsOnTaskId)
      }
    })

    const sorted: string[] = []
    const visited = new Set<string>()
    function dfs(node: string) {
      if (visited.has(node)) return
      visited.add(node)
      successors.get(node)?.forEach((s) => dfs(s))
      sorted.unshift(node)
    }
    filteredTasks.forEach((t) => dfs(t.id))

    const earliest = new Map<string, number>()
    sorted.forEach((id) => {
      const predList = predecessors.get(id) || []
      const maxPredEnd = predList.reduce((max, pid) => {
        const predDur = durations.get(pid) || 0
        const predStart = earliest.get(pid) || 0
        return Math.max(max, predStart + predDur)
      }, 0)
      earliest.set(id, maxPredEnd)
    })

    const maxDuration = sorted.reduce((max, id) => {
      const start = earliest.get(id) || 0
      const dur = durations.get(id) || 0
      return Math.max(max, start + dur)
    }, 0)

    const latest = new Map<string, number>()
    for (let i = sorted.length - 1; i >= 0; i--) {
      const id = sorted[i]
      const succList = successors.get(id) || []
      const minSuccStart = succList.reduce((min, sid) => {
        const succLatest = latest.get(sid) ?? maxDuration
        return Math.min(min, succLatest)
      }, maxDuration)
      const dur = durations.get(id) || 0
      latest.set(id, minSuccStart - dur)
    }

    const critical = new Set<string>()
    filteredTasks.forEach((t) => {
      const es = earliest.get(t.id) || 0
      const ls = latest.get(t.id) || 0
      if (Math.abs(es - ls) < 0.01) {
        critical.add(t.id)
      }
    })

    return critical
  }, [filteredTasks, dependencies])

  const gridLines = useMemo(() => {
    const lines: { x: number; label: string; isToday: boolean; isWeekend: boolean; weekNum?: number }[] = []
    const today = new Date()
    for (let i = 0; i <= totalDays; i++) {
      const date = addDays(minDate, i)
      const x = i * dayWidth
      let label = ''
      let isToday = false
      const isWeekend = date.getDay() === 0 || date.getDay() === 6

      if (zoom === 'day') {
        isToday = sameDay(date, today)
        label = isToday ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`
      } else if (zoom === 'week') {
        if (date.getDay() === 1) {
          const wn = getWeekNumber(date)
          label = `W${wn}`
        }
        isToday = sameDay(date, today)
      } else {
        if (date.getDate() === 1) {
          label = `${date.getMonth() + 1}月`
        }
        isToday = date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()
      }

      if (label || isToday || isWeekend) {
        lines.push({ x, label, isToday, isWeekend })
      }
    }
    return lines
  }, [minDate, totalDays, dayWidth, zoom])

  const quarterHeaders = useMemo(() => {
    const quarters: { label: string; width: number }[] = []
    let currentQuarter = getQuarter(minDate)
    let currentWidth = 0
    for (let i = 0; i <= totalDays; i++) {
      const date = addDays(minDate, i)
      const q = getQuarter(date)
      if (q !== currentQuarter) {
        quarters.push({ label: currentQuarter, width: currentWidth })
        currentQuarter = q
        currentWidth = dayWidth
      } else {
        currentWidth += dayWidth
      }
    }
    if (currentWidth > 0) {
      quarters.push({ label: currentQuarter, width: currentWidth })
    }
    return quarters
  }, [minDate, totalDays, dayWidth])

  const monthHeaders = useMemo(() => {
    const months: { label: string; width: number }[] = []
    let currentMonth = minDate.getMonth()
    let currentYear = minDate.getFullYear()
    let currentWidth = 0

    for (let i = 0; i <= totalDays; i++) {
      const date = addDays(minDate, i)
      if (date.getMonth() !== currentMonth || date.getFullYear() !== currentYear) {
        months.push({ label: `${currentYear}年${currentMonth + 1}月`, width: currentWidth })
        currentMonth = date.getMonth()
        currentYear = date.getFullYear()
        currentWidth = dayWidth
      } else {
        currentWidth += dayWidth
      }
    }
    if (currentWidth > 0) {
      months.push({ label: `${currentYear}年${currentMonth + 1}月`, width: currentWidth })
    }
    return months
  }, [minDate, totalDays, dayWidth])

  const totalWidth = totalDays * dayWidth + 100

  const { topPadding, bottomPadding } = visibleTasksWithOffset

  const isMilestone = (task: Task) => {
    if (task.milestone) return true
    if (!task.startDate || !task.dueDate) return false
    return sameDay(new Date(task.startDate), new Date(task.dueDate))
  }

  return (
    <div className="flex flex-col h-full bg-bg rounded-lg overflow-hidden border border-bg-border">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-bg-border bg-bg-soft">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => scrollByDays(-7)} className="p-1 rounded hover:bg-bg-border transition-colors">
            <ChevronLeft className="w-4 h-4 text-muted" />
          </button>
          <button onClick={() => scrollByDays(7)} className="p-1 rounded hover:bg-bg-border transition-colors">
            <ChevronRight className="w-4 h-4 text-muted" />
          </button>
          <button onClick={scrollToToday} className="px-2 py-1 text-xs text-muted hover:text-text-primary transition-colors">
            回到今天
          </button>
          <div className="relative ml-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索任务..."
              className="w-36 bg-bg-soft border border-bg-border rounded px-2 py-1 text-xs text-text-primary placeholder-muted focus:outline-none focus:border-brand transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text-primary"
              >
                ✕
              </button>
            )}
          </div>
          {onCreateTask && (
            <span className="ml-2 text-[11px] text-muted flex items-center gap-1">
              <Plus className="w-3 h-3" /> 双击时间轴创建任务
            </span>
          )}
          {tasksWithoutDates.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-400 flex items-center gap-1">
              {tasksWithoutDates.length} 个任务未设置时间
            </span>
          )}
          {overdueTasks.length > 0 && (
            <span className="ml-2 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] text-red-400 flex items-center gap-1 animate-pulse">
              <AlertTriangle className="w-3 h-3" /> {overdueTasks.length} 个任务逾期
            </span>
          )}

          {/* #6 泳道分组开关 */}
          <button
            onClick={() => { setGroupByAssignee(!groupByAssignee); setCollapsedGroups(new Set()) }}
            className={`ml-2 p-1.5 rounded transition-colors ${groupByAssignee ? 'bg-brand/30 text-brand' : 'hover:bg-bg-border text-muted'}`}
            title="按负责人分组"
          >
            <Users className="w-4 h-4" />
          </button>

          {/* #4 筛选器 */}
          <div className="ml-2 relative">
            <button
              onClick={() => setShowFilter(!showFilter)}
              className={`p-1.5 rounded transition-colors ${showFilter ? 'bg-brand/30 text-brand' : 'hover:bg-bg-border text-muted'}`}
              title="筛选"
            >
              <Filter className="w-4 h-4" />
            </button>
            {showFilter && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-bg-panel border border-bg-border rounded-lg shadow-xl p-3 w-64 space-y-3">
                <div>
                  <label className="text-[10px] text-muted block mb-1">负责人</label>
                  <select
                    value={filterAssignee}
                    onChange={(e) => setFilterAssignee(e.target.value)}
                    className="w-full bg-bg-soft border border-bg-border rounded px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="all">全部负责人</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted block mb-1">状态</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as TaskStatus | 'all')}
                    className="w-full bg-bg-soft border border-bg-border rounded px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="all">全部状态</option>
                    <option value="todo">待办</option>
                    <option value="in_progress">进行中</option>
                    <option value="review">审核中</option>
                    <option value="done">已完成</option>
                  </select>
                </div>
                {allLabels.length > 0 && (
                  <div>
                    <label className="text-[10px] text-muted block mb-1">标签</label>
                    <select
                      value={filterLabel}
                      onChange={(e) => setFilterLabel(e.target.value)}
                      className="w-full bg-bg-soft border border-bg-border rounded px-2 py-1 text-xs text-text-primary"
                    >
                      <option value="all">全部标签</option>
                      {allLabels.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => { setFilterAssignee('all'); setFilterStatus('all'); setFilterLabel('all') }}
                  className="w-full text-xs text-brand hover:text-brand-soft pt-1 border-t border-bg-border"
                >
                  清除筛选
                </button>
              </div>
            )}
          </div>

          {(filterAssignee !== 'all' || filterStatus !== 'all' || filterLabel !== 'all') && (
            <span className="text-[10px] text-brand-soft bg-brand/10 px-2 py-0.5 rounded-full">
              已筛选 {filteredTasks.length}/{tasks.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleZoom('out')} className="p-1 rounded hover:bg-bg-border transition-colors">
            <ZoomOut className="w-4 h-4 text-muted" />
          </button>
          <span className="text-xs text-muted w-12 text-center">
            {zoom === 'day' ? '日' : zoom === 'week' ? '周' : '月'}
          </span>
          <button onClick={() => handleZoom('in')} className="p-1 rounded hover:bg-bg-border transition-colors">
            <ZoomIn className="w-4 h-4 text-muted" />
          </button>
        </div>
      </div>

      {/* 甘特图主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧固定任务列 */}
        <div
          className="flex flex-col flex-shrink-0 border-r border-bg-border bg-bg-soft"
          style={{ width: LEFT_COL_WIDTH, minWidth: LEFT_COL_WIDTH }}
        >
          {/* 左表头 - 固定 */}
          <div
            className="border-b border-bg-border bg-bg-soft flex items-center px-3 text-xs text-muted font-semibold flex-shrink-0"
            style={{ height: HEADER_HEIGHT }}
          >
            任务名称
          </div>
          {/* 左任务列表 - 通过 transform 跟随右侧滚动 + 虚拟滚动 */}
          <div className="flex-1 overflow-hidden" style={{ position: 'relative' }}>
            <div
              style={{
                height: totalContentHeight,
                transform: `translateY(${-scrollTop}px)`,
                willChange: 'transform',
              }}
            >
              {topPadding > 0 && (
                <div style={{ height: topPadding }} />
              )}
              {groupByAssignee ? (
                // Swimlane grouping mode
                swimlaneGroups.map((group) => (
                  <div key={group.assigneeId}>
                    {/* Group Header */}
                    <div
                      className="flex items-center px-3 py-1.5 bg-brand/10 border-b border-bg-border cursor-pointer hover:bg-brand/20 transition-colors"
                      style={{ height: GROUP_HEADER_HEIGHT }}
                      onClick={() => toggleGroup(group.assigneeId)}
                    >
                      <ChevronDown
                        className={`w-3 h-3 text-muted mr-1 transition-transform ${group.isCollapsed ? '-rotate-90' : ''}`}
                      />
                      <Users className="w-3 h-3 text-brand mr-1" />
                      <span className="text-xs text-brand font-semibold">{group.assigneeName}</span>
                      <span className="text-[10px] text-muted ml-2">({group.tasks.length})</span>
                    </div>
                    {/* Group Tasks */}
                    {!group.isCollapsed && group.tasks.map((gt) => {
                      const task = gt.task
                      const overdue = isOverdue(task)
                      return (
                        <div
                          key={task.id}
                          className={`flex items-center px-3 border-b border-bg-border cursor-pointer transition-colors ${
                            selectedTaskId === task.id ? 'bg-brand/20' : 'hover:bg-bg-hover'
                          } ${overdue ? 'border-l-2 border-l-red-500' : ''}`}
                          style={{ height: ROW_HEIGHT, paddingLeft: 24 }}
                          onClick={() => { setSelectedTaskId(task.id); onTaskClick?.(task) }}
                        >
                          {isMilestone(task) ? (
                            <Diamond className="w-3 h-3 text-purple-400 mr-2 flex-shrink-0" />
                          ) : (
                            <div className={`w-2 h-2 rounded-full ${STATUS_META[task.status].tailwind} mr-2 flex-shrink-0`} />
                          )}
                          <span className={`text-sm truncate flex-1 ${overdue ? 'text-red-300' : 'text-text-primary'}`}>{task.title}</span>
                          {overdue && (
                            <span className="text-red-400 ml-1 flex-shrink-0" aria-label="已逾期">
                              <AlertTriangle className="w-3 h-3" />
                            </span>
                          )}
                          {(!task.startDate || !task.dueDate) && (
                            <span className="text-[10px] text-amber-400 ml-1 flex-shrink-0" title="未设置时间">⚠</span>
                          )}
                          {isMilestone(task) && (
                            <span className="text-[10px] text-purple-400 ml-1 flex-shrink-0">里程碑</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))
              ) : (
                // Normal mode
                visibleTasksWithOffset.visibleSlice.map((task) => {
                const overdue = isOverdue(task)
                return (
                <div
                  key={task.id}
                  className={`flex items-center px-3 border-b border-bg-border cursor-pointer transition-colors ${
                    selectedTaskId === task.id ? 'bg-brand/20' : 'hover:bg-bg-hover'
                  } ${overdue ? 'border-l-2 border-l-red-500' : ''}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => { setSelectedTaskId(task.id); onTaskClick?.(task) }}
                >
                  {isMilestone(task) ? (
                    <Diamond className="w-3 h-3 text-purple-400 mr-2 flex-shrink-0" />
                  ) : (
                    <div className={`w-2 h-2 rounded-full ${STATUS_META[task.status].tailwind} mr-2 flex-shrink-0`} />
                  )}
                  <span className={`text-sm truncate flex-1 ${overdue ? 'text-red-300' : 'text-text-primary'}`}>{task.title}</span>
                  {overdue && (
                    <span className="text-red-400 ml-1 flex-shrink-0" aria-label="已逾期">
                      <AlertTriangle className="w-3 h-3" />
                    </span>
                  )}
                  {(!task.startDate || !task.dueDate) && (
                    <span className="text-[10px] text-amber-400 ml-1 flex-shrink-0" title="未设置时间">⚠</span>
                  )}
                  {isMilestone(task) && (
                    <span className="text-[10px] text-purple-400 ml-1 flex-shrink-0">里程碑</span>
                  )}
                </div>
                )})
              )}
              {bottomPadding > 0 && (
                <div style={{ height: bottomPadding }} />
              )}
            </div>
          </div>
        </div>

        {/* 右侧时间轴 - 唯一滚动容器 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto [touch-action:pan-y]"
          onScroll={handleScroll}
          onMouseMove={(e) => { handleMouseMove(e); handleTimelineMouseMove(e) }}
          onMouseUp={(e) => handleMouseUp(e)}
          onMouseLeave={(e) => { handleMouseUp(e); handleTimelineMouseLeave() }}
          onDoubleClick={handleTimelineDoubleClick}
        >
          <div ref={timelineRef} style={{ width: totalWidth, height: totalContentHeight + HEADER_HEIGHT }}>
            {/* 固定表头 - sticky */}
            <div
              className="sticky top-0 z-20 flex flex-col bg-bg"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* 季度表头 #7 */}
              <div className="h-7 flex border-b border-bg-border bg-gradient-to-b from-brand/10 to-transparent">
                {quarterHeaders.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center text-[10px] text-brand-soft font-semibold border-r border-bg-border/50"
                    style={{ width: q.width }}
                  >
                    {q.label}
                  </div>
                ))}
              </div>
              {/* 月份表头 */}
              <div className="h-7 flex border-b border-bg-border bg-bg-soft">
                {monthHeaders.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center text-xs text-muted border-r border-bg-border"
                    style={{ width: m.width }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {/* 日期表头 */}
              <div className="h-7 flex border-b border-bg-border bg-bg">
                {gridLines.map((line, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-center text-xs border-r border-bg-border font-semibold ${
                      line.isToday ? 'bg-red-500 text-text-primary' : line.isWeekend ? 'bg-bg-soft text-muted' : 'text-muted'
                    }`}
                    style={{ width: dayWidth }}
                  >
                    {line.label}
                  </div>
                ))}
              </div>
            </div>

            {/* 时间轴主体 - 正常流，提供定位上下文 */}
            <div style={{ position: 'relative', height: totalContentHeight, width: totalWidth }}>
              {/* 网格线 */}
              {gridLines.map((line, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 ${
                    line.isToday ? 'bg-red-500/10' : line.isWeekend ? 'bg-bg-soft' : ''
                  }`}
                  style={{ left: line.x, width: dayWidth }}
                />
              ))}

              {/* 今天指示线 */}
              {gridLines.filter((l) => l.isToday).map((line, i) => (
                <div
                  key={`today-line-${i}`}
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{ left: line.x + dayWidth - 1, width: 2 }}
                >
                  <div className="h-full w-0.5 border-l-2 border-dashed border-red-500" />
                </div>
              ))}

              {/* 任务条 - 虚拟滚动 */}
              {topPadding > 0 && <div style={{ height: topPadding }} />}
              {(groupByAssignee
                ? swimlaneGroups.flatMap((g) => g.tasks.map((gt) => gt.task))
                : visibleTasksWithOffset.visibleSlice
              ).map((task, idx) => {
                const index = groupByAssignee
                  ? getTaskVisualIndex(task.id)
                  : visibleTasksWithOffset.startRow + idx
                const pos = taskPositions[task.id]
                if (!pos) return null
                const overdue = isOverdue(task)
                const isCritical = criticalPathIds.has(task.id)
                const baseProgress = task.progress ?? (task.status === 'done' ? 1 : task.status === 'in_progress' ? 0.5 : 0)
                const progress = dragging?.taskId === task.id && dragging?.type === 'progress'
                  ? (dragging.currentProgress ?? baseProgress)
                  : baseProgress
                const showLabel = pos.width > 60
                const isDraggingThis = dragging?.taskId === task.id
                const hasDates = pos.hasDates
                const milestone = isMilestone(task)
                // Calculate top position accounting for swimlane group headers
                const top = groupByAssignee
                  ? (() => {
                      let topPos = 0
                      for (const group of swimlaneGroups) {
                        const taskIdxInGroup = group.tasks.findIndex((gt) => gt.task.id === task.id)
                        if (taskIdxInGroup !== -1) {
                          topPos += GROUP_HEADER_HEIGHT + taskIdxInGroup * ROW_HEIGHT
                          break
                        }
                        topPos += GROUP_HEADER_HEIGHT + group.tasks.length * ROW_HEIGHT
                      }
                      return topPos
                    })()
                  : index * ROW_HEIGHT

                return (
                  <div
                    key={task.id}
                    data-task-id={task.id}
                    className={`absolute group transition-all ${isDraggingThis ? 'z-30' : ''}`}
                    style={{
                      left: pos.left,
                      width: pos.width,
                      top,
                      height: 32,
                      cursor: isDraggingThis ? 'grabbing' : undefined,
                    }}
                  >
                    {/* 里程碑：菱形标记 */}
                    {milestone ? (
                      <>
                        <div className="flex items-center justify-center h-full">
                          <div
                            className={`w-5 h-5 rotate-45 bg-purple-500 shadow-lg ${isDraggingThis ? 'ring-2 ring-white' : ''} ${overdue ? 'animate-pulse' : ''} ${isCritical ? 'ring-2 ring-amber-400' : ''}`}
                            onMouseDown={(e) => handleMouseDown(e, task, 'move')}
                          />
                        </div>
                        {showLabel && (
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 text-xs text-purple-300 font-medium truncate pointer-events-none whitespace-nowrap">
                            {task.title}
                          </span>
                        )}
                        {!showLabel && (
                          <div className="absolute left-0 -top-8 hidden group-hover:block bg-bg-panel text-text-primary text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-30 pointer-events-none">
                            ◆ {task.title}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div
                          className="absolute left-0 top-0 bottom-0 w-5 md:w-2 cursor-col-resize opacity-60 md:opacity-0 md:group-hover:opacity-100 bg-text-primary/20 hover:bg-text-primary/40 transition-opacity z-10"
                          onMouseDown={(e) => handleMouseDown(e, task, 'resize-left')}
                        />
                        <div
                          className={`w-full h-full mx-1 rounded-md ${STATUS_META[task.status].tailwind} cursor-move shadow-sm overflow-hidden relative flex items-center transition-all ${
                            !hasDates ? 'opacity-50 border-2 border-dashed border-text-primary/30' : ''
                          } ${isDraggingThis ? 'ring-2 ring-white shadow-lg' : ''} ${overdue ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-transparent animate-pulse' : ''} ${isCritical ? 'shadow-[0_0_8px_rgba(245,158,11,0.5)]' : ''}`}
                          onMouseDown={(e) => handleMouseDown(e, task, 'move')}
                        >
                          {/* 移动端拖拽手柄 grip */}
                          <div
                            className="absolute left-1 top-1/2 -translate-y-1/2 w-4 h-6 rounded bg-text-primary/30 flex flex-col justify-center items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10 shrink-0"
                            onMouseDown={(e) => handleMouseDown(e, task, 'move')}
                            title="拖拽移动"
                          >
                            <div className="w-2 h-0.5 rounded-full bg-text-primary/80" />
                            <div className="w-2 h-0.5 rounded-full bg-text-primary/80" />
                            <div className="w-2 h-0.5 rounded-full bg-text-primary/80" />
                          </div>
                          {/* #2 进度拖拽手柄 */}
                          <div
                            className="absolute top-0 bottom-0 w-4 md:w-1.5 cursor-col-resize opacity-80 md:opacity-0 md:group-hover:opacity-100 bg-text-primary/60 hover:bg-text-primary transition-opacity z-10 rounded-sm"
                            style={{ left: `${progress * 100}%`, transform: 'translateX(-50%)' }}
                            onMouseDown={(e) => handleMouseDown(e, task, 'progress')}
                            title="拖拽调整进度"
                          />
                          <div className="h-full bg-text-primary/30 transition-all" style={{ width: `${progress * 100}%` }} />
                          {showLabel && (
                            <span className="absolute inset-0 flex items-center pl-7 md:px-2 text-xs text-text-primary font-medium truncate pointer-events-none">
                              {task.title}
                              {isCritical && <span className="ml-1 text-[9px] text-amber-200 bg-amber-600/40 px-1 rounded">关键</span>}
                            </span>
                          )}
                          {!hasDates && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-text-primary/70 pointer-events-none">
                              ⚠
                            </span>
                          )}
                          {overdue && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-red-200 pointer-events-none animate-pulse">
                              ⏰
                            </span>
                          )}
                          {isCritical && !overdue && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-amber-200 pointer-events-none">
                              ★
                            </span>
                          )}
                          <div
                            className="absolute right-0 top-1/2 -translate-y-1/2 w-6 h-6 md:w-4 md:h-4 rounded-full bg-text-primary/80 opacity-80 md:opacity-0 md:group-hover:opacity-100 cursor-crosshair flex items-center justify-center hover:bg-text-primary transition-all shadow"
                            onMouseDown={(e) => handleLinkStart(e, task.id)}
                          >
                            <Link className="w-3.5 h-3.5 md:w-2.5 md:h-2.5 text-gray-600" />
                          </div>
                        </div>
                        <div
                          className="absolute right-0 top-0 bottom-0 w-5 md:w-2 cursor-col-resize opacity-60 md:opacity-0 md:group-hover:opacity-100 bg-text-primary/20 hover:bg-text-primary/40 transition-opacity z-10"
                          onMouseDown={(e) => handleMouseDown(e, task, 'resize-right')}
                        />
                        <div className="absolute left-0 -top-8 hidden group-hover:block bg-bg-panel text-text-primary text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-30 pointer-events-none">
                          {!hasDates && '⚠ 请设置时间: '}{task.title}
                          {overdue && ' · 已逾期'}
                          {isCritical && ' · 关键路径'}
                          {progress > 0 && ` · ${Math.round(progress * 100)}%`}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
              {bottomPadding > 0 && <div style={{ height: bottomPadding }} />}

              {/* 依赖关系线 */}
              <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                <defs>
                  <clipPath id="dep-clip">
                    <rect x="0" y={Math.max(0, scrollTop - HEADER_HEIGHT)} width="100%" height={viewportHeight + ROW_HEIGHT * 2} />
                  </clipPath>
                  {/* FS - 完成-开始 (蓝色) */}
                  <marker id="arrowhead-fs" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L12,4 L0,8 L3,4 Z" fill="#3b82f6" stroke="#2563eb" strokeWidth="0.5" />
                  </marker>
                  {/* SS - 开始-开始 (绿色) */}
                  <marker id="arrowhead-ss" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L12,4 L0,8 L3,4 Z" fill="#22c55e" stroke="#16a34a" strokeWidth="0.5" />
                  </marker>
                  {/* FF - 完成-完成 (橙色) */}
                  <marker id="arrowhead-ff" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L12,4 L0,8 L3,4 Z" fill="#f97316" stroke="#ea580c" strokeWidth="0.5" />
                  </marker>
                  {/* SF - 开始-完成 (红色) */}
                  <marker id="arrowhead-sf" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L12,4 L0,8 L3,4 Z" fill="#ef4444" stroke="#dc2626" strokeWidth="0.5" />
                  </marker>
                  {/* 关键路径箭头 (琥珀色) */}
                  <marker id="arrowhead-active" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L12,4 L0,8 L3,4 Z" fill="#f59e0b" stroke="#D97706" strokeWidth="0.5" />
                  </marker>
                </defs>
                <g clipPath="url(#dep-clip)" className="pointer-events-auto">
                {/* Helper to get Y position accounting for swimlane */}
                {(() => {
                  const getTaskY = (taskId: string): number => {
                    if (!groupByAssignee) {
                      const idx = filteredTasks.findIndex((t) => t.id === taskId)
                      return idx * ROW_HEIGHT + 24
                    }
                    let yPos = 24
                    for (const group of swimlaneGroups) {
                      const taskIdxInGroup = group.tasks.findIndex((gt) => gt.task.id === taskId)
                      if (taskIdxInGroup !== -1) {
                        yPos += GROUP_HEADER_HEIGHT + taskIdxInGroup * ROW_HEIGHT
                        return yPos
                      }
                      yPos += GROUP_HEADER_HEIGHT + group.tasks.length * ROW_HEIGHT
                    }
                    return 24
                  }

                  return dependencies.map((dep) => {
                    const fromTask = filteredTasks.find((t) => t.id === dep.dependsOnTaskId)
                    const toTask = filteredTasks.find((t) => t.id === dep.taskId)
                    if (!fromTask || !toTask) return null
                    const fromPos = taskPositions[fromTask.id]
                    const toPos = taskPositions[toTask.id]
                    if (!fromPos || !toPos) return null
                    const fromY = getTaskY(fromTask.id)
                    const toY = getTaskY(toTask.id)
                  const fromX = fromPos.left + fromPos.width
                  const toX = toPos.left
                  const dx = Math.abs(toX - fromX) * 0.5
                  const cp1x = fromX + dx
                  const cp2x = toX - dx
                  const path = `M ${fromX} ${fromY} C ${cp1x} ${fromY}, ${cp2x} ${toY}, ${toX} ${toY}`

                  // 根据依赖类型确定颜色
                  const depTypeColors: Record<string, string> = {
                    fs: '#3b82f6', // 蓝色 - 完成-开始
                    ss: '#22c55e', // 绿色 - 开始-开始
                    ff: '#f97316', // 橙色 - 完成-完成
                    sf: '#ef4444', // 红色 - 开始-完成
                  }

                  const isCriticalDep = criticalPathIds.has(dep.dependsOnTaskId) && criticalPathIds.has(dep.taskId)
                  const lineColor = isCriticalDep ? '#f59e0b' : depTypeColors[dep.type] || '#6366f1'
                  const strokeW = isCriticalDep ? 3 : 2

                  // 计算标签位置（在曲线中点）
                  const midX = (fromX + toX) / 2
                  const midY = (fromY + toY) / 2

                  return (
                    <g key={dep.id} className="pointer-events-auto">
                      {/* hit area */}
                      <path
                        d={path}
                        stroke="transparent"
                        strokeWidth="10"
                        fill="none"
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          handleDependencyDoubleClick(dep)
                        }}
                        className="cursor-pointer"
                      />
                      <path
                        d={path}
                        stroke={lineColor}
                        strokeWidth={strokeW}
                        fill="none"
                        markerEnd={`url(#arrowhead-${dep.type})`}
                        className="hover:stroke-opacity-80 transition-colors"
                        strokeDasharray={dep.type !== 'fs' ? '4,4' : undefined}
                        style={isCriticalDep ? { filter: 'drop-shadow(0 0 4px rgba(245,158,11,0.6))' } : undefined}
                      />
                      {/* 依赖类型标签 */}
                      <g transform={`translate(${midX}, ${midY})`}>
                        <rect
                          x="-12"
                          y="-8"
                          width="24"
                          height="16"
                          rx="3"
                          fill={lineColor}
                          opacity="0.9"
                        />
                        <text
                          x="0"
                          y="0"
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="white"
                          fontSize="10"
                          fontWeight="600"
                          style={{ pointerEvents: 'none' }}
                        >
                          {dep.type.toUpperCase()}
                        </text>
                        {/* 延迟天数标注 */}
                        {dep.lagDays !== 0 && (
                          <text
                            x="16"
                            y="0"
                            textAnchor="start"
                            dominantBaseline="central"
                            fill={lineColor}
                            fontSize="9"
                            fontWeight="500"
                            style={{ pointerEvents: 'none' }}
                          >
                            {dep.lagDays > 0 ? `+${dep.lagDays}` : dep.lagDays}天
                          </text>
                        )}
                      </g>
                    </g>
                  )
                })}
                )()}
                </g>

                {linking && (() => {
                  const fromTask = filteredTasks.find((t) => t.id === linking.fromTaskId)
                  if (!fromTask) return null
                  const fromPos = taskPositions[fromTask.id]
                  if (!fromPos) return null
                  let fromY = 24
                  if (!groupByAssignee) {
                    fromY = filteredTasks.findIndex((t) => t.id === fromTask.id) * ROW_HEIGHT + 24
                  } else {
                    let yPos = 24
                    for (const group of swimlaneGroups) {
                      const taskIdxInGroup = group.tasks.findIndex((gt) => gt.task.id === fromTask.id)
                      if (taskIdxInGroup !== -1) {
                        yPos += GROUP_HEADER_HEIGHT + taskIdxInGroup * ROW_HEIGHT
                        fromY = yPos
                        break
                      }
                      yPos += GROUP_HEADER_HEIGHT + group.tasks.length * ROW_HEIGHT
                    }
                  }
                  const rightRect = scrollRef.current?.getBoundingClientRect()
                  const scrollLeft = scrollRef.current?.scrollLeft || 0
                  const scrollTopVal = scrollRef.current?.scrollTop || 0
                  const mouseX = linking.mouseX - (rightRect?.left || 0) + scrollLeft
                  const mouseY = linking.mouseY - (rightRect?.top || 0) + scrollTopVal - HEADER_HEIGHT
                  const dx = Math.abs(mouseX - fromPos.left) * 0.3
                  const cp1x = fromPos.left + fromPos.width + dx
                  const cp2x = mouseX - dx
                  const path = `M ${fromPos.left + fromPos.width} ${fromY} C ${cp1x} ${fromY}, ${cp2x} ${mouseY}, ${mouseX} ${mouseY}`
                  return (
                    <path
                      d={path}
                      stroke="#6366f1"
                      strokeWidth="2"
                      fill="none"
                      strokeDasharray="5,5"
                      className="animate-pulse"
                    />
                  )
                })()}
              </svg>
            </div>
          </div>

          {/* 链接完成指示器 */}
          {linking && (
            <div
              className="fixed w-6 h-6 rounded-full bg-brand/20 border-2 border-brand pointer-events-none z-50"
              style={{ left: linking.mouseX - 12, top: linking.mouseY - 12 }}
            />
          )}

          {/* 双击创建提示 */}
          {showCreateHint && onCreateTask && !dragging && (
            <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-bg-panel text-text-primary text-xs px-3 py-1.5 rounded-lg shadow-lg z-50 pointer-events-none flex items-center gap-1.5 border border-bg-border">
              <Plus className="w-3 h-3 text-emerald-400" />
              <span>双击空白处创建任务</span>
            </div>
          )}
        </div>
      </div>

      {/* 图例 */}
      <div className="flex items-center justify-center gap-6 px-4 py-2 border-t border-bg-border bg-bg-soft">
        {(['todo', 'in_progress', 'review', 'done'] as TaskStatus[]).map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${STATUS_META[status].tailwind}`} />
            <span className="text-xs text-muted">{STATUS_META[status].label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <Diamond className="w-3 h-3 text-purple-400" />
          <span className="text-xs text-muted">里程碑</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500 animate-pulse" />
          <span className="text-xs text-muted">逾期</span>
        </div>
        <div className="flex items-center gap-1.5 border-l border-bg-border pl-3 ml-3">
          <Link className="w-3 h-3 text-brand" />
          <span className="text-xs text-muted">拖拽连接建立依赖</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-gradient-to-r from-text-primary/30 to-text-primary/60" />
          <span className="text-xs text-muted">拖拽白色手柄调整进度</span>
        </div>
        {onCreateTask && (
          <div className="flex items-center gap-1.5">
            <Plus className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-muted">双击空白创建</span>
          </div>
        )}
      </div>

      {/* 依赖类型图例 */}
      {dependencies.length > 0 && (
        <div className="flex items-center justify-center gap-4 px-4 py-1.5 border-t border-bg-border bg-bg-soft/50">
          <span className="text-[10px] text-muted">依赖类型：</span>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-[10px] text-muted">FS 完成-开始</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-muted">SS 开始-开始</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
            <span className="text-[10px] text-muted">FF 完成-完成</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-[10px] text-muted">SF 开始-完成</span>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] text-muted">· 双击依赖线编辑</span>
          </div>
        </div>
      )}

      {/* 依赖关系对话框 */}
      <DependencyDialog
        isOpen={depDialogOpen}
        onClose={() => {
          setDepDialogOpen(false)
          setDepDialogSourceTask(null)
          setDepDialogTargetTask(null)
          setEditingDependency(null)
        }}
        sourceTask={depDialogSourceTask}
        targetTask={depDialogTargetTask}
        dependency={editingDependency}
        onSave={handleDependencySave}
        onDelete={handleDependencyDelete}
      />
    </div>
  )
}

function startOfWeek(date: Date): Date {
  const d = new Date(date); d.setDate(d.getDate() - d.getDay() + 1); d.setHours(0, 0, 0, 0); return d
}
function endOfWeek(date: Date): Date {
  const d = startOfWeek(date); d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d
}
function endOfMonth(date: Date): Date {
  const d = new Date(date); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(0); d.setHours(23, 59, 59, 999); return d
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}
function daysBetween(start: Date, end: Date): number {
  const s = new Date(start); s.setHours(0, 0, 0, 0)
  const e = new Date(end); e.setHours(0, 0, 0, 0)
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000))
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
