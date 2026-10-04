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

const BY_ID = new Map(CATALOG.map((c) => [c[0], c]));

// "$50", "50 dollars", "under 50", "budget 50" → 50. Null when no budget is mentioned.
function budgetOf(q) {
  const t = q.toLowerCase();
  const m = t.match(/\$\s*(\d{1,5})/) || t.match(/(\d{1,5})\s*(?:\$|dollars?|usd|bucks)/) ||
    t.match(/(?:under|below|less than|budget(?: of| is)?|up to|max(?:imum)?)\s*(\d{1,5})/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 5 ? n : null;
}
const fits = (c, budget) => !budget || c[2] <= budget * 1.1;

function systemFor(budget) {
  const list = CATALOG.filter((c) => fits(c, budget))
    .map(([id, name, price, , tags]) => `${id}|${name}|$${price}|${tags}`).join("\n");
  return `You are Gifty's gift advisor. The user describes who they're buying for.
Pick the 4 best gifts for this person from OUR CATALOGUE below (format: id|name|approx price|tags).
${budget ? `Their budget is about $${budget}: every pick must cost at most that.` : "Respect any budget the user mentions."}
Prefer variety over 4 similar items.
Only if the catalogue truly has nothing that fits a clear interest of theirs, you may add at most ONE
real, specific product from outside the catalogue.
Respond ONLY with raw JSON, no markdown fences:
{"intro":"One warm sentence about your approach for this person.",
 "gifts":[{"id":12,"why":"One personal sentence about why it suits THIS person."},
          {"name":"Outside product name","price":"$XX","search":"amazon search query","why":"..."}]}
Use "id" for catalogue items. Max 4 gifts. Make each 'why' personal to the description.

OUR CATALOGUE:
${list}`;
}

// Query words → catalogue tags, for the no-AI fallback.
const SYNONYMS = {
  dad: "dad", father: "dad", grandpa: "dad", grandfather: "dad",
  mom: "mom", mum: "mom", mother: "mom", grandma: "mom", grandmother: "mom",
  wife: "her", girlfriend: "her", sister: "her", daughter: "her", aunt: "her", her: "her", she: "her", woman: "her",
  husband: "him", boyfriend: "him", brother: "him", son: "him", uncle: "him", him: "him", he: "him", man: "him",
  kid: "kids", kids: "kids", child: "kids", toddler: "kids", boy: "kids", girl: "kids",
  teen: "teens", teenager: "teens", student: "teens",
  coworker: "coworker", colleague: "coworker", boss: "coworker", office: "coworker",
  couple: "couple", anniversary: "anniversary", housewarming: "housewarming", home: "home",
  coffee: "coffee", espresso: "coffee", tea: "tea",
  book: "books", books: "books", read: "books", reading: "books", reader: "books", novels: "books",
  cook: "cooking", cooking: "cooking", chef: "cooking", baking: "cooking", kitchen: "cooking", food: "cooking",
  game: "gaming", games: "gaming", gamer: "gaming", gaming: "gaming",
  travel: "travel", travels: "travel", trip: "travel", traveler: "travel",
  gym: "fitness", fitness: "fitness", run: "fitness", runner: "fitness", running: "fitness", yoga: "fitness", workout: "fitness",
  relax: "wellness", spa: "wellness", selfcare: "wellness", sleep: "wellness",
  garden: "garden", gardening: "garden", plants: "garden", plant: "garden",
  tech: "tech", gadget: "tech", gadgets: "tech", techie: "tech", computer: "tech",
  art: "art", artist: "art", paint: "art", painting: "art", draw: "art", drawing: "art", craft: "art", crafts: "art", knit: "art", knits: "art", knitting: "art",
  music: "music", guitar: "music", vinyl: "music", musician: "music",
  dog: "pets", cat: "pets", pet: "pets", pets: "pets", puppy: "pets",
  photo: "photo", photos: "photo", photography: "photo", camera: "photo",
  wine: "drinks", whiskey: "drinks", whisky: "drinks", cocktail: "drinks", cocktails: "drinks",
  fashion: "fashion", style: "fashion", jewelry: "fashion",
  hike: "outdoors", hiking: "outdoors", camping: "outdoors", camp: "outdoors", fishing: "outdoors", fish: "outdoors",
  golf: "outdoors", outdoors: "outdoors", outdoor: "outdoors", hunting: "outdoors",
};

const RECIPIENTS = new Set(["dad", "mom", "her", "him", "kids", "teens", "coworker", "couple"]);
// Words that point at specific products by name.
const HINTS = { fishing: "spinning", fish: "spinning", golf: "golf", pizza: "pizza", yoga: "yoga",
  camera: "camera", photography: "camera", whiskey: "whisk", whisky: "whisk", wine: "corkscrew",
  lego: "lego", knitting: "craft", vinyl: "turntable", espresso: "espresso", tea: "tea", dog: "dog" };
const DEFAULT_IDS = ["Ember Mug 2", "Kindle Paperwhite", "Fujifilm Instax Mini 12", "Diptyque Baies Candle"]
  .map((n) => CATALOG.find((c) => c[1].startsWith(n))?.[0]).filter((x) => x !== undefined);

// Best keyword matches from the catalogue, within budget, skipping `skip` ids.
// Used when every model fails, and to top up budget-filtered AI answers.
function catalogPicks(q, budget, n, skip = new Set()) {
  const words = normalize(q).split(" ");
  const tags = new Set(words.map((w) => SYNONYMS[w]).filter(Boolean));
  const interests = [...tags].filter((t) => !RECIPIENTS.has(t));
  const hints = words.map((w) => HINTS[w]).filter(Boolean);
  const pool = CATALOG.filter((c) => fits(c, budget) && !skip.has(c[0]));
  const score = (c) => {
    const ct = c[4].split(" ");
    const name = c[1].toLowerCase();
    return ct.reduce((s, t) => s + (tags.has(t) ? (RECIPIENTS.has(t) ? 1 : 3) : 0), 0)
      + hints.filter((h) => name.includes(h)).length * 5;
  };
  const ranked = pool.map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c[0] - b.c[0]).map((x) => x.c);
  const out = [];
  for (const i of interests) {                    // one top pick per interest first, for variety
    const c = ranked.find((x) => !out.includes(x) && x[4].split(" ").includes(i));
    if (c && out.length < n) out.push(c);
  }
  for (const c of ranked) if (out.length < n && !out.includes(c)) out.push(c);
  for (const id of DEFAULT_IDS) {
    const c = BY_ID.get(id);
    if (out.length < n && c && fits(c, budget) && !skip.has(id) && !out.includes(c)) out.push(c);
  }
  for (const c of pool) if (out.length < n && !out.includes(c)) out.push(c);
  return out.map((c) => ({ name: c[1], price: `~$${c[2]}`, why: c[5], search: c[3], id: c[0] }));
}

