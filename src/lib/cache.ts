// Stale-While-Revalidate 内存缓存（简单 TTL + 后台 revalidate）
import { useEffect, useState, useCallback, useRef } from 'react'

type CacheEntry<T> = { data: T; timestamp: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, CacheEntry<any>>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscribers = new Map<string, Set<(data: any) => void>>()

export const DEFAULT_TTL = 15_000  // 15 秒内认为新鲜
export const LONG_TTL    = 60_000  // 1 分钟

export function getCached<T>(key: string): T | undefined {
  const e = cache.get(key)
  return e?.data
}

export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
  subscribers.get(key)?.forEach((fn) => fn(data))
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) { cache.clear(); return }
  for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) cache.delete(k)
}

export function useSwr<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL
): { data?: T; loading: boolean; error?: Error; revalidate: () => Promise<void>; mutate: (v: T | ((p: T) => T)) => void } {
  const [, forceTick] = useState(0)
  const mounted = useRef(true)
  const fetching = useRef(false)

  const entry = key ? cache.get(key) : undefined
  const data: T | undefined = entry?.data
  const loading = !entry && !!key

  const revalidate = useCallback(async () => {
    if (!key || fetching.current) return
    fetching.current = true
    try {
      const fresh = await fetcher()
      cache.set(key, { data: fresh, timestamp: Date.now() })
      subscribers.get(key)?.forEach((fn) => fn(fresh))
      if (mounted.current) forceTick((v) => v + 1)
    } finally {
      fetching.current = false
    }
  }, [key, fetcher])

  const mutate = useCallback((v: T | ((p: T) => T)) => {
    if (!key) return
    const prev = cache.get(key)?.data
    const next = typeof v === 'function' ? (v as (p: T) => T)(prev as T) : v
    setCached(key, next)
  }, [key])

  useEffect(() => {
    mounted.current = true
    // 订阅同 key 的其他组件变更
    if (key) {
      if (!subscribers.has(key)) subscribers.set(key, new Set())
      const fn = () => { if (mounted.current) forceTick((v) => v + 1) }
      subscribers.get(key)!.add(fn)
      // 过期或不存在则后台刷新
      const age = entry ? Date.now() - entry.timestamp : Infinity
      if (!entry || age > ttl) revalidate()
      return () => {
        subscribers.get(key)?.delete(fn)
        mounted.current = false
      }
    }
    return () => { mounted.current = false }
  }, [key, entry, ttl, revalidate])

  return { data, loading, error: undefined, revalidate, mutate }
}
