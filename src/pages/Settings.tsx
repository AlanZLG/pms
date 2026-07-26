// 设置页

import { useAppStore } from '@/stores/app'
import { Card, Avatar, Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'

export default function Settings() {
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)
  const me = useAsync(() => api.me(), [])

  const info = me.data?.user || user
  if (!info) return null

  return (
    <div className="max-w-2xl space-y-6 animate-fade-up">
      <div>
        <h2 className="font-display text-2xl text-white">个人设置</h2>
        <p className="mt-1 text-sm text-muted">查看你的账户信息与偏好</p>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={info.name} color={info.avatarColor} size={56} />
          <div>
            <p className="font-display text-xl text-white">{info.name}</p>
            <p className="text-sm text-muted">{info.email}</p>
            <p className="mt-1 text-xs text-brand-soft">{roleLabel(info.role)}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <Field label="用户 ID" value={info.id} mono />
          <Field label="注册时间" value={new Date(info.createdAt).toLocaleString()} />
        </div>

        <div className="mt-6 border-t border-bg-border pt-4">
          <Button variant="ghost" onClick={logout}>
            退出登录
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <p className={mono ? 'break-all font-mono text-xs text-slate-200' : 'text-slate-200'}>{value}</p>
    </div>
  )
}

function roleLabel(role: string) {
  return role === 'admin' ? '系统管理员' : role === 'owner' ? '项目负责人' : role === 'guest' ? '访客' : '团队成员'
}