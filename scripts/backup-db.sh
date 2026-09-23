#!/bin/zsh
# SQLite 在线备份 + gzip 压缩 + 保留 30 天
# 用 .backup 命令走在线备份协议，服务运行中也能拿到一致快照（WAL 模式下直接 cp 会漏事务）
set -e
DB=/Volumes/DATA/Project/data/app.db
DIR=/Volumes/DATA/Project/data/backups/auto
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
sqlite3 "$DB" ".backup '$DIR/app-$STAMP.db'"
gzip -f "$DIR/app-$STAMP.db"
# 轮转：删除 30 天前的备份
find "$DIR" -name 'app-*.db.gz' -mtime +30 -delete
echo "$(date '+%F %T') backup ok: app-$STAMP.db.gz"
