// 设置页

import { useState } from 'react'
import { useAppStore } from '@/stores/app'
import { Card, Avatar, Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'

export default function Settings() {
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)
  const me = useAsync(() => api.me(), [])
  const feishu = useAsync(() => api.getFeishuStatus(), [])
  const [binding, setBinding] = useState(false)

  const info = me.data?.user || user
  if (!info) return null

  const feishuConfigured = feishu.data?.configured
  const feishuBound = feishu.data?.bound
  const feishuName = feishu.data?.feishuName

  async function handleBind() {
    try {
      setBinding(true)
      const { authUrl } = await api.getFeishuBindUrl()
      if (authUrl) {
        window.open(authUrl, '_blank', 'width=600,height=700')
      }
    } catch {} finally {
      setBinding(false)
    }
  }

  async function handleUnbind() {
    try {
      await api.unbindFeishu()
      await feishu.reload()
    } catch {}
  }

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

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#3370FF]/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="#3370FF" strokeWidth="1.5"/>
                <path d="M8 10h8M8 14h5" stroke="#3370FF" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="font-display text-white">飞书集成</p>
              <p className="text-sm text-muted">绑定飞书账号,接收实时通知推送</p>
            </div>
          </div>
          {feishu.loading ? (
            <span className="text-sm text-muted">加载中...</span>
          ) : !feishuConfigured ? (
            <span className="text-sm text-amber-400">未配置</span>
          ) : feishuBound ? (
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-400">
                已绑定 {feishuName ? `· ${feishuName}` : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={handleUnbind}>
                解除绑定
              </Button>
            </div>
          ) : (
            <Button onClick={handleBind} disabled={binding}>
              {binding ? '跳转中...' : '绑定飞书'}
            </Button>
          )}
        </div>

        <div className="mt-4 rounded-lg bg-bg-soft p-3 text-xs text-muted">
          {feishuConfigured ? (
            feishuBound ? (
              <>绑定后,系统会将任务指派、状态变更、@提及等通知实时推送到你的飞书。</>
            ) : (
              <>点击"绑定飞书"将跳转至飞书授权页面,授权后即可接收实时通知推送。</>
            )
          ) : (
            <>飞书集成尚未配置。管理员需在服务端设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量。</>
          )}
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