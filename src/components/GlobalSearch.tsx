// 全局搜索组件

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useDebounce } from '@/hooks/useDebounce'
import { StatusBadge, PriorityBadge } from '@/components/ui'
import type { Task, Project } from '../../shared/types'

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const debouncedKeyword = useDebounce(keyword, 300)

  // 键盘快捷键 Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // 自动聚焦输入框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setKeyword('')
      setTasks([])
      setProjects([])
      setSelectedIndex(-1)
    }
  }, [open])

  // 搜索
  useEffect(() => {
    if (!debouncedKeyword.trim() || debouncedKeyword.trim().length < 2) {
      setTasks([])
      setProjects([])
      return
    }
    const search = async () => {
      setLoading(true)
      try {
        const result = await api.globalSearch(debouncedKeyword.trim())
        setTasks(result.tasks)
        setProjects(result.projects)
        setSelectedIndex(-1)
      } catch (error) {
        console.error('搜索失败:', error)
      } finally {
        setLoading(false)
      }
    }
    search()
  }, [debouncedKeyword])

  // 键盘导航
  const handleSelectTask = useCallback((task: Task) => {
    setOpen(false)
    navigate(`/projects/${task.projectId}?taskId=${task.id}`)
  }, [navigate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const total = tasks.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev < total - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
    } else if (e.key === 'Enter' && selectedIndex >= 0 && tasks[selectedIndex]) {
      e.preventDefault()
      handleSelectTask(tasks[selectedIndex])
    }
  }, [tasks, selectedIndex, handleSelectTask])

  const getProjectName = (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    return project?.name || ''
  }

  return (
    <>
      {/* 搜索按钮 */}
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg p-2 text-muted hover:bg-bg-soft hover:text-text-primary transition-colors"
        title="全局搜索 (⌘K)"
      >
        <Search className="h-5 w-5" />
      </button>

      {/* 搜索对话框 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          {/* 背景遮罩 */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* 对话框 */}
          <div className="relative w-full max-w-2xl rounded-2xl border border-bg-border bg-bg-panel shadow-2xl">
            {/* 搜索输入框 */}
            <div className="flex items-center gap-3 border-b border-bg-border px-4 py-3">
              <Search className="h-5 w-5 text-muted flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="搜索任务（标题、描述、标签）..."
                className="flex-1 bg-transparent text-text-primary placeholder:text-muted outline-none"
                autoComplete="off"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
              {keyword && !loading && (
                <button
                  onClick={() => {
                    setKeyword('')
                    inputRef.current?.focus()
                  }}
                  className="text-muted hover:text-text-secondary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <div className="hidden rounded bg-bg-soft px-2 py-1 text-xs text-muted sm:block">
                ESC
              </div>
            </div>

            {/* 搜索结果 */}
            <div className="max-h-[60vh] overflow-y-auto">
              {!keyword.trim() && (
                <div className="py-12 text-center text-sm text-muted">
                  输入至少2个字符开始搜索
                </div>
              )}

              {keyword.trim().length >= 2 && !loading && tasks.length === 0 && (
                <div className="py-12 text-center text-sm text-muted">
                  未找到匹配的任务
                </div>
              )}

              {tasks.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-2 text-xs font-medium text-muted">
                    找到 {tasks.length} 个任务
                  </div>
                  {tasks.map((task, index) => (
                    <button
                      key={task.id}
                      onClick={() => handleSelectTask(task)}
                      className={cn(
                        'w-full flex items-start gap-3 px-4 py-3 text-left transition hover:bg-brand/5',
                        index === selectedIndex && 'bg-brand/10',
                      )}
                    >
                      {/* 任务信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <StatusBadge status={task.status} />
                          <PriorityBadge priority={task.priority} />
                        </div>
                        <div className="text-sm font-medium text-text-primary mb-1">
                          {highlightKeyword(task.title, keyword.trim())}
                        </div>
                        <div className="text-xs text-muted truncate">
                          {getProjectName(task.projectId)}
                        </div>
                      </div>
                      {/* 标签 */}
                      {task.labels.length > 0 && (
                        <div className="flex flex-wrap gap-1 flex-shrink-0">
                          {task.labels.slice(0, 3).map((label, i) => (
                            <span
                              key={i}
                              className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] text-muted"
                            >
                              {label}
                            </span>
                          ))}
                          {task.labels.length > 3 && (
                            <span className="text-[10px] text-muted">
                              +{task.labels.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 底部提示 */}
            <div className="flex items-center justify-between border-t border-bg-border px-4 py-2 text-xs text-muted">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">↑</kbd>
                  <kbd className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">↓</kbd>
                  <span className="ml-1">导航</span>
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">↵</kbd>
                  <span className="ml-1">选择</span>
                </span>
              </div>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">⌘</kbd>
                <kbd className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">K</kbd>
                <span className="ml-1">打开搜索</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// 高亮关键词
function highlightKeyword(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text
  const parts = text.split(new RegExp(`(${escapeRegExp(keyword)})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === keyword.toLowerCase()
      ? <mark key={i} className="bg-yellow-400/30 text-inherit rounded px-0.5">{part}</mark>
      : part
  )
}

// 转义正则表达式特殊字符
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}