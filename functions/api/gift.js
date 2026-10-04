/**
 * POST /api/gift
 * Cloudflare Pages Function — runs on Cloudflare's edge, NOT in the browser.
 *
 * The Gemini key lives in env.GEMINI_KEY (a Cloudflare secret). It is never
 * sent to the client, never appears in the HTML, and cannot be read from
 * devtools. The browser only ever talks to this endpoint.
 *
 * Set the secret with:
 *   npx wrangler pages secret put GEMINI_KEY
 */

const MAX_QUERY = 400;          // characters
const RATE_LIMIT = 12;          // requests
const RATE_WINDOW = 60;         // seconds
const ATTEMPT_MS = 12000;       // per-model timeout
const HEDGE_MS = 6000;          // start the backup model if the first hasn't answered by now
const CACHE_TTL = 86400;        // identical searches are served from the edge cache for a day

// Our hand-picked catalogue (generated from data/products.py by scripts/build_catalog.py).
import CATALOG from "../../lib/catalog.js";

const BY_ID = new Map(CATALOG.map((c) => [c[0], c]));
const CATALOG_TEXT = CATALOG.map(([id, name, price, , tags]) => `${id}|${name}|$${price}|${tags}`).join("\n");

const SYSTEM = `You are Gifty's gift advisor. The user describes who they're buying for.
Pick the 4 best gifts for this person from OUR CATALOGUE below (format: id|name|approx price|tags).
Respect any budget the user mentions. Prefer variety over 4 similar items.
Only if the catalogue truly has nothing that fits a clear interest of theirs, you may add at most ONE
real, specific product from outside the catalogue.
Respond ONLY with raw JSON, no markdown fences:
{"intro":"One warm sentence about your approach for this person.",
 "gifts":[{"id":12,"why":"One personal sentence about why it suits THIS person."},
          {"name":"Outside product name","price":"$XX","search":"amazon search query","why":"..."}]}
Use "id" for catalogue items. Max 4 gifts. Make each 'why' personal to the description.

OUR CATALOGUE:
${CATALOG_TEXT}`;

