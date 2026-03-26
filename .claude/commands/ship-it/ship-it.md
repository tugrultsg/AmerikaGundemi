---
description: "Use when the user wants to ship, deploy, or says 'ship it'. Creates PR and queues for review + deploy."
---

# Ship It - Create PR & Queue for Review + Deploy

Creates a PR with pre-flight checks and queues it for automated review + deploy via GitHub Actions.

## Prerequisites
- You are on a feature branch (not `main`)
- All work is committed
- Build passes

## Step 1: Pre-flight Checks

```bash
# Verify not on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then echo "ERROR: Cannot ship from main"; exit 1; fi
echo "Branch: $BRANCH"
```

```bash
# Verify clean working tree
git status --short
```

```bash
# TypeScript check
cd pipeline && npx tsc --noEmit
```

```bash
# Astro build
cd blog && npx astro build
```

If dirty, commit remaining changes. If checks fail, fix before continuing.

## Step 2: Create Pull Request

```bash
# Get commits on this branch
git log main..HEAD --oneline
```

```bash
# Push branch
git push -u origin $(git branch --show-current)
```

Check if PR exists:
```bash
gh pr view $(git branch --show-current) --json number,url 2>/dev/null
```

- If exists: reuse it, skip to Step 3.
- If not: create with `gh pr create`:
  - Title under 70 chars
  - Body: `## Summary` (1-3 bullets) + `## Test plan`
  - Link related GitHub issues

## Step 3: Queue for Review

```bash
gh pr edit NUMBER --add-label "ship-queue"
```

## Step 4: Report

```
## Ship Report

**Branch:** [branch]
**PR:** #[number] — [title]
**Status:** Queued for review

### Pre-flight
- TypeScript: [pass/fail]
- Astro Build: [pass/fail]

### What happens next
1. Architect agent reviews the PR
2. If approved → merge (squash, delete branch)
3. GitHub Actions auto-deploys to Cloudflare Workers
```

Do NOT wait for review — pipeline is asynchronous.
