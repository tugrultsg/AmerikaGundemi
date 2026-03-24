#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Volumes/Crucial X10/Claude Code Projects/AmerikaGundemi"
LOG_DIR="$HOME/.amerikagundemi/logs"

mkdir -p "$LOG_DIR"

# Mount check
if [ ! -d "$PROJECT_DIR" ]; then
  echo "$(date): External volume not mounted, skipping" >> "$LOG_DIR/cron.log"
  exit 1
fi

cd "$PROJECT_DIR"
npx tsx pipeline/src/index.ts 2>&1 | tee -a "$LOG_DIR/pipeline-$(date +%Y-%m-%d).log"

# Log rotation: delete logs older than 30 days
find "$LOG_DIR" -name "*.log" -mtime +30 -delete
