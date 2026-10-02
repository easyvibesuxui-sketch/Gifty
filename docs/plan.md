> **Original plan (May 2026), kept for reference.** Written before the build.
> Still valid: the overall architecture direction, the 100k-product catalogue
> design, SEO/caching strategy, affiliate-link handling, cost estimates.
> Superseded by what was actually built — see `../CLAUDE.md` and `decisions.md`:
> hosting is Cloudflare **Pages** (project `gifty`, Git-connected), the AI model
> is Gemini **3.5 Flash-Lite / 3.8 Flash** via a Pages Function (not 2.0, which
> is shut down), and keys are the new `AQ.` format sent in the `x-goog-api-key`
> header.

# Gift Affiliate Site Performance Plan for 100,000 Products

## Core Answer

A site with 100,000 affiliate products should not load products directly from the database on every page request. The site must be built around precomputed pages, cached API responses, optimized search indexes, compressed images, and incremental product updates.

The correct model is:

1. Store all products in a database.
2. Build a separate search index for filtering and discovery.
3. Pre-render important SEO pages.
4. Cache category and product-list responses.
5. Load only 20-60 products per view.
6. Lazy-load images.
7. Update product feeds in background jobs, not during user visits.

The user should never wait for the site to process 100,000 products.

---

## High-Level Architecture

```text
Affiliate Feeds / APIs
        |
        v
Background Import Jobs
        |
        v
Product Database
        |
        +--> Search Index
        |
        +--> Static/Pre-rendered SEO Pages
        |
        +--> Cached API Responses
        |
        v
Frontend Site
```

The frontend should only request the small slice of products needed for the current page.

---

## Database Strategy

Use a real database for products, not a large JSON file.

Recommended structure:

```text
products
- id
- title
- slug
- description
- price
- currency
- image_url
- affiliate_url
- merchant
- category
- tags
- recipient
- occasion
- interest
- rating
- commission_rate
- availability
- last_checked_at
- created_at
- updated_at
```

Important indexes:

```text
slug
category
merchant
price
recipient
occasion
interest
availability
updated_at
```

For filtering, avoid scanning all 100,000 rows. Use indexed columns and precomputed facets.

---

## Search and Filtering

For 100,000 products, search should not be done with basic frontend filtering.

Use a search engine/index:

- Meilisearch
- Typesense
- Algolia
- Elasticsearch/OpenSearch

Recommended for MVP: **Meilisearch or Typesense**.

Search index fields:

```text
title
description
tags
category
recipient
occasion
interest
price
merchant
popularity_score
commission_score
freshness_score
```

Sorting should not be random. Use scoring:

```text
final_score =
  relevance_score
  + popularity_score
  + conversion_score
  + freshness_score
  + commission_score
  - out_of_stock_penalty
```

This lets the site show useful products first, not just any matching products.

---

## Page Loading Strategy

Never render 100,000 products at once.

Use:

- pagination
- infinite scroll with limits
- server-side filtering
- cached category pages
- lazy image loading
- skeleton loading only where needed

Example:

```text
/gifts/for-gamers
loads first 24 products

/api/products?recipient=gamer&page=2
loads next 24 products
```

Good first page size:

```text
Desktop: 24-36 products
Mobile: 12-24 products
```

Do not load thousands of product cards into the DOM.

---

## SEO Page Strategy

The site should have pre-rendered SEO pages for high-value combinations:

```text
/gifts/for-men
/gifts/for-women
/gifts/for-gamers
/gifts/for-mom
/gifts/for-dad
/gifts/under-25
/gifts/under-50
/gifts/coffee-lovers
/gifts/book-lovers
/gifts/last-minute
```

Do not generate millions of low-quality pages automatically.

Recommended:

```text
500-2,000 high-quality SEO pages first
```

Each SEO page should have:

- unique intro
- curated products
- FAQ
- product schema where valid
- breadcrumbs
- internal links
- affiliate disclosure
- updated product availability

Avoid thin pages like:

```text
/gifts/for-men-under-25-blue-tech-funny-office
```

Those can look like spam.

---

