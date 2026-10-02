# Decisions, history and gotchas

Everything learned while building Gifty (Sept–Oct 2026) that isn't obvious
from the code. Read this before changing infrastructure, design or the AI call.

---

## Owner and how they like to work

- Owner: **Nodari** (khomerik.nod@gmail.com). Writes in **Georgian** — reply in
  Georgian unless asked otherwise. Keep answers short and clear; long,
  multi-option replies frustrate him.
- He does **not** want to run commands himself. Do the work end to end: edit,
  check, commit, push, then verify on the live site. Only stop for things that
  genuinely need him (signing in, approving a GitHub/OAuth grant, paying).
- He works visually: show results on the live URL rather than describing them.
- Never ask him to paste API keys into chat. If a key is needed, have it go
  straight into `.dev.vars` or a Cloudflare secret.

## Accounts and resources

| What | Where | Notes |
|---|---|---|
| GitHub repo | `easyvibesuxui-sketch/Gifty` (public) | `main` deploys to production |
| Cloudflare account | khomerik.nod@gmail.com (signs in with Google) | account id `a2f3243ab8273c87488051f7b57284ba` |
| Pages project (live) | `gifty` → https://gifty-5r4.pages.dev | Git-connected; build output `public`, no build command |
| Pages project (old) | `giftly` → https://giftly-aza.pages.dev | Direct-upload, superseded. Safe to delete once confirmed unused |
| KV `RATE` | `giftly-rate-limit` · `cc81d5d72b7542edb1bda4afc10e3c60` | per-IP limits for both APIs |
| KV `MESSAGES` | `giftly-messages` · `2d0ee2b4ab954492b1f280a36ae4953e` | contact-form submissions |
| Secret `GEMINI_KEY` | set on project `gifty` | rotate with `npx wrangler pages secret put GEMINI_KEY --project-name gifty`, then redeploy |
| GitHub App | "Cloudflare Workers and Pages", repo access: `Gifty`, `wedding-platform` | installed under the personal account |
| Amazon Associates | Store ID `nathan120e-20` | set as `AMZ_TAG` in `public/index.html`; add new domains in Associates Central → Account Settings → website list |
| Kling AI | official MCP `https://kling.ai/mcp`, Standard plan | used for the hero video |

Secrets only take effect on the **next** deployment. After changing one, push a
commit or use "Retry deployment" in the Pages dashboard.

## Design direction — why it looks like this

1. First drafts: cream/gold editorial → "looks like slop". Then dark + coral,
   light violet, dark + orange with floating CSS shapes — all rejected as
   generic.
2. Spyker C8 Preliator site (spykercars.com/c8-preliator) was given as
   inspiration for *premium, cinematic, bold*: full-bleed video, chapter-style
   scroll, condensed type. A black + emerald build followed.
3. **Final, locked direction: Studio Loop** (studioloop.com). Deep chocolate
   brown, big orange organic blob shapes, 3D-rendered objects in a playful
   collage, serif-italic + clean sans mix, words broken across baselines.
   Owner said explicitly: this style on **every page**. Do not drift back to
   dark/emerald or generic SaaS looks.

Specific feedback already applied — don't undo:
- Search lives **in the hero**, not in a section below it.
- Hero headline was too big → capped around 4.8rem; headline, blurb, search
  and chips are **centred**.
- Icons must be outline/modern, never emoji-as-icons ("slop icons").

## Hero video (Kling)

- `public/hero.mp4` (720p, ~0.75MB) and `hero.webm` are compressed from a
  1080p 14MB master kept locally at `.old-design/hero-master.mp4` (not in git).
- Generated with Kling `kling-video-v3_0`, 10s, 16:9, 1080p (80 credits):

  > Top-down flat-lay of 3D-rendered gift objects slowly drifting and rotating
  > on a deep chocolate brown seamless backdrop. Objects: a cream hardcover
  > book, a wrapped present with a satin ribbon, a cluster of glossy acrylic
  > keychains on a silver ring, a matte ceramic mug, a vintage camera, a small
  > potted plant, a folded silk scarf, a pale yellow poster card. Large bright
  > orange-red organic squiggle shapes curve smoothly across the background…
  > playful contemporary design studio aesthetic, editorial collage, seamless loop.

- Kling result URLs expire after **24 hours** — download immediately.
- Kling bonus credits don't work over MCP; only paid credits.
- Compress for web: `ffmpeg -i master.mp4 -vf "scale=1280:-2,fps=24" -c:v libx264 -crf 30 -preset slow -movflags +faststart -an hero.mp4`

## Gemini gotchas (cost real debugging time)

- Since Sept 2026 Google issues **`AQ.`-format "auth keys"**; legacy `AIzaSy…`
  keys stopped working. `AQ.` keys work **only** in the `x-goog-api-key`
  header — `?key=` in the URL returns errors.
- `gemini-2.0-flash` is shut down. `gemini-3.5-flash` is "legacy". Current
  choice: `gemini-3.5-flash-lite` (fast), fallback `gemini-3.8-flash`.
- 3.x models "think" before answering. Thinking tokens come out of
  `maxOutputTokens` — 1024 could leave an empty answer. Use 2048 and
  `thinkingConfig: { thinkingLevel: "LOW" }`. Without LOW, responses took
  >20s and timed out.
- `responseMimeType: "application/json"` avoids markdown-fenced JSON.

## Security incidents — the reasons for the hard rules

- An early demo shipped the Gemini key in client-side JS. Moved server-side.
- The old Direct-Upload deploy uploaded the **whole project folder**, so
  `.dev.vars` (with the key) was publicly downloadable. Fixed by deploying only
  `public/` (`pages_build_output_dir = "public"`). Keys were rotated.
- `wrangler pages dev` started from the home directory opened a public tunnel
  to `~`. Always run it from the project folder; press `t` to close tunnels.
- Several keys were pasted into chat or shell history and had to be rotated.
  Never ask for keys in chat.
- `scripts/check-secrets.sh` checks **both** `AQ.` and `AIza` patterns (an
  earlier version only checked `AIza` and would have missed the new format).
- After any deploy, verify from outside: `/.dev.vars`, `/wrangler.toml`,
  `/CLAUDE.md` must fall back to the homepage, not serve the file.

## Deploy workflow notes

- Git-connected Pages builds read `wrangler.toml` (output dir + KV bindings).
- Cloudflare does not allow adding Git integration to a Direct-Upload project —
  that's why `gifty` is a separate project from `giftly`.
- macOS ships bash 3.2: no associative arrays in scripts. The owner's shell is
  zsh (`read -p` means something else there).
- Pages redirects `/page.html` → `/page`; use `curl -L` when checking.

## Contact form

- `POST /api/contact` → validates, honeypot field `website`, 5 messages / 10
  min per IP, stores JSON in KV `MESSAGES` with newest-first keys
  (`msg:<inverted-timestamp>:<id>`). Read in dashboard → Workers KV →
  giftly-messages.
- No email yet. Cloudflare Email Routing/Send needs a custom domain; Resend
  etc. need an account + key.
- One test message ("Claude deploy check") was left in KV and can be deleted.
