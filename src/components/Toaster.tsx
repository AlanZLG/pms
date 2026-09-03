// Toast 通知提示

import { useAppStore } from '@/stores/app'
import { CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Toaster() {
  const toast = useAppStore((s) => s.toast)
  const dismiss = useAppStore((s) => s.dismissToast)
  if (!toast) return null
  const Icon = toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? XCircle : Info
  const color =
    toast.type === 'success' ? 'text-ok' : toast.type === 'error' ? 'text-danger' : 'text-brand-soft'
  const handleUndo = () => {
    toast.onUndo?.()
    dismiss()
  }
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-pop-in">
      <div className="glass flex items-center gap-3 rounded-xl px-4 py-3 shadow-glow">
        <Icon className={cn('h-5 w-5', color)} />
        <span className="text-sm text-text-primary">{toast.message}</span>
        {toast.onUndo && (
          <button
            onClick={handleUndo}
            className="rounded-md px-2 py-1 text-xs font-medium text-brand-soft hover:bg-brand/10"
          >
            {toast.undoLabel || '撤销'}
          </button>
        )}
        <button onClick={dismiss} className="text-muted hover:text-text-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}