## Static Rendering and Caching

Use a framework that supports static generation and server rendering.

Good options:

- Next.js
- Astro
- Nuxt
- SvelteKit

Recommended for this type of site:

```text
Astro or Next.js
```

Rendering model:

```text
Homepage: static + cached dynamic blocks
Category pages: static or ISR
Product detail pages: static/ISR
Search results: dynamic but cached
AI gift finder: dynamic API
```

If using Next.js:

```text
Use Incremental Static Regeneration
Do not rebuild all 100,000 pages every time
```

If using Astro:

```text
Pre-render major pages
Use server endpoints for search/filtering
```

---

## CDN and Cache Strategy

Use CDN caching for static files and public pages.

Cache layers:

```text
Browser cache
CDN cache
Server cache
Database/query cache
Search index cache
```

Recommended cache examples:

```text
Homepage HTML: 5-15 minutes
Category pages: 30-120 minutes
Product cards API: 10-60 minutes
Product detail pages: 1-24 hours
Images: long cache, versioned URLs
Search results: short cache, 1-10 minutes
```

When affiliate feeds update, invalidate only the affected pages, not the whole site.

---

## Image Performance

Images will be the biggest performance risk.

Rules:

1. Do not serve original merchant images directly if they are huge.
2. Use responsive images.
3. Use WebP or AVIF where possible.
4. Lazy-load images below the fold.
5. Use fixed aspect ratios to prevent layout shift.
6. Use a CDN image optimizer.

Card image strategy:

```html
<img
  src="..."
  loading="lazy"
  width="400"
  height="400"
  alt="Product name"
/>
```

Use fixed card dimensions:

```css
.product-image {
  aspect-ratio: 1 / 1;
  object-fit: contain;
}
```

This prevents page jumping and keeps the layout stable.

---

## Affiliate Feed Updates

Product updates should run in background jobs.

Example schedule:

```text
Every 6 hours:
- fetch affiliate feeds
- update price
- update availability
- remove broken links
- update image URLs
- update merchant status

Daily:
- calculate popularity scores
- refresh search index
- refresh top SEO pages

Weekly:
- clean dead products
- detect duplicate products
- optimize categories
```

The import job should not block the website.

Use a queue:

- BullMQ
- Cloudflare Queues
- Sidekiq
- Celery
- serverless cron jobs

---

## Handling 100,000 Affiliate Links

Do not manually manage 100,000 links.

Use:

- product feeds
- affiliate APIs
- deep link generators
- merchant mapping
- link health checks

Store normalized affiliate links:

```text
merchant_product_url
affiliate_url
network
merchant_id
tracking_id
last_verified_at
status
```

Run link checks:

```text
valid
redirects
out_of_stock
broken
removed
merchant_paused
```

Broken products should be hidden automatically.

---

## AI Gift Finder Performance

The AI should not read 100,000 products directly.

Correct flow:

```text
User prompt
   |
   v
Parse intent:
- recipient
- budget
- occasion
- interests
- constraints
   |
   v
Search index returns top 50-200 candidates
   |
   v
Ranking layer selects top 10-20
   |
   v
AI explains the shortlist
```

The AI only sees a small candidate set.

Bad approach:

```text
Send all products to AI
```

Good approach:

```text
Search first, AI explains second
```

This is faster, cheaper, and more accurate.

---

## Frontend Performance Rules

Use:

- minimal JavaScript
- server-rendered pages
- small product card components
- lazy images
- no giant client-side product arrays
- no heavy animation libraries on listing pages
- no unnecessary third-party scripts

Avoid:

- loading all products in browser
- client-only rendering for SEO pages
- massive image files
- unbounded infinite scroll
- too many tracking scripts
- auto-generated low-quality pages

---

## Analytics and Tracking

Track only what matters:

```text
product_card_view
affiliate_click
gift_finder_started
gift_finder_completed
search_query
category_page_view
merchant_click
conversion_estimate
```

Important metrics:

```text
CTR from card to merchant
CTR from AI result to merchant
Revenue per 1,000 sessions
Top converting categories
Top dead merchants
Searches with no results
```

