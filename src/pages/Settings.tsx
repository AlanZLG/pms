// 设置页

import { useState, useRef } from 'react'
import { useAppStore } from '@/stores/app'
import { Card, Avatar, Button, Input } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { Download, Upload, Database, AlertTriangle, KeyRound } from 'lucide-react'

export default function Settings() {
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)
  const setUser = useAppStore((s) => s.setUser)
  const me = useAsync(() => api.me(), [])
  const feishu = useAsync(() => api.getFeishuStatus(), [])
  const [binding, setBinding] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInfo = useAsync(() => api.getBackupInfo(), [])
  const notify = useAppStore((s) => s.notify)
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwdError, setPwdError] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  async function handleChangePassword() {
    setPwdError('')
    if (!pwdForm.currentPassword || !pwdForm.newPassword) {
      setPwdError('请填写完整')
      return
    }
    if (pwdForm.newPassword.length < 5) {
      setPwdError('新密码至少 5 位')
      return
    }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setPwdError('两次输入的新密码不一致')
      return
    }
    try {
      setPwdSaving(true)
      await api.changePassword({ currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword })
      notify('success', '密码修改成功，下次登录请使用新密码')
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (e) {
      setPwdError(getErrorMessage(e, '修改失败'))
    } finally {
      setPwdSaving(false)
    }
  }

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
    } catch {
      // 忽略飞书解绑失败错误
    } finally {
      setBinding(false)
    }
  }

  async function handleUnbind() {
    try {
      await api.unbindFeishu()
      await feishu.reload()
    } catch {
      // 忽略飞书解绑错误
    }
  }

  async function handleSaveName() {
    if (!newName.trim()) {
      setNameError('昵称不能为空')
      return
    }
    try {
      setSaving(true)
      setNameError('')
      const { user: updated } = await api.updateProfile({ name: newName.trim() })
      setUser(updated)
      await me.reload()
      setEditingName(false)
      setNewName('')
    } catch (e) {
      setNameError(getErrorMessage(e, '修改失败'))
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    setEditingName(false)
    setNewName('')
    setNameError('')
  }

  async function handleDownloadBackup() {
    try {
      notify('success', '正在准备备份文件...')
      const blob = await api.downloadBackup()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `atlas-backup-${timestamp}.db`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      notify('success', '备份下载成功')
    } catch (e) {
      notify('error', getErrorMessage(e, '备份下载失败'))
    }
  }

  async function handleRestoreFromFile(file: File) {
    if (!confirm('恢复备份将覆盖当前数据库，此操作不可撤销。确定要继续吗？')) return
    try {
      setRestoring(true)
      await api.restoreBackup(file)
      notify('success', '数据库已恢复，正在刷新...')
      setTimeout(() => window.location.reload(), 1500)
    } catch (e) {
      notify('error', getErrorMessage(e, '恢复失败'))
      setRestoring(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-up">
      <div>
        <h2 className="font-display text-2xl text-text-primary">个人设置</h2>
        <p className="mt-1 text-sm text-muted">查看你的账户信息与偏好</p>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={info.name} color={info.avatarColor} size={56} />
          <div className="flex-1">
            {editingName ? (
              <div className="space-y-2">
                <Input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value)
                    setNameError('')
                  }}
                  placeholder="输入新昵称"
                  maxLength={40}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName()
                    if (e.key === 'Escape') handleCancelEdit()
                  }}
                />
                {nameError && <p className="text-xs text-red-400">{nameError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveName} disabled={saving}>
                    {saving ? '保存中...' : '保存'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="font-display text-xl text-text-primary">{info.name}</p>
                <p className="text-sm text-muted">{info.email}</p>
                <p className="mt-1 text-xs text-brand-soft">{roleLabel(info.role)}</p>
                <Button variant="ghost" size="sm" className="mt-2 p-0 h-auto text-xs" onClick={() => setEditingName(true)}>
                  修改昵称
                </Button>
              </div>
            )}
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
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/20">
            <KeyRound className="h-5 w-5 text-brand" />
          </div>
          <div>
            <p className="font-display text-text-primary">修改密码</p>
            <p className="text-sm text-muted">定期更换密码以保障账号安全</p>
          </div>
        </div>
        <div className="space-y-3 max-w-sm">
          <div>
            <label className="text-sm text-muted mb-1 block">当前密码</label>
            <Input type="password" value={pwdForm.currentPassword} onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })} autoComplete="current-password" />
          </div>
          <div>
            <label className="text-sm text-muted mb-1 block">新密码（至少 5 位）</label>
            <Input type="password" value={pwdForm.newPassword} onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })} autoComplete="new-password" />
          </div>
          <div>
            <label className="text-sm text-muted mb-1 block">确认新密码</label>
            <Input type="password" value={pwdForm.confirmPassword} onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })} autoComplete="new-password" onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword() }} />
          </div>
          {pwdError && <p className="text-xs text-red-400">{pwdError}</p>}
          <Button onClick={handleChangePassword} disabled={pwdSaving}>
            {pwdSaving ? '保存中...' : '修改密码'}
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
              <p className="font-display text-text-primary">飞书集成</p>
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

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/20">
              <Database className="h-5 w-5 text-brand" />
            </div>
            <div>
              <p className="font-display text-text-primary">数据备份</p>
              <p className="text-sm text-muted">导出或恢复 SQLite 数据库文件</p>
            </div>
          </div>
          {backupInfo.loading ? (
            <span className="text-sm text-muted">加载中...</span>
          ) : backupInfo.data ? (
            <div className="text-right text-xs text-muted">
              <div>大小: {backupInfo.data.sizeKB} KB</div>
              <div>修改: {new Date(backupInfo.data.modifiedAt).toLocaleString()}</div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleDownloadBackup}>
            <Download className="mr-1.5 h-4 w-4" />
            下载备份
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleRestoreFromFile(file)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />
          <Button
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {restoring ? '恢复中...' : '上传恢复'}
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <strong>恢复注意事项:</strong> 上传的备份文件将覆盖当前所有数据，操作不可撤销。建议先下载一份当前备份再进行恢复。
          </div>
        </div>
      </Card>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <p className={mono ? 'break-all font-mono text-xs text-text-secondary' : 'text-text-secondary'}>{value}</p>
    </div>
  )
}

function roleLabel(role: string) {
  return role === 'admin' ? '系统管理员' : role === 'owner' ? '项目负责人' : role === 'guest' ? '访客' : '团队成员'
}