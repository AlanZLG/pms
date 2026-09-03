// 项目成员批量导入对话框

import React, { useState, useCallback, useRef } from 'react'
import { Upload, Download, X, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'

interface MemberImportDialogProps {
  projectId: string
  open: boolean
  onClose: () => void
  onImported: () => void
}

interface ImportResult {
  success: { email: string; name: string; role: string }[]
  skipped: { email: string; reason: string }[]
  errors: { row: number; email?: string; error: string }[]
}

export default function MemberImportDialog({
  projectId,
  open,
  onClose,
  onImported
}: MemberImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      validateAndSetFile(droppedFile)
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      validateAndSetFile(selectedFile)
    }
  }, [])

  const validateAndSetFile = (file: File) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls']
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    
    if (!allowedTypes.includes(ext)) {
      setError('不支持的文件格式，请使用 CSV 或 Excel 文件')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('文件大小不能超过 5MB')
      return
    }

    setFile(file)
    setError(null)
    setResult(null)
  }

  const handleImport = useCallback(async () => {
    if (!file) return

    setImporting(true)
    setError(null)

    try {
      const res = await api.importMembers(projectId, file)
      setResult(res.results)
      onImported()
    } catch (e) {
      setError(getErrorMessage(e, '导入失败'))
    } finally {
      setImporting(false)
    }
  }, [projectId, file, onImported])

  const handleDownloadTemplate = useCallback(async () => {
    try {
      await api.downloadMemberImportTemplate(projectId)
    } catch (e) {
      setError(getErrorMessage(e, '下载模板失败'))
    }
  }, [projectId])

  const handleClose = useCallback(() => {
    setFile(null)
    setResult(null)
    setError(null)
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-bg-panel shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-bg-border px-6 py-4">
          <h3 className="text-lg font-semibold text-text-primary">批量导入项目成员</h3>
          <button
            onClick={handleClose}
            className="text-muted transition hover:text-text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 说明 */}
          <div className="rounded-lg bg-brand/5 border border-brand/20 p-4">
            <p className="text-sm text-text-secondary">
              支持导入 CSV 和 Excel 文件，文件格式：邮箱、姓名、角色（可选）
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownloadTemplate}
              className="mt-2"
            >
              <Download className="h-3.5 w-3.5" />
              下载导入模板
            </Button>
          </div>

          {/* 文件上传区域 */}
          {!result && (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition ${
                isDragging
                  ? 'border-brand bg-brand/5'
                  : file
                    ? 'border-ok bg-ok/5'
                    : 'border-bg-border hover:border-brand/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="space-y-2">
                  <CheckCircle className="h-12 w-12 mx-auto text-ok" />
                  <p className="text-sm font-medium text-text-primary">{file.name}</p>
                  <p className="text-xs text-muted">{(file.size / 1024).toFixed(2)} KB</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFile(null)
                      if (fileInputRef.current) {
                        fileInputRef.current.value = ''
                      }
                    }}
                  >
                    重新选择
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-12 w-12 mx-auto text-muted" />
                  <p className="text-sm text-muted">
                    拖拽文件到这里，或{' '}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-brand hover:underline"
                    >
                      点击选择文件
                    </button>
                  </p>
                  <p className="text-xs text-muted">支持 CSV、Excel 格式，最大 5MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-danger" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {/* 导入结果 */}
          {result && (
            <div className="space-y-4">
              {/* 成功 */}
              {result.success.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-ok" />
                    <span className="text-sm font-medium text-ok">
                      成功导入 {result.success.length} 个成员
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-bg-border bg-bg/30 p-3">
                    <table className="w-full text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="text-left py-1">邮箱</th>
                          <th className="text-left py-1">姓名</th>
                          <th className="text-left py-1">角色</th>
                        </tr>
                      </thead>
                      <tbody className="text-text-secondary">
                        {result.success.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-1">{item.email}</td>
                            <td className="py-1">{item.name}</td>
                            <td className="py-1">{item.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 跳过 */}
              {result.skipped.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warn" />
                    <span className="text-sm font-medium text-warn">
                      跳过 {result.skipped.length} 个成员
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-bg-border bg-bg/30 p-3">
                    <table className="w-full text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="text-left py-1">邮箱</th>
                          <th className="text-left py-1">原因</th>
                        </tr>
                      </thead>
                      <tbody className="text-text-secondary">
                        {result.skipped.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-1">{item.email}</td>
                            <td className="py-1">{item.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 错误 */}
              {result.errors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-danger" />
                    <span className="text-sm font-medium text-danger">
                      {result.errors.length} 个错误
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-bg-border bg-bg/30 p-3">
                    <table className="w-full text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="text-left py-1">行号</th>
                          <th className="text-left py-1">邮箱</th>
                          <th className="text-left py-1">错误</th>
                        </tr>
                      </thead>
                      <tbody className="text-text-secondary">
                        {result.errors.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-1">{item.row}</td>
                            <td className="py-1">{item.email || '-'}</td>
                            <td className="py-1 text-danger">{item.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 border-t border-bg-border px-6 py-4">
          <Button variant="ghost" onClick={handleClose}>
            {result ? '关闭' : '取消'}
          </Button>
          {!result && (
            <Button
              onClick={handleImport}
              disabled={!file || importing}
            >
              {importing ? '导入中...' : '开始导入'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}