These metrics decide what products should appear first.

---

## Technical Stack Recommendation

Practical stack:

```text
Frontend:
Astro or Next.js

Database:
PostgreSQL

Search:
Meilisearch or Typesense

Cache:
Redis or platform cache

Images:
Cloudflare Images or Imgix

Hosting:
Cloudflare Pages

Jobs:
Cron + queue worker
```

For MVP, keep it simple:

```text
Astro
PostgreSQL/Supabase
Meilisearch
Cloudflare Pages
Background import script
```

---

## What Happens When Product Count Grows

### 1,000 Products

Can be simple:

- database
- basic category pages
- manual curation

### 10,000 Products

Need:

- search index
- product feeds
- caching
- automated link checks

### 100,000 Products

Need:

- background imports
- search engine
- CDN
- pre-rendered SEO pages
- strict pagination
- image optimization
- scoring/ranking
- automated cleanup

### 1,000,000 Products

Need:

- stronger data pipeline
- sharding or dedicated search infra
- aggressive deduplication
- more advanced feed normalization

---

## MVP Implementation Order

Do not start with 100,000 products.

Recommended order:

1. Build the product schema.
2. Add 500-2,000 curated products.
3. Build homepage, category pages, and product cards.
4. Add gift finder.
5. Add affiliate tracking.
6. Add search index.
7. Add feed importer.
8. Scale to 10,000 products.
9. Add automatic link checking.
10. Scale toward 100,000 products.

This avoids building expensive infrastructure before proving the business works.

---

## Performance Targets

Target numbers:

```text
Homepage load: under 2 seconds
Category page load: under 2 seconds
Search response: under 300 ms
AI gift finder initial result: under 3-6 seconds
Product card API response: under 500 ms
LCP: under 2.5 seconds
CLS: below 0.1
```

If the site misses these numbers, the likely causes are:

- image size
- too much JavaScript
- uncached product queries
- rendering too many cards
- no search index
- slow affiliate redirect handling

---

## Final Recommendation

The site can support 100,000 products if it is treated as a search/indexing/cache problem, not as a simple product grid.

The important rule:

```text
100,000 products can exist in the system.
Only 20-60 should be loaded into the user's current view.
Only high-value pages should be pre-rendered.
Only a small candidate set should go to AI.
```

That is how the site stays fast while still having a large affiliate catalog.

---

## Security

Security problems on an affiliate site come from three directions: bots stealing commission, attackers abusing API endpoints, and affiliate links being tampered with.

### Rate Limiting

Apply rate limits to every public API endpoint.

```text
/api/products        → 60 requests per minute per IP
/api/search          → 30 requests per minute per IP
/api/gift-finder     → 10 requests per minute per IP (AI is expensive)
/api/affiliate-click → 20 requests per minute per IP
```

Use a CDN-level rate limiter so the server never even sees the excess traffic:

```text
Cloudflare Rules (free tier)
Cloudflare Pages (Edge built-in)
```

This requires no code on your backend.

### Bot and Scraper Defense

Scrapers will try to steal your product catalog.

Protect with:

```text
Cloudflare Bot Fight Mode (free)
Honeypot links (invisible fake products that only bots follow)
User-agent filtering at CDN level
```

Do not try to block all bots manually. Use Cloudflare's managed bot protection — it updates automatically.

### Affiliate Link Protection

Never expose raw affiliate URLs in the HTML source.

Use a redirect endpoint:

```text
/go/[product-slug]
  → validates product exists
  → logs the click
  → redirects to affiliate URL
```

Benefits:

```text
Affiliate links can be updated without changing HTML
Click tracking is centralized
Raw merchant URLs are not visible to scrapers
```

### Input Validation

All search and filter parameters should be validated and sanitized server-side.

```text
price_min / price_max → must be numbers
category → must match allowed list
sort → must be in allowed enum
page → must be integer, max 200
```

Reject unknown parameters with a 400 error. Never pass raw query strings to the database.

---

## Error Handling and Fallbacks

Every external dependency can fail. The site should degrade gracefully, not crash.

### Search Index Failure

