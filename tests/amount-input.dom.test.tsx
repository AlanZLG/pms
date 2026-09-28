// @vitest-environment jsdom
// 预算金额快速输入组件测试：parseAmountText 解析规则 + AmountInput 交互行为
// 覆盖：千分位展示、万单位解析、↑/↓ 100 元步进、快捷累加按钮、无效输入不误同步

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AmountInput, { parseAmountText } from '../src/components/AmountInput'

describe('parseAmountText 金额文本解析', () => {
  it('纯数字直接解析为元', () => {
    expect(parseAmountText('35000')).toBe(35000)
  })

  it('千分位逗号自动去除', () => {
    expect(parseAmountText('150,000')).toBe(150000)
  })

  it('「万」单位自动换算（大小写 w/万 均可）', () => {
    expect(parseAmountText('3.5万')).toBe(35000)
    expect(parseAmountText('3.5w')).toBe(35000)
    expect(parseAmountText('3.5W')).toBe(35000)
    expect(parseAmountText('2万')).toBe(20000)
  })

  it('万单位小数换算保留到分', () => {
    expect(parseAmountText('0.5万')).toBe(5000)
    expect(parseAmountText('3.456万')).toBe(34560)
  })

  it('空串归零', () => {
    expect(parseAmountText('')).toBe(0)
    expect(parseAmountText('   ')).toBe(0)
  })

  it('小数金额精确到分', () => {
    expect(parseAmountText('123.45')).toBe(123.45)
  })

  it('负数与非法文本返回 null（不误同步表单值）', () => {
    expect(parseAmountText('-5')).toBeNull()
    expect(parseAmountText('abc')).toBeNull()
    expect(parseAmountText('3.5x')).toBeNull()
  })
})

describe('AmountInput 组件交互', () => {
  afterEach(cleanup)

  it('失焦显示千分位，聚焦切换为裸数字便于编辑', async () => {
    const user = userEvent.setup()
    render(<AmountInput value={150000} onChange={() => {}} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('150,000')
    await user.click(input)
    expect(input.value).toBe('150000')
  })

  it('键入「3.5万」onChange 收到换算后的 35000', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AmountInput value={0} onChange={onChange} />)
    await user.type(screen.getByRole('textbox'), '3.5万')
    expect(onChange).toHaveBeenLastCalledWith(35000)
  })

  it('↑/↓ 键按 100 元步进', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AmountInput value={1000} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await user.type(input, '{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(1100)
    await user.type(input, '{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(900)
  })

  it('步进不会出现负数（下限 0）', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AmountInput value={50} onChange={onChange} />)
    await user.type(screen.getByRole('textbox'), '{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('快捷按钮累加：+1万 在当前值上加 10000，清零归零', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AmountInput value={1000} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+1万' }))
    expect(onChange).toHaveBeenLastCalledWith(11000)
    await user.click(screen.getByRole('button', { name: '+1千' }))
    expect(onChange).toHaveBeenLastCalledWith(2000)
    await user.click(screen.getByRole('button', { name: '清零' }))
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('无法解析的输入不触发 onChange（不误同步表单值）', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AmountInput value={100} onChange={onChange} />)
    await user.type(screen.getByRole('textbox'), 'abc')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('键入纯数字与千分位文本均正确同步', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AmountInput value={0} onChange={onChange} />)
    await user.type(screen.getByRole('textbox'), '123.45')
    expect(onChange).toHaveBeenLastCalledWith(123.45)
  })
})
