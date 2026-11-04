// 全局弹窗导航守卫：弹窗未关闭时禁止路由跳转（含浏览器前进/后退）
// 原理：MutationObserver 监听整个 body，检测是否存在「全屏遮罩」元素
// （fixed + inset-0 + z-40/z-50/z-[nn]），有则视为弹窗打开，useBlocker 拦截导航。
// 无需逐个弹窗接线，现有与新增弹窗自动覆盖。

import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/** 模块级状态：当前是否有全屏遮罩打开（blocker 回调同步读取） */
let overlayOpen = false

/** 判断 class 列表是否为「全屏遮罩」：
 *  必须同时含 fixed + inset-0 + 显式高 z-index；
 *  排除移动端侧栏遮罩（md:hidden）与鼠标穿透层（pointer-events-none，如关闭态的 TaskDrawer） */
function isBlockingOverlay(className: string): boolean {
  const tokens = className.split(/\s+/)
  if (!tokens.includes('fixed') || !tokens.includes('inset-0')) return false
  if (tokens.includes('md:hidden') || tokens.includes('pointer-events-none')) return false
  // z-40 / z-50 / z-[nn]（token 精确匹配，避免误伤 -z-[5] 等负值装饰层）
  return tokens.some((t) => /^z-(?:40|50|\[\d+\])$/.test(t))
}

function hasBlockingOverlay(): boolean {
  const candidates = document.body.querySelectorAll('.fixed.inset-0')
  for (const el of candidates) {
    if (isBlockingOverlay(el.getAttribute('class') ?? '')) return true
  }
  return false
}

/** 挂在应用根部的守卫组件：有全屏遮罩时拦截所有导航
 *  （POP 导航被回滚原地，push/replace 被丢弃），弹窗关闭后自动恢复 */
export function ModalNavGuard() {
  const blocker = useBlocker(() => overlayOpen)
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset()
  }, [blocker])

  useEffect(() => {
    overlayOpen = hasBlockingOverlay()
    const observer = new MutationObserver(() => {
      overlayOpen = hasBlockingOverlay()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => {
      observer.disconnect()
      overlayOpen = false
    }
  }, [])

  return null
}
