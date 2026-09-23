// 运维台账独立页面（全局视图）

import { ClipboardList } from 'lucide-react'
import OpLogsPanel from '@/components/OpLogsPanel'

export default function OpLogs() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand/15">
          <ClipboardList className="h-5 w-5 text-brand" />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold text-text-primary">运维台账/课题表</h1>
          <p className="text-xs text-muted">
            运维项目/运维增强登记台账，开发实施项目记录课题；按项目隔离管理，支持 Excel 批量导入 / 一键导出，字段可按需扩展
          </p>
        </div>
      </header>
      <OpLogsPanel />
    </div>
  )
}
