// 通用工具函数

export function genId(): string {
  return crypto.randomUUID()
}

// 按北京时间（UTC+8）计算的日历日期 YYYY-MM-DD，用于"自动生成日期"类字段（台账工时入账日期、导出登记日期等）。
// 不能用 toISOString().slice(0, 10)：那是 UTC 日期，东八区 0-8 点会算成前一天；
// 且服务器可能部署在 UTC 时区（如 Vercel），故显式加 8 小时偏移而非依赖服务器本地时区
export function beijingDate(d: Date | string = new Date()): string {
  const t = typeof d === 'string' ? new Date(d) : d
  const u = new Date(t.getTime() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${u.getUTCFullYear()}-${p(u.getUTCMonth() + 1)}-${p(u.getUTCDate())}`
}

// 北京日历上 N 天前的日期（YYYY-MM-DD）。与 th.date / log_date 这类北京日期列做窗口下界比较时用，
// 不能用 new Date(Date.now() - N*86400000).toISOString().slice(0, 10)：UTC 日期在东八区 0-8 点会少算一天
export function beijingDaysAgo(days: number): string {
  return beijingDate(new Date(Date.now() - days * 86400000))
}

// 统一错误对象
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// 解析 labels JSON,Memo 化
export function parseLabels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }
}