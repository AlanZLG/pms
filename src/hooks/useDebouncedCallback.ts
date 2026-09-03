import { useCallback, useRef, useEffect } from 'react'
export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T, delay: number = 300
): (...args: Parameters<T>) => void {
  const ref = useRef({ timer: null as ReturnType<typeof setTimeout> | null, cb: callback })
  useEffect(() => { ref.current.cb = callback }, [callback])
  return useCallback((...args: Parameters<T>) => {
    if (ref.current.timer) clearTimeout(ref.current.timer)
    ref.current.timer = setTimeout(() => ref.current.cb(...args), delay)
  }, [delay])
}
