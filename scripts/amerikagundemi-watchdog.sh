#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Volumes/Crucial X10/Claude Code Projects/AmerikaGundemi"
STATE_DIR="$HOME/.amerikagundemi"
LOG_DIR="$STATE_DIR/logs"
DB_PATH="$STATE_DIR/pipeline.db"
UNTIL_FILE="$STATE_DIR/watchdog-until"
NODE_BIN="$HOME/.nvm/versions/node/v25.2.1/bin"
CODEX_RESOURCES="/Applications/Codex.app/Contents/Resources"
CODEX_PLUGIN="$HOME/.codex/plugins/.plugin-appserver"
HOMEBREW_BIN="/opt/homebrew/bin"
GH_CLI="$HOMEBREW_BIN/gh"

export PATH="$CODEX_RESOURCES:$CODEX_PLUGIN:$NODE_BIN:$HOMEBREW_BIN:$PATH"
export GIT_TERMINAL_PROMPT=0

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/watchdog-$(date +%Y-%m-%d).log" 2>&1

echo "[$(timestamp)] watchdog starting"

if [ -f "$UNTIL_FILE" ]; then
  now_epoch="$(date +%s)"
  until_epoch="$(cat "$UNTIL_FILE")"
  if [ "$now_epoch" -gt "$until_epoch" ]; then
    echo "[$(timestamp)] watchdog window expired"
    exit 0
  fi
fi

if [ ! -d "$PROJECT_DIR" ]; then
  echo "[$(timestamp)] project directory missing: $PROJECT_DIR"
  exit 1
fi

cd "$PROJECT_DIR"

if [ -x "$GH_CLI" ]; then
  git config --local --unset-all credential.helper || true
  git config --local --add credential.helper ""
  git config --local --add credential.helper "!$GH_CLI auth git-credential"
  git config --local --unset-all credential.https://github.com.helper || true
  git config --local --add credential.https://github.com.helper ""
  git config --local --add credential.https://github.com.helper "!$GH_CLI auth git-credential"
fi

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  echo "[$(timestamp)] current branch is $branch, expected main"
  exit 1
fi

git fetch origin main
git merge --ff-only origin/main || true

formatted_count="$(sqlite3 "$DB_PATH" "select count(*) from videos where status='formatted';")"
ahead_count="$(git rev-list --count origin/main..HEAD)"

echo "[$(timestamp)] formatted=$formatted_count ahead=$ahead_count"

if [ "$formatted_count" -gt 0 ]; then
  npx tsx pipeline/src/index.ts --publish-formatted-only --skip-twitter
fi

git fetch origin main
ahead_count="$(git rev-list --count origin/main..HEAD)"
if [ "$ahead_count" -gt 0 ]; then
  echo "[$(timestamp)] pushing $ahead_count local commit(s)"
  git push origin main
fi

formatted_count="$(sqlite3 "$DB_PATH" "select count(*) from videos where status='formatted';")"
if [ "$formatted_count" -gt 0 ]; then
  npx tsx pipeline/src/index.ts --publish-formatted-only --skip-twitter
fi

git fetch origin main
formatted_count="$(sqlite3 "$DB_PATH" "select count(*) from videos where status='formatted';")"
ahead_count="$(git rev-list --count origin/main..HEAD)"

echo "[$(timestamp)] watchdog complete formatted=$formatted_count ahead=$ahead_count"

if [ "$formatted_count" -gt 0 ] || [ "$ahead_count" -gt 0 ]; then
  exit 1
fi
