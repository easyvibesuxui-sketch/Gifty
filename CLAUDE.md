# Gifty — project guide for Claude Code

AI gift finder. The user describes a person, Gemini suggests real products,
links go to Amazon (affiliate). Static site + serverless functions on
Cloudflare Pages. Live: https://gifty-5r4.pages.dev · Domain: **askgifty.com**
(bought 2026-10-03 on Cloudflare Registrar; brand name on the site is **Gifty**)

**Read first:**
- `docs/decisions.md` — accounts & resource IDs, why the design looks like this,
  Gemini/Kling/Cloudflare gotchas, past security incidents. Read before touching
  infrastructure, design or the AI call.
- `docs/plan.md` — original architecture plan for the 100k-product catalogue.

## How to work with the owner

- Owner is Nodari. He writes in **Georgian** — answer in Georgian, short and clear.
- He doesn't want to run commands himself. Do the whole loop: edit → run
  `bash scripts/check-secrets.sh` → commit → `git push` → wait ~20s → verify on
  the live site with `curl` (APIs) and say what changed.
- Only stop for things that need him: signing in, approving OAuth/GitHub grants,
  payments. Never ask him to paste API keys into chat.
- If `git push` needs auth the first time, run `gh auth login` (web flow) and
  walk him through the browser step.

## Layout

```
public/                 ← the ONLY folder that gets deployed. Nothing secret here, ever.
  index.html            homepage: hero video + AI search in the hero
  about.html, blog*.html, contact.html, privacy.html, terms.html, cookies.html, affiliate.html
  hero.mp4 / hero.webm  Kling-generated background loop (720p, ~0.8MB)
  hero-poster.jpg       first frame, shown before video loads
functions/api/gift.js   POST /api/gift — calls Gemini server-side
functions/api/contact.js  POST /api/contact — stores contact-form messages in KV
scripts/check-secrets.sh  scans for leaked keys; run before every commit
docs/decisions.md       history, resource IDs, gotchas
docs/plan.md            original 100k-product architecture plan
wrangler.toml           Pages config: output dir, KV bindings (RATE, MESSAGES)
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
- Reference: studioloop.com. Background is a Kling-generated video (see `docs/decisions.md`).
- Icons: outline SVG only. No emoji as icons.

## Run locally

```bash
npx wrangler pages dev          # serves public/ + functions/ on http://localhost:8788
```
Press `t` if a public tunnel opens and you don't want one.

## Deploy

Pushing to `main` on GitHub deploys automatically (Cloudflare Pages Git integration, project `gifty`).
Live: https://gifty-5r4.pages.dev

Manual fallback:
```bash
npx wrangler pages deploy --project-name gifty --branch main
```

Set or rotate the key:
```bash
npx wrangler pages secret put GEMINI_KEY --project-name gifty
```

## Gemini

`functions/api/gift.js` starts `gemini-3.5-flash-lite`; if it hasn't answered in
6s (or fails) it also starts `gemini-3.8-flash` and returns whichever answers
first (12s timeout per model). `thinkingLevel: LOW`, `responseMimeType: application/json`.
Override the model with a `GEMINI_MODEL` env var.
- Successful answers are kept in the edge cache (`caches.default`) for 24h, keyed
  on the normalised query — response header `X-Cache: HIT|MISS`. Bump the version (now `/v2`) in the
  cache key after changing the prompt.
- If every model fails it returns 200 with `fallback: true` and 4 hand-picked gifts
  from the `CURATED` list (keyword-matched); the reasons go to `console.error`.

## Verify after every deploy

```bash
curl -s -X POST https://gifty-5r4.pages.dev/api/gift -H 'Content-Type: application/json' -d '{"q":"dad who loves coffee"}'
for p in /.dev.vars /wrangler.toml /CLAUDE.md; do curl -sL https://gifty-5r4.pages.dev$p | grep -qE 'GEMINI_KEY=|AQ\.[A-Za-z0-9_-]{20,}' && echo "LEAK $p"; done
```

## Not done yet

- Contact form stores messages in KV `giftly-messages` (read them in the Cloudflare
  dashboard → Workers KV). No email notification yet — add one once there's a domain.
- No public email address (removed fake giftly.ai mailboxes) — add one once there's a domain
- Products are 8 hard-coded items in `index.html` (`PROD` array); plan is a
  Supabase + pgvector catalogue of ~100k items
- askgifty.com is bought but must be attached in Pages → gifty → Custom domains
  (the Cloudflare connector can't do it). Then: redirect pages.dev → askgifty.com,
  Email Routing hello@askgifty.com, add domain in Amazon Associates.
- Hero video master (14MB, 1080p) is kept locally in `.old-design/`, not in git
