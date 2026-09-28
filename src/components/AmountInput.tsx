// 金额快速输入组件（v1.9.4）：从 BudgetPanel 抽离，供预算/支出/总预算等表单复用
import { useState } from 'react'
import { Input } from '@/components/ui'

/** 解析金额文本：支持纯数字（含千分位逗号）与「3.5万/3.5w」单位写法；无法解析返回 null */
export function parseAmountText(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '')
  if (!t) return 0
  const wan = t.match(/^(\d+(?:\.\d+)?)[万wW]$/)
  if (wan) return Math.round(parseFloat(wan[1]) * 10000 * 100) / 100
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const QUICK_AMOUNTS = [
  { label: '+1千', delta: 1000 },
  { label: '+1万', delta: 10000 },
  { label: '+5万', delta: 50000 },
]

/**
 * 金额快速输入：
 * - 聚焦编辑裸数字 / 失焦千分位展示；键盘输入精确到元，支持「3.5万」单位
 * - ↑/↓ 键按 100 步进；+1千/+1万/+5万 点击累加，清零一键归零
 */
export default function AmountInput({ value, onChange, placeholder = '0' }: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const display = focused ? text : (value ? value.toLocaleString() : '')
  const apply = (v: number) => {
    const next = Math.max(Math.round(v * 100) / 100, 0)
    onChange(next)
    setText(String(next))
  }
  return (
    <div>
      <Input
        inputMode="decimal"
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseAmountText(e.target.value)
          if (v !== null) onChange(v)
        }}
        onFocus={(e) => { setFocused(true); setText(e.target.value ? String(parseAmountText(e.target.value) ?? value) : '') }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); apply(value + 100) }
          if (e.key === 'ArrowDown') { e.preventDefault(); apply(value - 100) }
        }}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {QUICK_AMOUNTS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => apply(value + q.delta)}
            className="rounded-md border border-bg-border bg-bg-soft px-2 py-0.5 text-xs text-muted transition hover:border-brand/40 hover:text-text-primary"
          >
            {q.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => apply(0)}
          className="rounded-md border border-bg-border bg-bg-soft px-2 py-0.5 text-xs text-muted transition hover:border-danger/40 hover:text-danger"
        >
          清零
        </button>
      </div>
    </div>
  )
}