// Shown when every model fails, so the visitor still gets something to click.
// k = keywords matched against the query. Prices are approximate.
const CURATED = [
  { k: ["coffee", "espresso", "caffeine"], name: "AeroPress Original Coffee Maker", price: "~$40", why: "Fast, nearly indestructible and makes a remarkably smooth cup — a coffee lover's favourite.", search: "AeroPress Original coffee maker" },
  { k: ["coffee", "tea", "kettle", "pour"], name: "Fellow Stagg EKG Electric Kettle", price: "~$165", why: "Precise temperature control for people who take the first cup seriously.", search: "Fellow Stagg EKG electric kettle" },
  { k: ["office", "coworker", "colleague", "boss", "tea", "coffee", "desk"], name: "Ember Mug 2", price: "~$130", why: "Keeps their drink at the exact temperature they like, all morning long.", search: "Ember Mug 2 temperature control" },
  { k: ["cook", "cooking", "chef", "kitchen", "bake", "food"], name: "Lodge 12\" Cast Iron Skillet", price: "~$35", why: "A pan that lasts a lifetime and gets better every time they cook with it.", search: "Lodge 12 inch cast iron skillet" },
  { k: ["book", "books", "read", "reading", "novel", "novels", "detective"], name: "Kindle Paperwhite", price: "~$160", why: "A whole library in one hand, glare-free and easy on the eyes at night.", search: "Kindle Paperwhite" },
  { k: ["hike", "hiking", "outdoor", "outdoors", "camp", "camping", "travel", "travels"], name: "Hydro Flask 32 oz Wide Mouth", price: "~$45", why: "Keeps water ice-cold on long days out — built to be dropped on rocks.", search: "Hydro Flask 32 oz wide mouth" },
  { k: ["hike", "hiking", "travel", "travels", "trip", "backpack"], name: "Osprey Daylite Plus Backpack", price: "~$65", why: "Light, comfortable and roomy enough for a full day of adventure.", search: "Osprey Daylite Plus backpack" },
  { k: ["yoga", "pilates", "wellness", "meditation"], name: "Manduka PRO Yoga Mat", price: "~$130", why: "The mat serious practitioners swear by — grippy, dense and made to last.", search: "Manduka PRO yoga mat" },
  { k: ["gym", "fitness", "run", "runner", "running", "sport", "sports", "athlete"], name: "Theragun Mini", price: "~$199", why: "Pocket-sized muscle recovery for after every workout.", search: "Theragun Mini massage gun" },
  { k: ["tech", "gadget", "gadgets", "phone", "iphone", "nerd", "techie"], name: "Anker MagGo Power Bank", price: "~$70", why: "Snaps onto their phone and keeps it alive through the busiest days.", search: "Anker MagGo power bank" },
  { k: ["garden", "gardening", "gardener", "plant", "plants", "flowers"], name: "LEGO Botanical Flower Bouquet", price: "~$60", why: "A relaxing build that ends as flowers that never wilt.", search: "LEGO Botanical flower bouquet" },
  { k: ["art", "artist", "paint", "painting", "draw", "drawing", "creative"], name: "Winsor & Newton Cotman Watercolour Set", price: "~$30", why: "Quality paints that make starting (or restarting) a creative habit easy.", search: "Winsor Newton Cotman watercolour set" },
  { k: ["photo", "photos", "camera", "teen", "party", "memories", "girlfriend"], name: "Fujifilm Instax Mini 12", price: "~$80", why: "Instant prints turn everyday moments into keepsakes they can hold.", search: "Fujifilm Instax Mini 12 instant camera" },
  { k: ["wife", "girlfriend", "anniversary", "candle", "home", "luxury", "mom", "mother"], name: "Diptyque Baies Candle", price: "~$78", why: "A cult-favourite scent that makes any room feel like a treat.", search: "Diptyque Baies candle" },
  { k: ["game", "games", "gamer", "gaming", "nintendo", "switch", "kid", "son"], name: "Nintendo Switch Pro Controller", price: "~$70", why: "A big comfort upgrade for long gaming sessions.", search: "Nintendo Switch Pro Controller" },
];
const DEFAULT_PICKS = ["Ember Mug 2", "Kindle Paperwhite", "Fujifilm Instax Mini 12", "Diptyque Baies Candle"];

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });

const normalize = (q) => q.toLowerCase().replace(/[^\p{L}\p{N}$ ]+/gu, " ").replace(/\s+/g, " ").trim();

