// 错误边界降级 UI（独立文件以满足 react-refresh only-export-components）

import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Button } from '@/components/ui'

export default function ErrorFallback({ error, onRefresh }: { error: Error | null; onRefresh: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="app-bg flex min-h-full items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-panel/70 p-8 shadow-card backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-danger/15 shadow-glow">
            <AlertTriangle className="h-8 w-8 text-danger" />
          </div>

          <h2 className="mt-6 font-display text-xl text-text-primary">页面出现错误</h2>

          <p className="mt-2 text-sm text-muted">
            很抱歉，页面在渲染时遇到了问题。您可以尝试刷新页面或返回首页继续使用。
          </p>

          {error && (
            <div className="mt-4 w-full rounded-lg border border-bg-border bg-bg-soft/80 p-3 text-left">
              <p className="text-xs font-medium text-text-secondary">错误信息</p>
              <p className="mt-1 break-all text-xs text-danger/90">
                {error.message || '未知错误'}
              </p>
            </div>
          )}

          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigate('/')}
              className="w-full sm:w-auto"
            >
              <Home className="h-4 w-4" />
              返回首页
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={onRefresh}
              className="w-full sm:w-auto"
            >
              <RotateCcw className="h-4 w-4" />
              刷新页面
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
