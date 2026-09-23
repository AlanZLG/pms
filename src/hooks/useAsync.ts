// 异步数据获取辅助 hook

import { useEffect, useState, useCallback, useRef } from 'react'
import { getErrorMessage } from '@/lib/errors'

export function useAsync<T>(
  fn: () => Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: any[] = [],
): {
  data: T | null
  loading: boolean
  error: string
  reload: () => Promise<void>
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 竞态防护：deps 快速连续变化时，只有最后一次请求的结果允许写入 state，
  // 防止先发后至的过期响应覆盖新数据（如筛选切换后界面停留在旧值）
  const seqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError('')
    try {
      const result = await fn()
      if (seq !== seqRef.current) return
      setData(result)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(getErrorMessage(e, '加载失败'))
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, error, reload }
}