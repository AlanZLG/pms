// @vitest-environment jsdom
// ModalNavGuard（弹窗导航守卫）组件级测试：
// 全屏遮罩打开时拦截导航（push + POP 后退），关闭后恢复；验证排除规则

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
  Route,
} from 'react-router-dom'

import { ModalNavGuard } from '../src/components/ModalNavGuard'

// ---- jsdom + undici 领域不匹配补丁 ----
// react-router data router 发起导航时会用 jsdom 的 AbortSignal 创建 undici Request，
// 触发 brand check 失败（"Expected signal ... to be an instance of AbortSignal"）。
// 测试内无 loader，不需要取消语义，直接剥离 init.signal。
const UndiciRequest = globalThis.Request

globalThis.Request = new Proxy(UndiciRequest, {
  construct(target, args: unknown[]) {
    const [input, init] = args as [RequestInfo | URL, RequestInit?]
    if (init && 'signal' in init) {
      const rest = { ...init }
      delete rest.signal
      return Reflect.construct(target, [input, rest])
    }
    return Reflect.construct(target, args)
  },
}) as typeof Request

// ---- 测试页面：两个遮罩弹窗（z-50 与 z-[60]）+ 跳转按钮 ----
let routerRef: ReturnType<typeof createMemoryRouter> | null = null

function TestPage() {
  const [showA, setShowA] = useState(false)
  const [showB, setShowB] = useState(false)
  return (
    <div>
      <ModalNavGuard />
      <button onClick={() => setShowA(true)}>打开A</button>
      <button onClick={() => setShowB(true)}>打开B</button>
      <button onClick={() => routerRef?.navigate('/other')}>跳转</button>
      {showA && (
        <div className="fixed inset-0 z-50">
          <button onClick={() => setShowA(false)}>关闭A</button>
        </div>
      )}
      {showB && (
        <div className="fixed inset-0 z-[60]">
          <button onClick={() => setShowB(false)}>关闭B</button>
        </div>
      )}
    </div>
  )
}

function makeRouter(initialEntries: string[] = ['/']) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <>
        <Route path="/" element={<TestPage />} />
        <Route path="/other" element={<div>其他页面</div>} />
      </>,
    ),
    { initialEntries },
  )
  routerRef = router
  return router
}

// MutationObserver 回调走微任务，点击后 flush 一次再断言
async function flush() {
  await act(async () => {})
}

afterEach(cleanup)

describe('ModalNavGuard 弹窗导航守卫', () => {
  it('弹窗打开时拦截 push 导航，关闭后恢复', async () => {
    const user = userEvent.setup()
    const router = makeRouter()
    render(<RouterProvider router={router} />)
    expect(router.state.location.pathname).toBe('/')

    await user.click(screen.getByText('打开A'))
    await flush()
    await user.click(screen.getByText('跳转'))
    expect(router.state.location.pathname).toBe('/')

    await user.click(screen.getByText('关闭A'))
    await flush()
    await user.click(screen.getByText('跳转'))
    expect(router.state.location.pathname).toBe('/other')
  })

  it('多个弹窗叠加：全部关闭后才恢复导航', async () => {
    const user = userEvent.setup()
    const router = makeRouter()
    render(<RouterProvider router={router} />)

    await user.click(screen.getByText('打开A'))
    await user.click(screen.getByText('打开B'))
    await flush()

    await user.click(screen.getByText('跳转'))
    expect(router.state.location.pathname).toBe('/')

    await user.click(screen.getByText('关闭A'))
    await flush()
    await user.click(screen.getByText('跳转'))
    expect(router.state.location.pathname).toBe('/')

    await user.click(screen.getByText('关闭B'))
    await flush()
    await user.click(screen.getByText('跳转'))
    expect(router.state.location.pathname).toBe('/other')
  })

  it('浏览器后退（POP）被拦截并回滚，关闭弹窗后可后退', async () => {
    const user = userEvent.setup()
    const router = makeRouter(['/other', '/'])
    render(<RouterProvider router={router} />)
    expect(router.state.location.pathname).toBe('/')

    await user.click(screen.getByText('打开A'))
    await flush()

    await act(async () => {
      router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/')

    await user.click(screen.getByText('关闭A'))
    await flush()
    await act(async () => {
      router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/other')
  })

  it('排除规则：带 pointer-events-none / md:hidden 的全屏层不拦截', async () => {
    const user = userEvent.setup()
    const router = makeRouter()
    render(<RouterProvider router={router} />)

    // 关闭态 TaskDrawer（pointer-events-none）与移动端侧栏（md:hidden）的类名组合
    const el = document.createElement('div')
    el.className = 'fixed inset-0 z-40 pointer-events-none md:hidden'
    document.body.appendChild(el)
    await flush()

    await user.click(screen.getByText('跳转'))
    expect(router.state.location.pathname).toBe('/other')

    el.remove()
  })
})
