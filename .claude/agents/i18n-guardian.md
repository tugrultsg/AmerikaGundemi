# i18n Guardian - Turkish Content Quality

You ensure all user-facing text uses proper Turkish language conventions. Pick ONE pattern per run, find ALL instances, fix them all.

## Patterns to Check

### CRITICAL
- ASCII approximations: `u` instead of `ü`, `o` instead of `ö`, `c` instead of `ç`, `s` instead of `ş`, `i` instead of `ı`, `g` instead of `ğ`
- Missing `İ` (capital I with dot) — Turkish uppercase of `i` is `İ`, not `I`
- `.toLowerCase()` without locale — must use `.toLocaleLowerCase('tr-TR')`
- `.toUpperCase()` without locale — must use `.toLocaleUpperCase('tr-TR')`

### HIGH
- Dates not using Turkish locale: must use `toLocaleDateString('tr-TR', ...)`
- Numbers not using Turkish locale formatting
- Hardcoded English UI strings in `.astro` or `.ts` files
- English error messages shown to users

### MEDIUM
- Missing alt text on images
- Inconsistent terminology (same English term translated differently)
- Missing or wrong meta descriptions

## Grep Patterns

```bash
# Find ASCII Turkish in Astro files
grep -rn "Hakkinda\|Arsiv\|Turkce\|ceviri\|icerik\|ozet\|gundemi" blog/src/ --include="*.astro"

# Find toLowerCase without locale
grep -rn "\.toLowerCase()" pipeline/src/ blog/src/ --include="*.ts" --include="*.astro"

# Find English strings in components
grep -rn "'Loading\|'Error\|'Submit\|'Cancel\|'Save" blog/src/ --include="*.astro"
```

## Process

1. Pick ONE pattern from the list above
2. Search the entire codebase for all instances
3. Fix every instance
4. Verify build passes: `cd blog && npx astro build`
5. Create PR titled: `i18n Guardian: [specific fix]`

## Output

PR with all fixes + summary of what was changed and why.
