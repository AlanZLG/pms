import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button, Input, Skeleton } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { X, Save } from 'lucide-react'
import type { CustomRole, PermissionCategory } from '../../shared/types'

interface RoleDialogProps {
  role: CustomRole | null
  onClose: () => void
}

export default function RoleDialog({ role, onClose }: RoleDialogProps) {
  const [name, setName] = useState(role?.name || '')
  const [description, setDescription] = useState(role?.description || '')
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<PermissionCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const notify = useAppStore((s) => s.notify)

  // 加载权限列表
  useEffect(() => {
    const loadPermissions = async () => {
      setLoading(true)
      try {
        const result = await api.listPermissions()
        setCategories(result.categories)
      } catch (e) {
        notify('error', getErrorMessage(e, '加载权限失败'))
      } finally {
        setLoading(false)
      }
    }
    loadPermissions()
  }, [notify])

  // 如果编辑角色，加载角色权限
  useEffect(() => {
    if (role) {
      const loadRolePermissions = async () => {
        try {
          const result = await api.getRole(role.id)
          if (result.role.permissions) {
            setSelectedPermissions(new Set(result.role.permissions.map(p => p.id)))
          }
        } catch (e) {
          notify('error', getErrorMessage(e, '加载角色权限失败'))
        }
      }
      loadRolePermissions()
    }
  }, [role, notify])

  const togglePermission = useCallback((permissionId: string) => {
    setSelectedPermissions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(permissionId)) {
        newSet.delete(permissionId)
      } else {
        newSet.add(permissionId)
      }
      return newSet
    })
  }, [])

  const toggleCategory = useCallback((category: PermissionCategory) => {
    const allSelected = category.permissions.every(p => selectedPermissions.has(p.id))
    setSelectedPermissions(prev => {
      const newSet = new Set(prev)
      category.permissions.forEach(p => {
        if (allSelected) {
          newSet.delete(p.id)
        } else {
          newSet.add(p.id)
        }
      })
      return newSet
    })
  }, [selectedPermissions])

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      notify('error', '请输入角色名称')
      return
    }

    setSaving(true)
    try {
      if (role) {
        // 更新角色
        await api.updateCustomRole(role.id, { name, description })
        await api.updateRolePermissions(role.id, Array.from(selectedPermissions))
        notify('success', '角色已更新')
      } else {
        // 创建角色
        await api.createRole({
          name,
          description,
          permissionIds: Array.from(selectedPermissions),
        })
        notify('success', '角色已创建')
      }
      onClose()
    } catch (e) {
      notify('error', getErrorMessage(e, '保存失败'))
    } finally {
      setSaving(false)
    }
  }, [name, description, role, selectedPermissions, notify, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-bg-panel border border-bg-border rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-bg-border">
          <h3 className="font-display text-lg text-text-primary">
            {role ? '编辑角色' : '新建角色'}
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted mb-1 block">角色名称 *</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="输入角色名称"
                className="bg-bg-soft"
              />
            </div>
            <div>
              <label className="text-sm text-muted mb-1 block">描述</label>
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="输入角色描述"
                className="bg-bg-soft"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted mb-3 block">权限配置</label>
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {categories.map(category => (
                  <div key={category.category} className="border border-bg-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-text-primary">{category.category}</h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleCategory(category)}
                        className="text-xs"
                      >
                        {category.permissions.every(p => selectedPermissions.has(p.id)) ? '取消全选' : '全选'}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {category.permissions.map(permission => (
                        <label
                          key={permission.id}
                          className="flex items-center gap-2 p-2 rounded bg-bg-soft hover:bg-bg-elev cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.has(permission.id)}
                            onChange={() => togglePermission(permission.id)}
                            className="rounded"
                          />
                          <span className="text-sm text-text-primary">{permission.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-bg-border">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1">
            <Save className="h-4 w-4" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}