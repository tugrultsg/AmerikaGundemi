#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Volumes/Crucial X10/Claude Code Projects/AmerikaGundemi"
LOG_DIR="$HOME/.amerikagundemi/logs"
NODE_BIN="$HOME/.nvm/versions/node/v25.2.1/bin"
CODEX_RESOURCES="/Applications/Codex.app/Contents/Resources"
CODEX_PLUGIN="$HOME/.codex/plugins/.plugin-appserver"
HOMEBREW_BIN="/opt/homebrew/bin"
GH_CLI="$HOMEBREW_BIN/gh"

export PATH="$CODEX_RESOURCES:$CODEX_PLUGIN:$NODE_BIN:$HOMEBREW_BIN:$PATH"
export GIT_TERMINAL_PROMPT=0

if [ -x "$CODEX_RESOURCES/codex" ]; then
  export CODEX_CLI="$CODEX_RESOURCES/codex"
elif [ -x "$CODEX_PLUGIN/codex" ]; then
  export CODEX_CLI="$CODEX_PLUGIN/codex"
fi

mkdir -p "$LOG_DIR"

# Mount check
if [ ! -d "$PROJECT_DIR" ]; then
  echo "$(date): External volume not mounted, skipping" >> "$LOG_DIR/cron.log"
  exit 1
fi

cd "$PROJECT_DIR"

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  echo "$(date): Current branch is $branch, expected main; skipping scheduled pipeline run" >> "$LOG_DIR/pipeline-$(date +%Y-%m-%d).log"
  exit 1
fi

if [ -x "$GH_CLI" ]; then
  git config --local --unset-all credential.helper || true
  git config --local --add credential.helper ""
  git config --local --add credential.helper "!$GH_CLI auth git-credential"
  git config --local --unset-all credential.https://github.com.helper || true
  git config --local --add credential.https://github.com.helper ""
  git config --local --add credential.https://github.com.helper "!$GH_CLI auth git-credential"
fi

npx tsx pipeline/src/index.ts 2>&1 | tee -a "$LOG_DIR/pipeline-$(date +%Y-%m-%d).log"

# Log rotation: delete logs older than 30 days
find "$LOG_DIR" -name "*.log" -mtime +30 -delete
