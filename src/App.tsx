// 应用路由

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import AppLayout from '@/components/AppLayout'
import Toaster from '@/components/Toaster'
import { getToken } from '@/lib/api'

import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Projects from '@/pages/Projects'
import ProjectDetail from '@/pages/ProjectDetail'
import Stats from '@/pages/Stats'
import Team from '@/pages/Team'
import Settings from '@/pages/Settings'

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
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/projects/:projectId" element={<ProjectDetail />} />
                  <Route path="/stats" element={<Stats />} />
                  <Route path="/team" element={<Team />} />
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
  )
}

function ProtectedShell({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>
}