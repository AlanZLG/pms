import { useState, useCallback } from 'react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Card, Button, Skeleton, EmptyState } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { Shield, Plus, Edit2, Trash2, Lock } from 'lucide-react'
import type { CustomRole } from '../../shared/types'
import RoleDialog from '@/components/RoleDialog'

export default function Roles() {
  const roles = useAsync(() => api.listRoles(), [])
  const me = useAppStore((s) => s.user)
  const notify = useAppStore((s) => s.notify)
  const [showDialog, setShowDialog] = useState(false)
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null)

  const isAdmin = me?.role === 'admin'

  const openEditDialog = useCallback((role: CustomRole) => {
    setEditingRole(role)
    setShowDialog(true)
  }, [])

  const openCreateDialog = useCallback(() => {
    setEditingRole(null)
    setShowDialog(true)
  }, [])

  const handleDelete = useCallback(async (roleId: string) => {
    if (!confirm('确定删除该角色吗？')) return
    try {
      await api.deleteRole(roleId)
      notify('success', '角色已删除')
      roles.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }, [notify, roles])

  const handleDialogClose = useCallback(() => {
    setShowDialog(false)
    setEditingRole(null)
    roles.reload()
  }, [roles])

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-text-primary flex items-center gap-2">
            <Shield className="h-6 w-6 text-brand-soft" />
            角色管理
          </h2>
          <p className="mt-1 text-sm text-muted">管理系统角色和自定义角色权限</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreateDialog} className="gap-1">
            <Plus className="h-4 w-4" />
            新建角色
          </Button>
        )}
      </div>

      {roles.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : roles.data && roles.data.roles.length > 0 ? (
        <div className="grid gap-4 animate-stagger sm:grid-cols-2 lg:grid-cols-3">
          {roles.data.roles.map((role) => (
            <Card key={role.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text-primary">{role.name}</h3>
                    {role.isSystem && (
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-brand/20 text-brand rounded">
                        <Lock className="h-3 w-3" />
                        系统
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted line-clamp-2">{role.description || '暂无描述'}</p>
                  <div className="mt-3 flex items-center gap-4 text-xs text-muted">
                    <span>{role.permissionCount || 0} 个权限</span>
                  </div>
                </div>
                {isAdmin && !role.isSystem && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(role)}
                      className="text-muted hover:text-text-primary"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400"
                      onClick={() => handleDelete(role.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无角色" />
      )}

      {showDialog && (
        <RoleDialog
          role={editingRole}
          onClose={handleDialogClose}
        />
      )}
    </div>
  )
}