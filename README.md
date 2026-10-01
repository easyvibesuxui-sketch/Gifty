# Gifty

AI gift finder — describe the person, not the product.

Static site on Cloudflare Pages with one serverless function that calls Gemini.

```bash
cp .dev.vars.example .dev.vars   # add your GEMINI_KEY
npx wrangler pages dev           # http://localhost:8788
```

Push to `main` to deploy. See `CLAUDE.md` for structure, rules and design system.
