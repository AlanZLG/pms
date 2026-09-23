// 每日自动备份数据库（SQLite 在线备份协议 + gzip 压缩 + 保留 30 天）
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import db from '../db.ts'

const BACKUP_DIR = path.resolve(process.cwd(), 'data/backups/auto')
const RETENTION_DAYS = 30

const gzip = promisify(zlib.gzip)

/** 立即执行一次备份：在线快照 → gzip 压缩 → 轮转过期备份 */
export async function runBackupNow(): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rawPath = path.join(BACKUP_DIR, `app-${stamp}.db`)

  // better-sqlite3 的 backup 走 sqlite3_backup API，写入进行中也能拿到一致快照
  await db.backup(rawPath)
  const buf = await fs.promises.readFile(rawPath)
  await fs.promises.writeFile(`${rawPath}.gz`, await gzip(buf))
  fs.unlinkSync(rawPath)

  rotateOldBackups()
  console.log(`[backup] 数据库备份完成: app-${stamp}.db.gz`)
  return `${rawPath}.gz`
}

/** 删除超过保留期的旧备份 */
function rotateOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!/^app-.*\.db\.gz$/.test(f)) continue
    const full = path.join(BACKUP_DIR, f)
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full)
    } catch {
      // 文件可能已被并发清理，忽略
    }
  }
}

/** 注册每日 02:30 定时备份（应用运行期间生效，重启后重新对时） */
export function scheduleDailyBackup() {
  const delayToNext = () => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(2, 30, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next.getTime() - now.getTime()
  }
  const loop = () => {
    setTimeout(async () => {
      try {
        await runBackupNow()
      } catch (e) {
        console.error('[backup] 数据库备份失败:', e)
      }
      loop()
    }, delayToNext()).unref?.()
  }
  loop()
  console.log('[backup] 已注册每日 02:30 自动备份')
}
