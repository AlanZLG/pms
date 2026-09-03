// 应用路由

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, lazy, Suspense } from 'react'
import { Sparkles } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import AppLayout from '@/components/AppLayout'
import Toaster from '@/components/Toaster'
import ErrorBoundary from '@/components/ErrorBoundary'
import { getToken } from '@/lib/api'

import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Projects from '@/pages/Projects'
import ProjectDetail from '@/pages/ProjectDetail'
import Team from '@/pages/Team'
import Roles from '@/pages/Roles'
import Notifications from '@/pages/Notifications'
import Settings from '@/pages/Settings'
import Trash from '@/pages/Trash'
import Templates from '@/pages/Templates'

const Stats = lazy(() => import('@/pages/Stats'))
const HoursReport = lazy(() => import('@/pages/HoursReport'))

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand/15">
          <Sparkles className="h-6 w-6 animate-pulse text-brand" />
        </div>
        <div className="font-display text-muted">加载中…</div>
      </div>
    </div>
  )
}

export default function App() {
  const init = useAppStore((s) => s.init)
  const initialized = useAppStore((s) => s.initialized)
  const user = useAppStore((s) => s.user)

  useEffect(() => {
    if (getToken()) init()
    else useAppStore.setState({ initialized: true })
  }, [init])

  if (!initialized) {
    return (
      <div className="app-bg flex h-full items-center justify-center">
        <div className="animate-pulse font-display text-muted">加载中…</div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Login mode="register" />} />
          <Route
            path="/*"
            element={
              user ? (
                <ProtectedShell>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route
                      path="/projects"
                      element={
                        <ErrorBoundary>
                          <Projects />
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/projects/:projectId"
                      element={
                        <ErrorBoundary>
                          <ProjectDetail />
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/stats"
                      element={
                        <ErrorBoundary>
                          <Suspense fallback={<PageFallback />}>
                            <Stats />
                          </Suspense>
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/hours"
                      element={
                        <ErrorBoundary>
                          <Suspense fallback={<PageFallback />}>
                            <HoursReport />
                          </Suspense>
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/team"
                      element={
                        <ErrorBoundary>
                          <Team />
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/roles"
                      element={
                        <ErrorBoundary>
                          <Roles />
                        </ErrorBoundary>
                      }
                    />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/trash" element={<Trash />} />
                    <Route path="/templates" element={<Templates />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </ProtectedShell>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
        </Routes>
        <Toaster />
      </Router>
    </ErrorBoundary>
  )
}

function ProtectedShell({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>
}