If Meilisearch or Typesense is down:

```text
Primary:  search index returns results
Fallback: database query with basic filters (slower but works)
```

Implementation:

```text
try {
  results = await searchIndex.query(params)
} catch {
  results = await db.query(fallbackQuery)
  log.warn("Search index unavailable, using DB fallback")
}
```

Never show a blank page. Show slower results instead.

### AI Gift Finder Failure

If the AI API is unavailable or times out:

```text
Primary:   AI explains curated shortlist
Fallback:  show search results directly without AI explanation
Fallback2: show top products for the category with a "Try again" button
```

Always set a timeout on AI calls:

```text
AI response timeout: 8 seconds
If exceeded: return search results without AI explanation
```

### Affiliate Feed Import Failure

If the feed import job fails:

```text
Keep existing products — do not delete anything
Mark products as "unverified" after 48 hours without update
Hide products after 7 days without confirmation
Send an alert to the owner
```

Never remove products because a job failed silently. Only remove after confirmed failure.

### Database Connection Failure

Use connection pooling and retry logic:

```text
Retry: 3 attempts with exponential backoff
Timeout: 5 seconds per attempt
On failure: return cached CDN version of the page
```

Static and cached pages continue to work even if the database is temporarily unreachable.

### Dead Affiliate Links

```text
When a link returns 404 or redirect to homepage:
  → mark product as broken
  → hide from listings immediately
  → send daily report of broken products
```

---

## Monitoring and Alerting

Use managed monitoring services. Do not build custom dashboards for basic uptime and error tracking.

### Uptime Monitoring (Zero Maintenance)

```text
BetterUptime (free tier)
UptimeRobot (free tier)
Checkly

Check every 1-5 minutes from multiple regions.
Alert via email or Telegram immediately on downtime.
```

Setup time: under 10 minutes. No ongoing maintenance required.

### Error Tracking

```text
Sentry (free tier for small projects)

Automatically catches:
- JavaScript errors
- API errors
- Unhandled exceptions
- Performance regressions
```

One script tag or one npm package. Works automatically after setup.

### Performance Monitoring

```text
Cloudflare Analytics (free, built-in if using Cloudflare)
Cloudflare Analytics (free, built-in)

Tracks:
- Page load times
- Cache hit rates
- Bandwidth
- Top pages
```

No custom instrumentation needed.

### Feed Import Health

Add a simple health check endpoint to your import job:

```text
/api/health/feed-import
Returns:
{
  last_run: "2025-01-01T06:00:00Z",
  products_updated: 1243,
  errors: 0,
  status: "ok"
}
```

Point UptimeRobot at this endpoint. If it stops responding, you get an alert automatically.

### What to Watch Daily

```text
Broken affiliate links count (should stay near zero)
Search index product count (should not drop suddenly)
Top 404 pages (dead SEO pages need fixing)
AI gift finder error rate (budget protection)
```

---

## Financial and Cost Estimation

### MVP Stack Cost (0–1,000 visitors/day)

```text
Hosting (Cloudflare Pages free tier)        $0/month
Database (Supabase free tier)               $0/month
Search (Meilisearch Cloud starter)          $30/month
AI API (Google Gemini Flash free tier)       $0/month
Image CDN (Cloudflare free tier)            $0/month
Monitoring (UptimeRobot + Sentry free)      $0/month
Domain                                      $10–15/year

Total MVP:   ~$31–32/month
```

### Growth Stack Cost (1,000–10,000 visitors/day)

```text
Hosting (Cloudflare Pages Pro)              $20/month
Database (Supabase Pro)                     $25/month
Search (Meilisearch Cloud growth)           $60/month
AI API (Google Gemini Flash, paid tier)      $10–50/month
Image CDN (Cloudflare Images)               $5–20/month
Monitoring (Sentry Team)                    $26/month
Background jobs (serverless cron)           $0–10/month

Total growth:   ~$140–210/month
```

### Scale Stack Cost (10,000–50,000 visitors/day)

