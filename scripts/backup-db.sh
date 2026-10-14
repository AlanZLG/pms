#!/bin/bash
# 项目数据库每日备份：SQLite 一致性快照 + 完整性校验 + 轮转 + iCloud 异地同步
set -euo pipefail

PROJECT_DIR="/Volumes/DATA/Project"
DB="$PROJECT_DIR/data/app.db"
BACKUP_DIR="$PROJECT_DIR/data/backups"
ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/pms-backups"
KEEP_DAYS=1        # 本地保留 2 份（磁盘空间优先，异地 iCloud 为主）
ICLOUD_KEEP_DAYS=14
LOG="$BACKUP_DIR/backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y%m%d)
TARGET="$BACKUP_DIR/app-$STAMP.db"

# 一致性快照（.backup 会合并 WAL，正在写入也不丢数据）
if sqlite3 "$DB" ".backup '$TARGET'" 2>>"$LOG"; then
  log "备份完成: $TARGET ($(du -h "$TARGET" | cut -f1))"
else
  log "错误: sqlite3 .backup 失败"
  exit 1
fi

# 完整性校验，不合格的备份立即删除
if sqlite3 "$TARGET" "PRAGMA integrity_check;" | grep -q '^ok$'; then
  log "完整性校验通过"
else
  log "错误: 备份完整性校验失败，已删除 $TARGET"
  rm -f "$TARGET"
  exit 1
fi

# 轮转：删除超过保留期的旧备份
find "$BACKUP_DIR" -name 'app-*.db' -mtime +"$KEEP_DAYS" -delete
log "本地轮转完成（保留 ${KEEP_DAYS} 天）"

# 异地同步到 iCloud Drive
if [ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
  mkdir -p "$ICLOUD_DIR"
  cp -f "$TARGET" "$ICLOUD_DIR/"
  find "$ICLOUD_DIR" -name 'app-*.db' -mtime +"$ICLOUD_KEEP_DAYS" -delete
  log "已同步到 iCloud: $(basename "$TARGET")"
else
  log "跳过 iCloud 同步（未检测到 iCloud Drive）"
fi
