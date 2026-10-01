# Gifty — project guide for Claude Code

AI gift finder. The user describes a person, Gemini suggests real products,
links go to Amazon (affiliate). Static site + one serverless function on
Cloudflare Pages.

## Layout

```
public/                 ← the ONLY folder that gets deployed. Nothing secret here, ever.
  index.html            homepage: hero video + AI search in the hero
  about.html, blog*.html, contact.html, privacy.html, terms.html, cookies.html, affiliate.html
  hero.mp4 / hero.webm  Kling-generated background loop (720p, ~0.8MB)
  hero-poster.jpg       first frame, shown before video loads
functions/api/gift.js   POST /api/gift — calls Gemini server-side
scripts/check-secrets.sh  scans for leaked keys; run before every commit
wrangler.toml           Pages config: output dir, KV binding
.dev.vars               local secrets (gitignored) — GEMINI_KEY=AQ....
```

## Hard rules

1. **Never commit `.dev.vars`** or any API key. Run `bash scripts/check-secrets.sh` before committing; it must print PASS.
2. **Never put secrets inside `public/`.** Everything in there is downloadable by anyone.
3. Gemini keys are the new `AQ.` format. They **only** work in the `x-goog-api-key` header, never `?key=` in the URL.
4. The key lives in Cloudflare as a secret, never in client-side JS.
5. All AI output rendered into HTML goes through `esc()` (XSS). The function also whitelists fields before returning.

## Design system — Studio Loop aesthetic (locked)

Every page uses the same palette and type. Do not drift.

| Token | Value | Use |
|---|---|---|
| `--cocoa` | `#2B1810` | page background |
| `--cocoa-soft` | `#3A2318` | cards, panels |
| `--blaze` | `#FF4A1C` | primary accent, organic blobs, buttons |
| `--cream` | `#F5F1E8` | text, search bar |
| `--lilac` | `#C4B5F0` | secondary accent |
| `--butter` | `#F5E960` | tertiary accent, prices |

- Display: **Instrument Serif** (italic for emphasis words, coloured `--blaze`)
- Body/UI: **Hanken Grotesk**
- Big rounded corners (20–34px), pill buttons, orange SVG blobs drifting behind content, film grain overlay.
- Hero: centred headline (max ~4.8rem), centred cream search bar, chips below, results render inside the hero.

## Run locally

```bash
npx wrangler pages dev          # serves public/ + functions/ on http://localhost:8788
```
Press `t` if a public tunnel opens and you don't want one.

## Deploy

Pushing to `main` on GitHub deploys automatically (Cloudflare Pages Git integration, project `gifty`).

Manual fallback:
```bash
npx wrangler pages deploy --project-name gifty --branch main
```

Set or rotate the key:
```bash
npx wrangler pages secret put GEMINI_KEY --project-name gifty
```

## Gemini

`functions/api/gift.js` tries `gemini-3.5-flash-lite` first, falls back to
`gemini-3.8-flash`. `thinkingLevel: LOW`, `responseMimeType: application/json`,
14s timeout per attempt. Override the model with a `GEMINI_MODEL` env var.
On failure it returns `detail` with model + HTTP status (never the key).

## Not done yet

- Contact form is front-end only — needs a real endpoint
- Products are 8 hard-coded items in `index.html` (`PROD` array); plan is a
  Supabase + pgvector catalogue of ~100k items
- No custom domain yet
- Hero video master (14MB, 1080p) is kept locally in `.old-design/`, not in git
