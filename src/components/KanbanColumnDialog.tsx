// 看板列配置对话框

import React, { useState, useEffect, useCallback } from 'react'
import { X, Plus, Settings2, Trash2, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button, Input } from '@/components/ui'
import type { KanbanColumn } from '../../shared/types'

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
  onChanged: () => void
}

const PRESET_COLORS = [
  '#94A3B8', '#6366F1', '#8B5CF6', '#EC4899',
  '#F59E0B', '#F97316', '#EF4444', '#10B981',
  '#0EA5E9', '#06B6D4', '#14B8A6', '#84CC16',
]

export default function KanbanColumnDialog({ projectId, open, onClose, onChanged }: Props) {
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [loading, setLoading] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('#6366F1')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editColor, setEditColor] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // 加载看板列配置
  const loadColumns = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.getKanbanColumns(projectId)
      setColumns(res.columns)
    } catch (e) {
      console.error('加载看板列配置失败:', e)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) {
      loadColumns()
    }
  }, [open, loadColumns])

  const handleAddColumn = async () => {
    if (!newLabel.trim()) return

    try {
      setLoading(true)
      // 生成唯一的 statusKey
      const statusKey = `custom_${Date.now()}`
      await api.createKanbanColumn(projectId, {
        statusKey,
        label: newLabel.trim(),
        color: newColor,
        sortOrder: columns.length,
      })
      setNewLabel('')
      setNewColor('#6366F1')
      setAddingNew(false)
      loadColumns()
      onChanged()
    } catch (e) {
      alert(getErrorMessage(e, '添加失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateColumn = async (columnId: string) => {
    if (!editLabel.trim()) return

    try {
      setLoading(true)
      await api.updateKanbanColumn(columnId, {
        label: editLabel.trim(),
        color: editColor,
      })
      setEditingId(null)
      loadColumns()
      onChanged()
    } catch (e) {
      alert(getErrorMessage(e, '更新失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteColumn = async (column: KanbanColumn) => {
    // 检查是否为默认列（todo, in_progress, review, done）
    const isDefault = ['todo', 'in_progress', 'review', 'done'].includes(column.statusKey)
    if (isDefault) {
      alert('不能删除默认状态列')
      return
    }

    if (!confirm(`确认删除列「${column.label}」？\n注意：该列中的任务将保留，但状态会变更为默认状态。`)) return

    try {
      setLoading(true)
      await api.deleteKanbanColumn(column.id)
      loadColumns()
      onChanged()
    } catch (e) {
      alert(getErrorMessage(e, '删除失败'))
    } finally {
      setLoading(false)
    }
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = columns.findIndex((c) => c.id === active.id)
    const newIndex = columns.findIndex((c) => c.id === over.id)

    const newColumns = arrayMove(columns, oldIndex, newIndex)
    setColumns(newColumns)

    try {
      await api.reorderKanbanColumns(projectId, newColumns.map((c) => c.id))
      onChanged()
    } catch (e) {
      // 恢复原顺序
      setColumns(columns)
      alert(getErrorMessage(e, '排序失败'))
    }
  }, [columns, projectId, onChanged])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-bg-panel p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium text-text-primary">看板列配置</h3>
          <button onClick={onClose} className="text-muted hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 text-sm text-muted">
          拖拽调整列顺序，点击编辑按钮修改列名称和颜色。
        </div>

        {/* 列表 */}
        <div className="mb-4 max-h-[400px] space-y-2 overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {columns.map((column) => (
                <SortableColumnItem
                  key={column.id}
                  column={column}
                  editing={editingId === column.id}
                  editLabel={editLabel}
                  editColor={editColor}
                  onEditStart={() => {
                    setEditingId(column.id)
                    setEditLabel(column.label)
                    setEditColor(column.color)
                  }}
                  onEditLabel={setEditLabel}
                  onEditColor={setEditColor}
                  onEditSave={() => handleUpdateColumn(column.id)}
                  onEditCancel={() => setEditingId(null)}
                  onDelete={() => handleDeleteColumn(column)}
                  loading={loading}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* 添加新列 */}
        {addingNew ? (
          <div className="mb-4 space-y-2 rounded-lg border border-bg-border p-3">
            <Input
              placeholder="列名称"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={loading}
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={`h-6 w-6 rounded-md border-2 transition ${
                    newColor === color ? 'border-white' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddColumn} disabled={loading || !newLabel.trim()}>
                添加
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAddingNew(false)} disabled={loading}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAddingNew(true)} className="mb-4">
            <Plus className="h-4 w-4" /> 添加新列
          </Button>
        )}

        {/* 底部按钮 */}
        <div className="flex justify-end">
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  )
}

// 可排序的列项组件
function SortableColumnItem({
  column,
  editing,
  editLabel,
  editColor,
  onEditStart,
  onEditLabel,
  onEditColor,
  onEditSave,
  onEditCancel,
  onDelete,
  loading,
}: {
  column: KanbanColumn
  editing: boolean
  editLabel: string
  editColor: string
  onEditStart: () => void
  onEditLabel: (label: string) => void
  onEditColor: (color: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onDelete: () => void
  loading: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isDefault = ['todo', 'in_progress', 'review', 'done'].includes(column.statusKey)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border border-bg-border bg-bg-soft p-3 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted hover:text-text-secondary"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: column.color }}
      />

      {editing ? (
        <div className="flex flex-1 flex-col gap-2">
          <Input
            value={editLabel}
            onChange={(e) => onEditLabel(e.target.value)}
            disabled={loading}
            className="text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => onEditColor(color)}
                className={`h-5 w-5 rounded-md border-2 transition ${
                  editColor === color ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onEditSave} disabled={loading || !editLabel.trim()}>
              保存
            </Button>
            <Button variant="ghost" size="sm" onClick={onEditCancel} disabled={loading}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm font-medium text-text-primary">{column.label}</span>
          {isDefault && (
            <span className="rounded bg-bg-border px-1.5 py-0.5 text-xs text-muted">默认</span>
          )}
          <button
            onClick={onEditStart}
            className="text-muted hover:text-brand-soft"
            disabled={loading}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {!isDefault && (
            <button
              onClick={onDelete}
              className="text-muted hover:text-danger"
              disabled={loading}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    </div>
  )
}