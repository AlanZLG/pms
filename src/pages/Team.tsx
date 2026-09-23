import { useState, useCallback } from 'react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Card, Avatar, Skeleton, EmptyState, Button, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { sortUsers } from '@/lib/utils'
import { Settings2, Plus, X, Trash2, Edit2 } from 'lucide-react'
import type { UserRole, UserCategory } from '../../shared/types'

const roleList: { value: UserRole; label: string }[] = [
  { value: 'admin', label: '系统管理员' },
  { value: 'owner', label: '项目负责人' },
  { value: 'member', label: '团队成员' },
  { value: 'guest', label: '访客' },
]

export default function Team() {
  const users = useAsync(() => api.listUsers(), [])
  const categories = useAsync(() => api.listCategories(), [])
  const customRoles = useAsync(() => api.listCustomRoles(), [])
  const me = useAppStore((s) => s.user)
  const notify = useAppStore((s) => s.notify)
  const [showCategoryDialog, setShowCategoryDialog] = useState(false)
  const [editingCategory, setEditingCategory] = useState<UserCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', hourlyRate: 0, isOutsourced: false })
  const [userCostDialog, setUserCostDialog] = useState<string | null>(null)
  const [userCostForm, setUserCostForm] = useState({ isOutsourced: false, hourlyRate: null as number | null, costCenter: '', categoryId: null as string | null })
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createForm, setCreateForm] = useState({ email: '', name: '', password: '', role: 'member' })
  const [createError, setCreateError] = useState('')
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; email: string } | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', newPassword: '' })
  const [editError, setEditError] = useState('')

  const isFinance = me?.role === 'admin' || me?.role === 'finance'
  const isAdmin = me?.role === 'admin'

  const changeRole = useCallback(async (userId: string, role: string) => {
    try {
      await api.updateRole(userId, role)
      notify('success', '角色已更新')
      users.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '更新失败'))
    }
  }, [notify, users])

  const changeCustomRole = useCallback(async (userId: string, customRoleId: string | null) => {
    try {
      await api.updateUserCustomRole(userId, customRoleId)
      notify('success', '自定义角色已更新')
      users.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '更新失败'))
    }
  }, [notify, users])

  const saveCategory = useCallback(async () => {
    try {
      if (editingCategory) {
        await api.updateCategory(editingCategory.id, categoryForm)
        notify('success', '类别已更新')
      } else {
        await api.createCategory(categoryForm)
        notify('success', '类别已创建')
      }
      categories.reload()
      setShowCategoryDialog(false)
      setEditingCategory(null)
      setCategoryForm({ name: '', description: '', hourlyRate: 0, isOutsourced: false })
    } catch (e) {
      notify('error', getErrorMessage(e, '操作失败'))
    }
  }, [editingCategory, categoryForm, notify, categories])

  const deleteCategory = useCallback(async (categoryId: string) => {
    if (!confirm('确定删除该类别吗？')) return
    try {
      await api.deleteCategory(categoryId)
      notify('success', '类别已删除')
      categories.reload()
    } catch (e) {
      notify('error', getErrorMessage(e, '删除失败'))
    }
  }, [notify, categories])

  const openCategoryDialog = useCallback((category?: UserCategory) => {
    if (category) {
      setEditingCategory(category)
      setCategoryForm({ name: category.name, description: category.description, hourlyRate: category.hourlyRate, isOutsourced: category.isOutsourced })
    } else {
      setEditingCategory(null)
      setCategoryForm({ name: '', description: '', hourlyRate: 0, isOutsourced: false })
    }
    setShowCategoryDialog(true)
  }, [])

  const openUserCostDialog = useCallback(async (userId: string) => {
    try {
      const cost = await api.getUserCost(userId)
      setUserCostForm({ isOutsourced: cost.isOutsourced, hourlyRate: cost.hourlyRate, costCenter: cost.costCenter || '', categoryId: cost.categoryId })
      setUserCostDialog(userId)
    } catch (e) {
      notify('error', getErrorMessage(e, '获取成本信息失败'))
    }
  }, [notify])

  const saveUserCost = useCallback(async () => {
    if (!userCostDialog) return
    try {
      await api.updateUserCost(userCostDialog, userCostForm)
      notify('success', '成本信息已更新')
      users.reload()
      setUserCostDialog(null)
    } catch (e) {
      notify('error', getErrorMessage(e, '更新失败'))
    }
  }, [userCostDialog, userCostForm, notify, users])

  const getCategoryName = useCallback((categoryId: string | null | undefined) => {
    if (!categoryId) return '-'
    return categories.data?.categories.find(c => c.id === categoryId)?.name || '-'
  }, [categories.data])

  const getCategoryRate = useCallback((categoryId: string | null | undefined) => {
    if (!categoryId) return null
    return categories.data?.categories.find(c => c.id === categoryId)?.hourlyRate || null
  }, [categories.data])

  const createUser = useCallback(async () => {
    try {
      setCreateError('')
      await api.createUser(createForm)
      notify('success', `成员 ${createForm.name} 已创建`)
      users.reload()
      setShowCreateDialog(false)
      setCreateForm({ email: '', name: '', password: '', role: 'member' })
    } catch (e) {
      setCreateError(getErrorMessage(e, '创建失败'))
    }
  }, [createForm, notify, users])

  const saveMemberEdit = useCallback(async () => {
    if (!editTarget) return
    try {
      setEditError('')
      await api.updateUserProfile(editTarget.id, { name: editForm.name, email: editForm.email })
      if (editForm.newPassword) {
        if (editForm.newPassword.length < 5) {
          setEditError('新密码至少 5 位')
          return
        }
        await api.resetUserPassword(editTarget.id, editForm.newPassword)
      }
      notify('success', '成员信息已更新')
      users.reload()
      setEditTarget(null)
    } catch (e) {
      setEditError(getErrorMessage(e, '更新失败'))
    }
  }, [editTarget, editForm, notify, users])

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-2xl text-text-primary">团队协作</h2>
          <p className="mt-1 text-sm text-muted">查看成员并配置权限</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setCreateForm({ email: '', name: '', password: '', role: 'member' }); setCreateError(''); setShowCreateDialog(true) }} className="text-sm gap-1">
            <Plus className="h-4 w-4" /> 新建成员
          </Button>
        )}
      </div>

      {isFinance && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg text-text-primary flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-brand-soft" /> 人员类别管理
            </h3>
            <Button onClick={() => openCategoryDialog()} className="text-sm gap-1">
              <Plus className="h-4 w-4" /> 添加类别
            </Button>
          </div>
          {categories.loading ? (
            <Skeleton className="h-24" />
          ) : categories.data?.categories.length === 0 ? (
            <EmptyState title="暂无类别" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.data?.categories.map((cat) => (
                <div key={cat.id} className="rounded-lg bg-bg-soft p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{cat.name}</span>
                      {cat.isOutsourced && <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">外包</span>}
                    </div>
                    <div className="text-sm text-muted mt-1">¥{cat.hourlyRate}/小时</div>
                    {cat.description && <div className="text-xs text-muted mt-1">{cat.description}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openCategoryDialog(cat)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-400" onClick={() => deleteCategory(cat.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {users.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : users.data?.limited ? (
        <EmptyState
          title="仅管理员、财务与项目负责人可见"
          hint="完整通讯录需要相应权限；如需指派任务，可在任务创建时选择负责人"
        />
      ) : users.data && users.data.users.length > 0 ? (
        <div className="grid gap-4 animate-stagger sm:grid-cols-2 lg:grid-cols-3">
          {sortUsers(users.data?.users || []).map((u) => (
            <Card key={u.id} className="p-5">
              <div className="flex items-center gap-3">
                <Avatar name={u.name} color={u.avatarColor} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-text-primary">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-brand-soft">(我)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                {isAdmin && (
                  <Button variant="ghost" size="sm" title="编辑成员" onClick={() => { setEditForm({ name: u.name, email: u.email, newPassword: '' }); setEditError(''); setEditTarget({ id: u.id, name: u.name, email: u.email }) }}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="负责" value={u.taskCount} />
                <Stat label="进行中" value={u.activeCount} />
                <Stat label="角色" value={roleLabel(u.role)} text />
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[11px] text-muted">系统角色</label>
                <select
                  value={u.role}
                  disabled={me?.role !== 'admin'}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-xs text-text-primary outline-none focus:border-brand disabled:opacity-60"
                >
                  {roleList.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {me?.role !== 'admin' && (
                  <p className="mt-1 text-[10px] text-muted">仅系统管理员可修改角色</p>
                )}
              </div>
              {me?.role === 'admin' && customRoles.data && customRoles.data.roles.length > 0 && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] text-muted">自定义角色</label>
                  <select
                    value={u.customRoleId || ''}
                    onChange={(e) => changeCustomRole(u.id, e.target.value || null)}
                    className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-xs text-text-primary outline-none focus:border-brand"
                  >
                    <option value="">不设置</option>
                    {customRoles.data.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.isSystem ? '(系统)' : ''}
                      </option>
                    ))}
                  </select>
                  {u.customRoleId && (
                    <p className="mt-1 text-[10px] text-brand-soft">
                      已分配: {customRoles.data.roles.find(r => r.id === u.customRoleId)?.name}
                    </p>
                  )}
                </div>
              )}
              {isFinance && (
                <div className="mt-4 pt-4 border-t border-bg-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted">成本信息</span>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => openUserCostDialog(u.id)}>
                      <Settings2 className="h-3 w-3 mr-1" /> 配置
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-bg-soft rounded p-2">
                      <span className="text-muted">类别</span>
                      <div className="font-medium text-text-primary">{getCategoryName(u.categoryId)}</div>
                    </div>
                    <div className="bg-bg-soft rounded p-2">
                      <span className="text-muted">单价</span>
                      <div className="font-medium text-text-primary">
                        {/* 未配置个人/类别价时展示角色默认价（与后端 project-cost 口径一致：负责人 200/成员 150/外包 125） */}
                        ¥{(u.hourlyRate || getCategoryRate(u.categoryId) || (u.isOutsourced ? 125 : 150))}/小时
                        {!u.hourlyRate && !getCategoryRate(u.categoryId) && (
                          <span className="ml-1 text-[10px] font-normal text-muted">默认价（负责人项目内 ¥200）</span>
                        )}
                      </div>
                    </div>
                    <div className="bg-bg-soft rounded p-2 col-span-2">
                      <span className="text-muted">成本中心</span>
                      <div className="font-medium text-text-primary truncate">{u.costCenter || '-'}</div>
                    </div>
                  </div>
                  {u.isOutsourced && (
                    <div className="mt-2 text-xs px-2 py-1 bg-orange-500/20 text-orange-400 rounded inline-block">
                      外包人员
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无成员" />
      )}

      {showCategoryDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCategoryDialog(false)}>
          <div className="bg-bg-panel border border-bg-border rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-text-primary">{editingCategory ? '编辑类别' : '添加人员类别'}</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowCategoryDialog(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted mb-1 block">类别名称</label>
                <Input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">描述</label>
                <Input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">小时单价 (RMB)</label>
                <Input type="number" value={categoryForm.hourlyRate} onChange={(e) => setCategoryForm({ ...categoryForm, hourlyRate: Number(e.target.value) || 0 })} className="bg-bg-soft" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={categoryForm.isOutsourced} onChange={(e) => setCategoryForm({ ...categoryForm, isOutsourced: e.target.checked })} className="rounded" />
                <label className="text-sm text-muted">外包类别</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowCategoryDialog(false)}>取消</Button>
              <Button onClick={saveCategory}>{editingCategory ? '保存' : '创建'}</Button>
            </div>
          </div>
        </div>
      )}

      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateDialog(false)}>
          <div className="bg-bg-panel border border-bg-border rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-text-primary">新建成员</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowCreateDialog(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted mb-1 block">登录邮箱 *</label>
                <Input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} placeholder="name@company.com" className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">姓名 *</label>
                <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} maxLength={40} className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">初始密码 *（至少 5 位）</label>
                <Input type="text" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="设置初始登录密码" className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">系统角色</label>
                <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand">
                  {roleList.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              <p className="text-xs text-muted">创建后成员即可使用邮箱和密码登录系统。</p>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowCreateDialog(false)}>取消</Button>
              <Button onClick={createUser} disabled={!createForm.email || !createForm.name || createForm.password.length < 5}>创建</Button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditTarget(null)}>
          <div className="bg-bg-panel border border-bg-border rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-text-primary">维护成员信息</h3>
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted mb-1 block">姓名</label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} maxLength={40} className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">登录邮箱</label>
                <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">重置密码（留空表示不修改）</label>
                <Input type="text" value={editForm.newPassword} onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })} placeholder="输入新密码（至少 5 位）" className="bg-bg-soft" />
              </div>
              {editError && <p className="text-xs text-red-400">{editError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>取消</Button>
              <Button onClick={saveMemberEdit}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {userCostDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setUserCostDialog(null)}>
          <div className="bg-bg-panel border border-bg-border rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg text-text-primary">配置成本信息</h3>
              <Button variant="ghost" size="sm" onClick={() => setUserCostDialog(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted mb-1 block">人员类别</label>
                <select value={userCostForm.categoryId || ''} onChange={(e) => setUserCostForm({ ...userCostForm, categoryId: e.target.value || null })} className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand">
                  <option value="">不设置类别</option>
                  {categories.data?.categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name} (¥{cat.hourlyRate}/小时)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">小时单价 (RMB) - 留空使用类别默认</label>
                <Input type="number" value={userCostForm.hourlyRate || ''} onChange={(e) => setUserCostForm({ ...userCostForm, hourlyRate: e.target.value ? Number(e.target.value) : null })} className="bg-bg-soft" />
              </div>
              <div>
                <label className="text-sm text-muted mb-1 block">成本中心</label>
                <Input value={userCostForm.costCenter} onChange={(e) => setUserCostForm({ ...userCostForm, costCenter: e.target.value })} className="bg-bg-soft" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={userCostForm.isOutsourced} onChange={(e) => setUserCostForm({ ...userCostForm, isOutsourced: e.target.checked })} className="rounded" />
                <label className="text-sm text-muted">外包人员</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setUserCostDialog(null)}>取消</Button>
              <Button onClick={saveUserCost}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, text }: { label: string; value: number | string; text?: boolean }) {
  return (
    <div className="rounded-lg bg-bg-soft py-2">
      {text ? (
        <p className="text-xs text-text-secondary">{value}</p>
      ) : (
        <p className="font-mono text-lg font-semibold text-text-primary">{value}</p>
      )}
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  )
}

function roleLabel(role: string) {
  return roleList.find((r) => r.value === role)?.label || role
}
