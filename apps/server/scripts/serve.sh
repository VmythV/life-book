#!/bin/sh
# 日常使用时长期运行的服务端：先迁移数据库，再启动服务（不监听文件变化），同时提供 ../web/dist 里的 Web 页面。
# macOS 上用 caffeinate 防止电脑空闲时睡眠，睡眠后手机就连不上了。
set -e
cd "$(dirname "$0")/.."
tsx src/scripts/migrate.ts
export WEB_DIST_DIR="${WEB_DIST_DIR:-../web/dist}"
if command -v caffeinate >/dev/null 2>&1; then
  exec caffeinate -i tsx src/index.ts
fi
exec tsx src/index.ts
