// 团队页

import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Avatar, Skeleton, EmptyState } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import type { UserRole } from '../../shared/types'

const roleList: { value: UserRole; label: string }[] = [
  { value: 'admin', label: '系统管理员' },
  { value: 'owner', label: '项目负责人' },
  { value: 'member', label: '团队成员' },
  { value: 'guest', label: '访客' },
]

export default function Team() {
  const users = useAsync(() => api.listUsers(), [])
  const me = useAppStore((s) => s.user)
  const notify = useAppStore((s) => s.notify)

  async function changeRole(userId: string, role: string) {
    try {
      await api.updateRole(userId, role)
      notify('success', '角色已更新')
      users.reload()
    } catch (e: any) {
      notify('error', e?.message || '更新失败')
    }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="font-display text-2xl text-white">团队协作</h2>
        <p className="mt-1 text-sm text-muted">查看成员并配置权限</p>
      </div>

      {users.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : users.data && users.data.users.length > 0 ? (
        <div className="grid gap-4 animate-stagger sm:grid-cols-2 lg:grid-cols-3">
          {users.data.users.map((u) => (
            <Card key={u.id} className="p-5">
              <div className="flex items-center gap-3">
                <Avatar name={u.name} color={u.avatarColor} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-slate-100">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-brand-soft">(我)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="负责" value={u.taskCount} />
                <Stat label="进行中" value={u.activeCount} />
                <Stat label="角色" value={roleLabel(u.role)} text />
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[11px] text-muted">修改角色</label>
                <select
                  value={u.role}
                  disabled={me?.role !== 'admin'}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-xs text-slate-100 outline-none focus:border-brand disabled:opacity-60"
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
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无成员" />
      )}
    </div>
  )
}

function Stat({ label, value, text }: { label: string; value: number | string; text?: boolean }) {
  return (
    <div className="rounded-lg bg-bg-soft py-2">
      {text ? (
        <p className="text-xs text-slate-200">{value}</p>
      ) : (
        <p className="font-mono text-lg font-semibold text-white">{value}</p>
      )}
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  )
}

function roleLabel(role: string) {
  return roleList.find((r) => r.value === role)?.label || role
}