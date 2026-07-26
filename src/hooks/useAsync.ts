// 异步数据获取辅助 hook

import { useEffect, useState, useCallback } from 'react'

export function useAsync<T>(
  fn: () => Promise<T>,
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

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fn()
      setData(result)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, error, reload }
}