// Ask one model; resolves with the cleaned result or throws a short, key-free reason.
async function askModel(model, q, key, budget) {
  for (const withThinking of [true, false]) {
    const t0 = Date.now();
    let r;
    try {
      // New "AQ." auth keys only work in the x-goog-api-key header, not ?key=.
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemFor(budget)}\n\nUser: "${q}"` }] }],
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
        if (seen.has(c[0]) || !fits(c, budget)) continue;
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
    // Top up from the catalogue if budget filtering left too few.
    if (gifts.length < 3) {
      for (const x of catalogPicks(q, budget, 4 - gifts.length, seen)) {
        gifts.push({ name: x.name, price: x.price, why: x.why, search: x.search });
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
    `${new URL(request.url).origin}/__cache/gift/v4?q=${encodeURIComponent(normalize(q))}`,
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

  const budget = budgetOf(q);
  let result;
  try {
    result = await hedged(models, (m) => askModel(m, q, env.GEMINI_KEY, budget));
  } catch (tried) {
    // Every model failed: answer with hand-picked gifts instead of an error.
    console.error("gemini failed:", [].concat(tried).join(" | "));
    return json({
      intro: "Our AI is a little busy right now, so here are hand-picked ideas that fit.",
      gifts: catalogPicks(q, budget, 4).map(({ name, price, why, search }) => ({ name, price, why, search })),
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
