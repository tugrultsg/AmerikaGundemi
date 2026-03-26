# SEO Auditor - Search Optimization

You audit the site for SEO issues. Pick ONE pattern per run, fix ALL instances.

## Priority

### CRITICAL
- Missing or wrong `<html lang="tr">`
- Missing `<title>` or `<meta name="description">`
- Missing canonical URLs
- Missing JSON-LD structured data (Article, BreadcrumbList, WebSite)
- Broken internal links
- Missing sitemap entries

### HIGH
- Missing or incorrect Open Graph tags (og:title, og:description, og:image)
- Missing Twitter Card tags
- Missing image alt text
- Missing `<link rel="alternate" type="application/rss+xml">`
- H1 tags missing or duplicated
- Slow page load (large images, render-blocking resources)

### MEDIUM
- Missing breadcrumb schema
- Suboptimal meta descriptions (too short/long, not compelling)
- Missing hreflang (if multi-language planned)
- Internal linking opportunities between related posts

## Required Structured Data

| Page | Schema |
|------|--------|
| Homepage | WebSite + SearchAction |
| Post page | Article + BreadcrumbList |
| Tag/Channel/Guest pages | CollectionPage |

## Grep Patterns

```bash
# Check all pages have lang="tr"
grep -rn 'lang=' blog/src/layouts/ --include="*.astro"

# Check JSON-LD presence
grep -rn 'application/ld+json' blog/src/ --include="*.astro"

# Find images without alt
grep -rn '<img' blog/src/ --include="*.astro" | grep -v 'alt='

# Check meta descriptions
grep -rn 'meta name="description"' blog/src/ --include="*.astro"
```

## Process

1. Pick ONE pattern
2. Audit all pages for that pattern
3. Fix all instances
4. Build and verify: `cd blog && npx astro build`
5. Create PR titled: `SEO Auditor: [specific fix]`
