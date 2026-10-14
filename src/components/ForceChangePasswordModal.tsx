// 强制修改密码弹窗（新建账号首次登录时不可关闭）
// 触发条件：user.mustChangePassword === true，改密成功后由 store 刷新自动消失

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { api, setToken } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Button, Input } from '@/components/ui'
import { useAppStore } from '@/stores/app'

export default function ForceChangePasswordModal() {
  const notify = useAppStore((s) => s.notify)
  const setUser = useAppStore((s) => s.setUser)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setError('')
    if (!form.currentPassword || !form.newPassword) {
      setError('请填写完整')
      return
    }
    if (form.newPassword.length < 5) {
      setError('新密码至少 5 位')
      return
    }
    if (form.newPassword === form.currentPassword) {
      setError('新密码不能与当前密码相同')
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setSaving(true)
    try {
      const { token } = await api.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      })
      // 后端改密会使旧 token 失效，换用新 token 并刷新用户信息（mustChangePassword 已清除）
      if (token) setToken(token)
      const { user } = await api.me()
      setUser(user)
      notify('success', '密码修改成功，请牢记新密码')
    } catch (e) {
      setError(getErrorMessage(e, '修改失败'))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl animate-fade-up">
        <div className="mb-1 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-medium text-text-primary">请先修改初始密码</h3>
        </div>
        <p className="mb-5 text-xs text-muted">为了账号安全，首次登录需要设置新密码后才能继续使用系统</p>

        <div className="space-y-3">
          <Input
            type="password"
            placeholder="当前密码"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          />
          <Input
            type="password"
            placeholder="新密码（至少 5 位）"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          />
          <Input
            type="password"
            placeholder="确认新密码"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <Button className="mt-5 w-full" onClick={submit} disabled={saving}>
          {saving ? '提交中…' : '确认修改'}
        </Button>
      </div>
    </div>,
    document.body,
  )
}
