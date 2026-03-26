# Gündem Amerika

> YouTube podcast çeviri pipeline'ı + Astro 6 blog | TypeScript, Cloudflare Workers, Claude CLI

## Workflow

**Her değişiklik bu pipeline'ı takip eder:** Plan → Blueprint → GH Issue → User Approval → Execute → Compliance Check → Ship.

**1. Plan & Review:** Kod yazmadan önce planı Blueprint agent'a (`.claude/agents/blueprint.md`) gönder. Blueprint APPROVE etmeden koda başlama. REVISE derse planı düzelt ve tekrar gönder.

**2. User Approval:** Planı kullanıcıya sun. Kullanıcı onaylarsa devam et.

**3. Execute:** Kodu yaz.

**4. GH Issue:** Kod yazıldıktan sonra GitHub Issue oluştur — deliverables checklist ve Blueprint review özeti ile.

**5. Compliance Check & Ship:** GH issue'yu tekrar oku, her deliverable'ın karşılandığını doğrula. Uygunsa "Compliance check passed — shipping now" de ve `/ship-it` çalıştır.

## Tech Stack

| Bileşen | Teknoloji |
|---------|-----------|
| Runtime | Node.js 22+ / TypeScript |
| Blog | Astro 6, @astrojs/cloudflare v13 |
| Hosting | Cloudflare Workers |
| Pipeline | Claude CLI (`claude -p`) via child_process |
| DB | SQLite (better-sqlite3) — `~/.amerikagundemi/pipeline.db` |
| Logging | pino |
| Git ops | simple-git |
| CI/CD | GitHub Actions → Cloudflare Workers deploy |

## Project Structure

```
pipeline/src/       — Pipeline automation (monitor, transcript, translator, formatter, publishers)
pipeline/prompts/   — Claude translation prompt
blog/src/           — Astro 6 site (pages, components, layouts, content)
blog/src/content/   — Generated Turkish blog posts (.md)
config.json         — YouTube channels, playlists, translation settings
.claude/agents/     — Review agents (blueprint, architect, seo-auditor, etc.)
```

## Key Rules

- **Türkçe karakterler:** Her zaman doğru Türkçe karakterler kullan (ü, ö, ç, ş, ı, ğ, İ). ASCII yaklaşımı YASAK.
- **Never push directly to main.** Feature branch + PR + `ship-queue` label kullan.
- **TypeScript** tüm yeni kodlarda. Types `pipeline/src/types.ts`'de.
- **Astro 6 Content Layer API** — `glob()` loader ile, `src/content.config.ts`'de.
- **Thumbnails:** YouTube CDN'den (`hqdefault.jpg`), git'e resim kaydetme.
- **SQLite lokal diskte** (`~/.amerikagundemi/`), external volume'da değil.
- **Pipeline idempotent** — her aşama bağımsız, crash sonrası devam edebilir.
- **Lock file** — `~/.amerikagundemi/pipeline.lock` ile eşzamanlı çalışma engellenir.

## Commands

```bash
# Pipeline
npx tsx pipeline/src/index.ts --status              # Durum özeti
npx tsx pipeline/src/index.ts --video-url "URL"      # Tek video çevir
npx tsx pipeline/src/index.ts --dry-run              # Test (yayınlama)
npx tsx pipeline/src/index.ts --reprocess ID --from transcribed  # Yeniden işle

# Blog
cd blog && npm run dev                               # Lokal geliştirme
cd blog && npm run build                             # Build
npx wrangler deploy --config dist/server/wrangler.json  # Manuel deploy

# Git push → GitHub Actions otomatik build + deploy
```

## Resources

| Dosya | Ne zaman oku |
|-------|-------------|
| `pipeline/prompts/translate.md` | Çeviri kalitesi sorunlarında |
| `config.json` | YouTube kanal/playlist ayarları |
| `.claude/agents/` | Plan review, PR review, kod kalitesi |
