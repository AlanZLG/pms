import { useState, useEffect } from 'react'
import { X, Link, Info } from 'lucide-react'
import type { Task, TaskDependency } from '../../shared/types'
import { Button } from './ui'

interface DependencyDialogProps {
  isOpen: boolean
  onClose: () => void
  sourceTask: Task | null
  targetTask: Task | null
  dependency?: TaskDependency | null // 编辑时传入现有依赖
  onSave: (type: 'fs' | 'ss' | 'ff' | 'sf', lagDays: number) => void
  onDelete?: () => void
}

const DEPENDENCY_TYPES = [
  {
    value: 'fs',
    label: 'FS',
    fullName: '完成-开始',
    description: 'A完成后B才能开始',
    color: 'bg-blue-500',
    example: '任务A完成后，任务B才能开始'
  },
  {
    value: 'ss',
    label: 'SS',
    fullName: '开始-开始',
    description: 'A开始后B才能开始',
    color: 'bg-green-500',
    example: '任务A开始后，任务B才能开始'
  },
  {
    value: 'ff',
    label: 'FF',
    fullName: '完成-完成',
    description: 'A完成后B才能完成',
    color: 'bg-orange-500',
    example: '任务A完成后，任务B才能完成'
  },
  {
    value: 'sf',
    label: 'SF',
    fullName: '开始-完成',
    description: 'A开始后B才能完成',
    color: 'bg-red-500',
    example: '任务A开始后，任务B才能完成'
  },
] as const

export default function DependencyDialog({
  isOpen,
  onClose,
  sourceTask,
  targetTask,
  dependency,
  onSave,
  onDelete,
}: DependencyDialogProps) {
  const [type, setType] = useState<'fs' | 'ss' | 'ff' | 'sf'>('fs')
  const [lagDays, setLagDays] = useState(0)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (dependency) {
      setType(dependency.type)
      setLagDays(dependency.lagDays)
    } else {
      setType('fs')
      setLagDays(0)
    }
  }, [dependency, isOpen])

  if (!isOpen) return null

  const selectedType = DEPENDENCY_TYPES.find(t => t.value === type)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 对话框 */}
      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto bg-bg-panel border border-bg-border rounded-2xl shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-border">
          <div className="flex items-center gap-2">
            <Link className="w-5 h-5 text-brand" />
            <h2 className="text-lg font-semibold text-text-primary">
              {dependency ? '编辑依赖关系' : '创建依赖关系'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-bg-border transition-colors"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 space-y-4">
          {/* 任务信息 */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-16 text-xs text-muted">前置任务</div>
              <div className="flex-1 p-2 rounded-lg bg-bg-soft border border-bg-border">
                <div className="text-sm font-medium text-text-primary truncate">
                  {sourceTask?.title || '未指定'}
                </div>
                {sourceTask && (
                  <div className="text-xs text-muted mt-1">
                    {sourceTask.startDate && sourceTask.dueDate
                      ? `${new Date(sourceTask.startDate).toLocaleDateString()} - ${new Date(sourceTask.dueDate).toLocaleDateString()}`
                      : '未设置时间'}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-16 text-xs text-muted">后续任务</div>
              <div className="flex-1 p-2 rounded-lg bg-bg-soft border border-bg-border">
                <div className="text-sm font-medium text-text-primary truncate">
                  {targetTask?.title || '未指定'}
                </div>
                {targetTask && (
                  <div className="text-xs text-muted mt-1">
                    {targetTask.startDate && targetTask.dueDate
                      ? `${new Date(targetTask.startDate).toLocaleDateString()} - ${new Date(targetTask.dueDate).toLocaleDateString()}`
                      : '未设置时间'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 依赖类型选择 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              依赖类型
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DEPENDENCY_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
                    type === t.value
                      ? 'border-brand bg-brand/10 text-text-primary'
                      : 'border-bg-border bg-bg-soft text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${t.color}`} />
                  <div className="text-left">
                    <div className="text-sm font-semibold">{t.label}</div>
                    <div className="text-xs text-muted">{t.fullName}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 依赖类型说明 */}
          {selectedType && (
            <div className="p-3 rounded-lg bg-brand/5 border border-brand/20">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                <div className="text-sm text-text-primary">
                  <div className="font-medium mb-1">{selectedType.description}</div>
                  <div className="text-xs text-muted">{selectedType.example}</div>
                </div>
              </div>
            </div>
          )}

          {/* 延迟天数 */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              延迟天数（可为负数）
            </label>
            <input
              type="number"
              value={lagDays}
              onChange={(e) => setLagDays(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-bg-border bg-bg-soft text-sm text-text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              placeholder="0"
            />
            <p className="mt-1 text-xs text-muted">
              正数表示延后，负数表示提前。例如：FS +2天 表示A完成后2天B才能开始
            </p>
          </div>

          {/* 帮助提示 */}
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="w-full text-left text-xs text-brand hover:text-brand-soft transition-colors"
          >
            {showHelp ? '隐藏' : '查看'}依赖类型详细说明
          </button>

          {showHelp && (
            <div className="p-3 rounded-lg bg-bg-soft border border-bg-border space-y-2">
              {DEPENDENCY_TYPES.map((t) => (
                <div key={t.value} className="flex items-start gap-2">
                  <div className={`w-3 h-3 rounded-full ${t.color} mt-1 flex-shrink-0`} />
                  <div className="text-xs text-text-primary">
                    <span className="font-semibold">{t.label} ({t.fullName})：</span>
                    <span className="text-muted">{t.description}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-bg-border">
          <div>
            {onDelete && dependency && (
              <Button variant="danger" size="sm" onClick={onDelete}>
                删除依赖
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={() => onSave(type, lagDays)}>
              {dependency ? '保存修改' : '创建依赖'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}