// AI 排障助手抽屉（P2 对话式排障）：右侧滑出面板，基于台账召回的多轮流式问答
// 会话为无状态设计：前端持有完整历史随请求发送，刷新页面即清空

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Send, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
import { getErrorMessage } from '@/lib/errors'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import type { OpLogAiCase } from '../../shared/types'

// 单条消息渲染模型：assistant 消息附带本轮召回的案例列表（可点击跳转台账详情）
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  cases: OpLogAiCase[]
}

interface AiChatDrawerProps {
  /** 当前台账项目上下文（召回同项目加权）；全局视图不传 */
  projectId?: string
  /** 点击案例打开对应台账（复用台账页的详情/编辑链路） */
  onOpenCase: (id: string) => void
  onClose: () => void
}

const WELCOME_HINTS = [
  'ERP 报销单无法提交，如何排查？',
  '打印机脱机的常见原因有哪些？',
  'VPN 连接频繁掉线怎么处理？',
]

export default function AiChatDrawer({ projectId, onOpenCase, onClose }: AiChatDrawerProps) {
  const notify = useAppStore((s) => s.notify)
  const [model, setModel] = useState('')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  // 参考案例展开状态（按消息索引）：超过 4 条默认折叠，可展开全部
  const [expandedCases, setExpandedCases] = useState<Set<number>>(new Set())
  // 流式过程中正在生成的正文（完成后并入 msgs）
  const [liveText, setLiveText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.getOpLogAiStatus().then((s) => setModel(s.model)).catch(() => {})
    inputRef.current?.focus()
  }, [])

  // 消息或流式正文变化时滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, liveText])

  const send = async (questionArg?: string) => {
    const question = (questionArg ?? input).trim()
    if (!question || streaming) return
    const history: ChatMsg[] = [...msgs, { role: 'user', content: question, cases: [] }]
    setMsgs(history)
    setInput('')
    setStreaming(true)
    setLiveText('')

    const controller = new AbortController()
    abortRef.current = controller
    let live = ''
    let cases: OpLogAiCase[] = []
    try {
      await api.aiChatStream(
        { messages: history.map(({ role, content }) => ({ role, content })), projectId: projectId || undefined },
        {
          onCases: (cs) => {
            cases = cs
          },
          onDelta: (text) => {
            live += text
            setLiveText(live)
          },
        },
        controller.signal,
      )
      setMsgs((prev) => [...prev, { role: 'assistant', content: live, cases }])
    } catch (e) {
      if (controller.signal.aborted) {
        // 用户主动停止：保留已生成的部分
        if (live) setMsgs((prev) => [...prev, { role: 'assistant', content: live + '\n\n（已停止生成）', cases }])
      } else {
        notify('error', getErrorMessage(e, 'AI 助手回复失败'))
        // 服务端 error 事件前已生成的部分也保留，避免整轮丢失
        if (live) setMsgs((prev) => [...prev, { role: 'assistant', content: live, cases }])
      }
    } finally {
      setStreaming(false)
      setLiveText('')
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const caseCard = (c: OpLogAiCase) => (
    <button
      key={c.opLogId}
      onClick={() => onOpenCase(c.opLogId)}
      title={`${c.problem} —— ${c.solution || '（无解决方案）'}`}
      className="flex w-full items-center gap-2 rounded-md border border-bg-border bg-bg-soft/60 px-2 py-1 text-left text-xs transition hover:border-brand/40 hover:bg-brand/10"
    >
      <span className="min-w-0 flex-1 truncate text-text-secondary">{c.problem}</span>
      <span className="flex-shrink-0 text-muted">{Math.round(c.score * 100)}%</span>
    </button>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-bg-border bg-bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-bg-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-brand" />
            <div>
              <h3 className="text-sm font-medium text-text-primary">AI 排障助手</h3>
              {model && <p className="text-xs text-muted">基于台账经验 · {model}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-muted transition hover:text-text-primary" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 消息区 */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && !streaming && (
            <div className="rounded-xl border border-bg-border bg-bg-soft/50 p-4 text-sm text-muted">
              <p>描述你遇到的问题，我会检索台账中的相似案例给出排查建议。</p>
              <p className="mt-2 text-xs">试试：</p>
              <ul className="mt-1 space-y-1">
                {WELCOME_HINTS.map((h) => (
                  <li key={h}>
                    <button
                      onClick={() => void send(h)}
                      className="text-left text-brand-soft transition hover:underline"
                    >
                      {h}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="space-y-2">
                <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-bg-soft px-3.5 py-2 text-sm text-text-primary">
                  {m.content}
                </div>
                {m.cases.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted">参考案例（{m.cases.length}）</p>
                    {(expandedCases.has(i) ? m.cases : m.cases.slice(0, 4)).map(caseCard)}
                    {m.cases.length > 4 && (
                      <button
                        onClick={() =>
                          setExpandedCases((prev) => {
                            const next = new Set(prev)
                            if (next.has(i)) next.delete(i)
                            else next.add(i)
                            return next
                          })
                        }
                        className="text-xs text-brand-soft transition hover:underline"
                      >
                        {expandedCases.has(i) ? '收起案例' : `展开全部 ${m.cases.length} 条案例`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ),
          )}

          {/* 流式生成中 */}
          {streaming && !liveText && <p className="text-xs text-muted">正在检索台账案例…</p>}
          {streaming && liveText && (
            <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-bg-soft px-3.5 py-2 text-sm text-text-primary">
              {liveText}
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-bg-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="描述问题，Enter 发送 / Shift+Enter 换行"
              className="flex-1 resize-none rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand/40"
            />
            {streaming ? (
              <button
                onClick={stop}
                title="停止生成"
                className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-bg-border text-text-secondary transition hover:text-text-primary')}
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!input.trim()}
                title="发送"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
