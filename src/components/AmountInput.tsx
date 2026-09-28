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
 * - 聚焦全选直接替换输入 / 失焦千分位展示；键盘输入精确到元，支持「3.5万」单位
 * - ↑/↓ 键按 100 步进（自动截断到 [min, max]）；+1千/+1万/+5万 点击累加，清零一键归零
 * - 传 max 时超出显示红框警示；传 min 时低于显示红框警示（步进/快捷按钮截断到下限）
 * - 键入格式无效时红框提示，失焦自动回退上一有效值；onEnter 支持回车快捷提交
 */
export default function AmountInput({ value, onChange, max, min, onEnter, placeholder = '0' }: {
  value: number
  onChange: (v: number) => void
  /** 上限金额（如总预算剩余可分配额度）：超出红框警示，步进/快捷按钮自动截断 */
  max?: number
  /** 下限金额（如该类别已发生支出）：低于红框警示，步进/快捷按钮自动抬到下限 */
  min?: number
  /** 回车快捷提交（modal 表单场景） */
  onEnter?: () => void
  placeholder?: string
}) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const display = focused ? text : (value ? value.toLocaleString() : '')
  const invalid = focused && text !== '' && parseAmountText(text) === null
  const overMax = max != null && value > max
  const underMin = min != null && value < min - 1e-9
  const error = invalid || overMax || underMin
  const apply = (v: number) => {
    let next = Math.max(Math.round(v * 100) / 100, 0)
    if (max != null) next = Math.min(next, max)
    if (min != null) next = Math.max(next, min)
    onChange(next)
    setText(String(next))
  }
  return (
    <div>
      <Input
        inputMode="decimal"
        value={display}
        placeholder={placeholder}
        aria-invalid={error}
        className={error ? 'border-danger focus:border-danger focus:ring-danger/30' : undefined}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseAmountText(e.target.value)
          if (v !== null) onChange(v)
        }}
        onFocus={(e) => {
          // 保留千分位文本（parse 已兼容逗号）：若切换裸数字，受控 value 跳变会丢失 select() 选区
          setFocused(true)
          setText(e.target.value)
          // 全选便于直接输入替换，无需手动清除旧值
          e.target.select()
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); apply(value + 100) }
          if (e.key === 'ArrowDown') { e.preventDefault(); apply(value - 100) }
          if (e.key === 'Enter') onEnter?.()
        }}
      />
      {invalid && <p className="mt-1 text-xs text-danger">金额格式无效，支持数字或「3.5万」写法</p>}
      {overMax && <p className="mt-1 text-xs text-danger">超出上限 ¥{max!.toLocaleString()}</p>}
      {underMin && <p className="mt-1 text-xs text-danger">低于已发生支出 ¥{min!.toLocaleString()}</p>}
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
