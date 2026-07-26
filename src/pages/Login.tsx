// 登录/注册页

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Sparkles, Mail, Lock, User as UserIcon, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { Button, Input } from '@/components/ui'
import { cn } from '@/lib/utils'

export default function Login({ mode = 'login' }: { mode?: 'login' | 'register' }) {
  const [m, setM] = useState<'login' | 'register'>(mode)
  const [email, setEmail] = useState('admin@pm.dev')
  const [password, setPassword] = useState('123456')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const login = useAppStore((s) => s.login)
  const register = useAppStore((s) => s.register)
  const loading = useAppStore((s) => s.loading)
  const notify = useAppStore((s) => s.notify)
  const navigate = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (m === 'login') {
        await login(email, password)
      } else {
        await register(name || '新用户', email, password)
      }
      notify('success', m === 'login' ? '登录成功' : '注册成功')
      navigate('/')
    } catch (err: any) {
      setError(err?.message || '操作失败')
    }
  }

  return (
    <div className="app-bg grid h-full min-h-0 lg:grid-cols-2">
      {/* 左侧品牌插画区 */}
      <div className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand/30 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-grad text-white shadow-glow">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <p className="font-display text-2xl text-white">Atlas</p>
            <p className="text-sm text-muted">让每一次推进,都被看见</p>
          </div>
        </div>

        <div className="relative z-10 max-w-md animate-fade-up">
          <h1 className="font-display text-5xl font-semibold leading-tight text-white">
            看板流转之间,
            <br />
            <span className="bg-gradient-to-r from-brand via-brand-soft to-cyan-300 bg-clip-text text-transparent">
              团队节奏尽在掌握
            </span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-300">
            从看板到燃尽图,从权限到协作 —— Atlas
            将项目交付链路上每一个关键节点浓缩为一张清晰可感的视图。
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-200">
            {['拖拽式看板,实时同步状态', '燃尽图与工作量统计', '精细的成员角色与权限'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-ok" /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 font-mono text-xs text-muted">
          v1.0 · 演示账号 admin@pm.dev / 123456
        </div>
      </div>

      {/* 右侧表单 */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="glass w-full max-w-md rounded-3xl p-8 shadow-glow animate-pop-in">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-grad text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="font-display text-xl text-white">Atlas 项目管理</p>
          </div>

          <div className="mb-6 flex rounded-xl bg-bg-soft p-1">
            {(['login', 'register'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setM(tab)}
                className={cn(
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition',
                  m === tab ? 'bg-brand text-white shadow-glow' : 'text-muted hover:text-slate-200',
                )}
              >
                {tab === 'login' ? '登 录' : '注 册'}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {m === 'register' && (
              <Field icon={<UserIcon className="h-4 w-4" />}>
                <Input
                  placeholder="昵称"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
            )}
            <Field icon={<Mail className="h-4 w-4" />}>
              <Input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field icon={<Lock className="h-4 w-4" />}>
              <Input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {m === 'login' ? '登录系统' : '创建账号'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted">
            {m === 'login' ? (
              <>
                还没有账号?
                <Link to="/register" className="ml-1 text-brand-soft hover:underline">
                  立即注册
                </Link>
              </>
            ) : (
              <>
                已有账号?
                <Link to="/login" className="ml-1 text-brand-soft hover:underline">
                  返回登录
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icon}</div>
      <div className="[&_input]:pl-10">{children}</div>
    </div>
  )
}