```text
Hosting (Cloudflare Pages)                  $20/month
Database (Supabase or managed PostgreSQL)   $50–100/month
Search (Typesense Cloud or Algolia)         $100–250/month
AI API (Google Gemini Flash, scale tier)     $50–150/month
CDN and images                              $20–50/month
Monitoring                                  $50–100/month
Queue worker (background jobs)              $20–50/month

Total scale:   ~$350–750/month
```

### Revenue Context

```text
Typical affiliate commission:      3–10% per sale
Average order value:               $40–80
Commission per conversion:         $2–6
Conversions to cover MVP costs:    8–30 sales/month
```

The MVP infrastructure pays for itself with fewer than 30 conversions per month.

### Cost Risks to Watch

```text
AI API costs scale with usage — Gemini Flash free tier covers ~21,000 requests/day; set billing alerts if you exceed it
Image bandwidth if serving large images — use optimization from day one
Search index costs if product count grows fast — plan tier changes
```

Always set billing alerts on every cloud service before going live.

---

## Minimum-Work Strategy

The goal is to run a profitable affiliate site with as little manual work as possible.

### Use Fully Managed Services

Do not self-host anything at the start.

```text
Instead of:                   Use:
Self-hosted PostgreSQL    →   Supabase (managed + dashboard + backups)
Self-hosted Meilisearch   →   Meilisearch Cloud or Typesense Cloud
Custom image pipeline     →   Cloudflare Images or Imgix
Custom job scheduler      →   Supabase Edge Functions + pg_cron
Custom monitoring         →   UptimeRobot + Sentry (both free)
Custom analytics          →   Cloudflare Analytics (free, zero-config)
```

You trade a small monthly cost for not having to manage servers, run updates, or debug infrastructure.

### Automate Everything That Repeats

```text
Product feed updates      → scheduled cron job, runs automatically
Broken link detection     → runs nightly, hides broken products
Search index refresh      → triggered after each import job
Price updates             → part of feed import, no manual work
Low-stock hiding          → automated by availability flag
```

Once set up, the catalog maintains itself.

### Content That Writes Itself

```text
Product descriptions      → AI-generated at import time, stored in DB
SEO meta tags             → generated from product data + templates
Category intros           → write once, reuse with product count tokens
FAQ sections              → write once per category, static
```

You write the templates. The system fills in the specifics.

### Affiliate Network Automation

Use affiliate networks that provide product feeds, not manual link management:

```text
Amazon Associates     → Product Advertising API
Awin                  → Product feed downloads
ShareASale            → datafeed system
CJ Affiliate          → product catalog feeds
Impact                → catalog API
```

These networks send you updated prices, images, and availability automatically. You import the feed, not individual products.

### What You Actually Need to Do Manually

```text
Write category page intros (once per category)
Review and curate featured products (weekly, 30 minutes)
Check the broken links report (weekly, 5 minutes)
Review top search queries with no results (monthly)
Add new affiliate programs as the site grows
```

Everything else should run without your involvement.

### Minimum-Work Technical Stack

```text
Frontend:      Astro (generates static HTML, minimal JavaScript)
Database:      Supabase (managed PostgreSQL, built-in REST API)
Search:        Meilisearch Cloud (no server management)
Hosting:       Cloudflare Pages (auto-deploys from git, CDN + DDoS + Bot protection included)
Images:        Cloudflare Images (auto-optimize, auto-resize)
Jobs:          Supabase Edge Functions + pg_cron (no queue server)
Monitoring:    UptimeRobot + Sentry free tiers
Analytics:     Cloudflare Analytics (zero setup)
AI:            Google Gemini Flash API (free tier, no server)
```

This stack has no servers to manage. Every component is maintained by its provider.

### What to Build vs. What to Buy

```text
Build:
- Category page templates
- Product card components
- Gift finder UI
- Affiliate click tracking endpoint
- Feed import script

Buy (use existing service):
- Search engine
- Database hosting
- Image optimization
- Uptime monitoring
- Error tracking
- CI/CD (Cloudflare Pages handles this)
- SSL certificates (automatic)
- DDoS protection (Cloudflare free)
```

The less custom infrastructure you run, the less maintenance you have.
