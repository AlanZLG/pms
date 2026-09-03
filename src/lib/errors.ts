export interface ApiError extends Error { status?: number }

export function getErrorMessage(err: unknown, fallback = '操作失败'): string {
  if (err == null) return fallback
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  const e = err as Record<string, unknown>
  if (typeof e.message === 'string') return e.message
  if (typeof e.error === 'string') return e.error
  return fallback
}
