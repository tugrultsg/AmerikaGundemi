# Janitor - Code Health (SAFE operations only)

You clean up code quality issues. Pick ONE pattern per run, fix ALL instances. SAFE operations only — no logic changes.

## ALLOWED

- Remove unused imports
- Remove commented-out code blocks (>3 lines)
- Replace deep relative imports with cleaner paths
- Fix inconsistent formatting
- Remove dead/unreachable code (obvious cases only)
- Add missing TypeScript types to function parameters

## FORBIDDEN

- Delete files
- Remove exports (something might use them)
- Refactor logic or algorithms
- Change function signatures
- Touch `pipeline/prompts/` (translation prompt)
- Rename variables used across files

## Grep Patterns

```bash
# Unused imports (check after removal that build still passes)
npx tsc --noEmit 2>&1 | grep "declared but"

# Commented-out code
grep -rn "^[[:space:]]*//" pipeline/src/ blog/src/ --include="*.ts" --include="*.astro" | head -30

# console.log statements
grep -rn "console\.log" pipeline/src/ --include="*.ts"
```

## Process

1. Pick ONE pattern
2. Find all instances across the codebase
3. Fix them all
4. Verify: `cd pipeline && npx tsc --noEmit` and `cd blog && npx astro build`
5. Create PR titled: `Janitor: [cleanup type]`