function curatedPicks(q) {
  const words = new Set(normalize(q).split(" "));
  const scored = CURATED
    .map((g, i) => ({ g, i, score: g.k.filter((k) => words.has(k)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.g);
  for (const name of DEFAULT_PICKS) {
    if (scored.length >= 4) break;
    const g = CURATED.find((c) => c.name === name);
    if (!scored.includes(g)) scored.push(g);
  }
  return scored.slice(0, 4).map(({ name, price, why, search }) => ({ name, price, why, search }));
}

// Ask one model; resolves with the cleaned result or throws a short, key-free reason.
async function askModel(model, q, key) {
  for (const withThinking of [true, false]) {
    const t0 = Date.now();
    let r;
    try {
      // New "AQ." auth keys only work in the x-goog-api-key header, not ?key=.
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM}\n\nUser: "${q}"` }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 2048,               // thinking tokens share this budget
            responseMimeType: "application/json", // clean JSON, no fences
            ...(withThinking ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
          },
        }),
        signal: AbortSignal.timeout(ATTEMPT_MS),
      });
    } catch {
      throw new Error(`timeout ${Date.now() - t0}ms`);
    }
    if (!r.ok) {
      let reason = "";
      try { reason = (await r.json())?.error?.status || ""; } catch {}
      // Only retry without thinking if the request shape was rejected.
      if (r.status === 400 && withThinking) continue;
      throw new Error(`${r.status}${reason ? " " + reason : ""}`);
    }

    let parsed;
    try {
      const data = await r.json();
      const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "")
        .replace(/```json?\s*/gi, "")
        .replace(/```/g, "")
        .trim();
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("bad json");
    }

    // Map catalogue ids to our own data and whitelist the fields we return —
    // nothing extra reaches the client. At most one off-catalogue pick.
    const seen = new Set();
    let outside = 0;
    const gifts = [];
    for (const g of Array.isArray(parsed?.gifts) ? parsed.gifts : []) {
      if (gifts.length >= 4) break;
      const why = String(g?.why ?? "").slice(0, 300);
      const c = BY_ID.get(Number(g?.id));
      if (g?.id !== undefined && g?.id !== null && c) {
        if (seen.has(c[0])) continue;
        seen.add(c[0]);
        gifts.push({ name: c[1], price: `~$${c[2]}`, why, search: c[3] });
      } else if (outside < 1 && g?.name && g?.search) {
        outside++;
        gifts.push({
          name: String(g.name).slice(0, 120),
          price: String(g?.price ?? "").slice(0, 24),
          why,
          search: String(g.search).slice(0, 160),
        });
      }
    }
    const clean = { intro: String(parsed?.intro ?? "").slice(0, 400), gifts };
    if (!clean.gifts.length) throw new Error("no gifts");
    return clean;
  }
  throw new Error("400 rejected");
}

// Start the first model; if it is slow or fails, start the next one too.
// Resolves with whichever answers first; rejects with every reason if all fail.
function hedged(models, run) {
  return new Promise((resolve, reject) => {
    const errors = [];
    let started = 0, failed = 0, done = false, timer;
    const launch = () => {
      if (done || started >= models.length) return;
      const model = models[started++];
      run(model).then(
        (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        (e) => {
          errors.push(`${model}:${e.message}`);
          failed++;
          if (done) return;
          if (started < models.length) { clearTimeout(timer); launch(); }
          else if (failed === started) { done = true; reject(errors); }
        },
      );
      if (started < models.length) timer = setTimeout(launch, HEDGE_MS);
    };
    launch();
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  // ── 1. key must be configured ──────────────────────────────────────────
  if (!env.GEMINI_KEY) {
    return json({ error: "Server is not configured yet." }, 503);
  }

  // ── 2. parse + validate input ──────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }

  const q = typeof body?.q === "string" ? body.q.trim() : "";
  if (!q) return json({ error: "Tell us about the person first." }, 400);
  if (q.length > MAX_QUERY) {
    return json({ error: `Keep it under ${MAX_QUERY} characters.` }, 400);
  }

  // ── 3. edge cache: same search → same answer, instantly ─────────────────
  const cache = caches.default;
  const cacheKey = new Request(
    `${new URL(request.url).origin}/__cache/gift/v3?q=${encodeURIComponent(normalize(q))}`,
  );
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return json(await hit.json(), 200, { "X-Cache": "HIT" });
  } catch {}

  // ── 4. cheap per-IP rate limit (needs a KV binding named RATE) ─────────
  // Optional and best-effort: if KV is missing or over quota, keep serving.
  if (env.RATE) {
    try {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      const key = `rl:${ip}`;
      const hits = parseInt((await env.RATE.get(key)) || "0", 10);
      if (hits >= RATE_LIMIT) {
        return json({ error: "Too many searches. Try again in a minute." }, 429);
      }
      await env.RATE.put(key, String(hits + 1), { expirationTtl: RATE_WINDOW });
    } catch {}
  }

  // ── 5. call Gemini from the edge (key stays server-side) ───────────────
  const models = env.GEMINI_MODEL
    ? [env.GEMINI_MODEL]
    : ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

  let result;
  try {
    result = await hedged(models, (m) => askModel(m, q, env.GEMINI_KEY));
  } catch (tried) {
    // Every model failed: answer with hand-picked gifts instead of an error.
    console.error("gemini failed:", [].concat(tried).join(" | "));
    return json({
      intro: "Our AI is a little busy right now, so here are hand-picked ideas that fit.",
      gifts: curatedPicks(q),
      fallback: true,
    });
  }

  const put = cache.put(cacheKey, new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` },
  })).catch(() => {});
  if (waitUntil) waitUntil(put);

  return json(result, 200, { "X-Cache": "MISS" });
}

/** Anything other than POST gets a clear answer instead of a stack trace. */
export async function onRequest({ request }) {
  if (request.method === "POST") return; // handled above
  return json({ error: "Use POST." }, 405);
}
