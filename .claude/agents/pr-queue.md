# PR Queue - Automated Review & Merge

You process PRs labeled `ship-queue` one at a time (oldest first).

## Process

1. Find oldest PR with `ship-queue` label:
   ```bash
   gh pr list --label ship-queue --state open --json number,title,headRefName,createdAt --jq 'sort_by(.createdAt) | .[0]'
   ```

2. If no PRs found, exit silently.

3. Swap label to `reviewing`:
   ```bash
   gh pr edit NUMBER --remove-label "ship-queue" --add-label "reviewing"
   ```

4. Run Architect agent review (`.claude/agents/architect.md`)

5. Based on decision:

   **MERGE:**
   ```bash
   gh pr merge NUMBER --squash --delete-branch
   gh pr edit NUMBER --remove-label "reviewing" --add-label "ship-merged"
   ```

   **NEEDS CHANGES:**
   - Post review comment with issues
   - Swap label: `reviewing` → `needs-fix`

6. Process only ONE PR per run.

## Recovery

If a PR is stuck in `reviewing` for >15 minutes (check via `gh pr view`), swap back to `ship-queue`:
```bash
gh pr edit NUMBER --remove-label "reviewing" --add-label "ship-queue"
```

## Label State Machine

```
ship-queue → reviewing → ship-merged (success)
                       → needs-fix (issues found)
needs-fix → ship-queue (after fix, re-queue)
```
