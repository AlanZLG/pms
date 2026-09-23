// 应用主布局:侧边栏 + 顶栏

import { type ReactNode, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderKanban,
  BarChart3,
  Users,
  Bell,
  Settings,
  LogOut,
  Menu,
  ChevronLeft,
  Sparkles,
  Sun,
  Moon,
  Trash2,
  Layers,
  Shield,
  ClipboardList,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useNotificationStore } from '@/stores/notifications'
import { useTheme } from '@/hooks/useTheme'
import { Avatar } from '@/components/ui'
import NotificationDropdown from '@/components/NotificationDropdown'
import GlobalSearch from '@/components/GlobalSearch'

const navItems = [
  { to: '/', label: '仪表板', icon: LayoutDashboard, end: true },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/stats', label: '统计', icon: BarChart3 },
  { to: '/hours', label: '工时报表', icon: BarChart3 },
  { to: '/op-logs', label: '运维台账/课题表', icon: ClipboardList },
  { to: '/team', label: '团队', icon: Users },
  { to: '/notifications', label: '通知', icon: Bell },
  { to: '/trash', label: '回收站', icon: Trash2 },
]

// 管理员专属菜单
const adminNavItems = [
  { to: '/templates', label: '项目模板', icon: Layers },
  { to: '/roles', label: '角色管理', icon: Shield },
]

export default function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)
  const nav = useNavigate()
  const fetchNotif = useNotificationStore((s) => s.fetch)
  const resetNotif = useNotificationStore((s) => s.reset)
  const startPolling = useNotificationStore((s) => s.startPolling)
  const stopPolling = useNotificationStore((s) => s.stopPolling)
  const { isDark, toggleTheme } = useTheme()

  useEffect(() => {
    if (user) {
      fetchNotif()
      startPolling()
    } else {
      stopPolling()
      resetNotif()
    }
    return () => stopPolling()
  }, [user, fetchNotif, resetNotif, startPolling, stopPolling])

  return (
    <div className="app-bg flex h-full min-h-0">
      {/* 侧边栏 */}
      <aside
        className={cn(
          'relative z-20 hidden flex-col border-r border-bg-border bg-bg-soft/80 backdrop-blur transition-all duration-300 md:flex',
          collapsed ? 'w-[76px]' : 'w-[232px]',
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-[240px] flex-col border-r border-bg-border bg-bg-soft">
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-bg-border bg-bg/70 px-4 py-3 backdrop-blur md:px-6">
          <button
            className="rounded-lg p-2 text-text-secondary hover:bg-bg-soft md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            className="hidden rounded-lg p-2 text-text-secondary hover:bg-bg-soft md:block"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>

          <div className="ml-auto flex items-center gap-3">
            <GlobalSearch />
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-muted hover:bg-bg-soft hover:text-text-primary transition-colors"
              title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <NotificationDropdown />
            <div className="hidden items-center gap-1.5 rounded-full border border-brand/30 bg-brand/5 px-3 py-1 text-xs text-brand-soft sm:flex">
              <Sparkles className="h-3.5 w-3.5" />
              Fortune PM
            </div>
            {user && (
              <div className="flex items-center gap-2">
                <Avatar name={user.name} color={user.avatarColor} size={32} />
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium leading-tight text-text-primary">{user.name}</p>
                  <p className="text-[11px] leading-tight text-muted">{roleLabel(user.role)}</p>
                </div>
                <button
                  onClick={() => {
                    logout()
                    nav('/login')
                  }}
                  className="ml-1 rounded-lg p-2 text-muted hover:bg-bg-soft hover:text-danger"
                  title="退出登录"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  const unread = useNotificationStore((s) => s.unread)
  const user = useAppStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  // 团队入口需要 team.view 权限（admin/finance/owner 或自定义角色授权）
  const canViewTeam =
    user?.role === 'admin' ||
    user?.role === 'finance' ||
    user?.role === 'owner' ||
    !!user?.customRole?.permissions?.some((p) => p.key === 'team.view')

  return (
    <>
      <div className="flex h-16 items-center gap-2.5 px-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-grad text-text-primary shadow-glow">
          <Sparkles className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div>
            <p className="font-display text-lg leading-none text-text-primary">Fortune</p>
            <p className="text-[11px] text-muted">项目管理系统</p>
          </div>
        )}
      </div>
      <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {navItems.filter((item) => item.to !== '/team' || canViewTeam).map((item) => {
          const isNotif = item.to === '/notifications'
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand/12 text-text-primary shadow-glow'
                    : 'text-muted hover:bg-bg-elev hover:text-text-primary',
                  collapsed && 'justify-center',
                )
              }
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {isNotif && unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[9px] font-semibold text-text-primary">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </span>
              {!collapsed && (
                <span className="flex-1">{item.label}</span>
              )}
              {!collapsed && isNotif && unread > 0 && (
                <span className="rounded-full bg-danger/20 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                  {unread}
                </span>
              )}
            </NavLink>
          )
        })}
        {/* 管理员专属菜单 */}
        {isAdmin && (
          <>
            <div className="my-2 border-t border-bg-border" />
            {adminNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand/12 text-text-primary shadow-glow'
                      : 'text-muted hover:bg-bg-elev hover:text-text-primary',
                    collapsed && 'justify-center',
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>
      <div className="border-t border-bg-border p-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
              isActive ? 'bg-brand/12 text-text-primary' : 'text-muted hover:bg-bg-elev hover:text-text-primary',
              collapsed && 'justify-center',
            )
          }
        >
          <Settings className="h-5 w-5" />
          {!collapsed && <span>设置</span>}
        </NavLink>
      </div>
    </>
  )
}

function roleLabel(role: string) {
  return role === 'admin' ? '系统管理员' : role === 'finance' ? '项目核算人员' : role === 'owner' ? '项目负责人' : role === 'guest' ? '访客' : '团队成员'
}