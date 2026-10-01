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

const SYSTEM = `You are Giftly's gift advisor. The user describes who they're buying for.
Suggest 3-4 specific, real, purchasable gifts.
Respond ONLY with raw JSON, no markdown fences:
{"intro":"One warm sentence about your approach for this person.",
 "gifts":[{"name":"Product Name","price":"$XX","why":"One personal sentence.","search":"amazon query"}]}
Max 4 gifts. Real brands. Make each 'why' personal.`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export async function onRequestPost({ request, env }) {
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

  // ── 3. cheap per-IP rate limit (needs a KV binding named RATE) ─────────
  // Optional: skip silently if KV isn't bound, so the site still works.
  if (env.RATE) {
    const ip = request.headers.get("CF-Connecting-IP") || "anon";
    const key = `rl:${ip}`;
    const hits = parseInt((await env.RATE.get(key)) || "0", 10);
    if (hits >= RATE_LIMIT) {
      return json({ error: "Too many searches. Try again in a minute." }, 429);
    }
    await env.RATE.put(key, String(hits + 1), { expirationTtl: RATE_WINDOW });
  }

  // ── 4. call Gemini from the edge ───────────────────────────────────────
  // New "AQ." auth keys only work in the x-goog-api-key header, not ?key=.
  // Keeping the key out of the URL also keeps it out of any logs.
  // Try the fastest model first, fall back to a stronger one.
  const models = env.GEMINI_MODEL
    ? [env.GEMINI_MODEL]
    : ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

  const call = (model, withThinking) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM}\n\nUser: "${q}"` }] }],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 2048,               // thinking tokens share this budget
          responseMimeType: "application/json", // clean JSON, no fences
          ...(withThinking ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
        },
      }),
      signal: AbortSignal.timeout(14000),
    });

  let upstream = null;
  const tried = [];   // safe diagnostics: model + status/reason only, never the key
  for (const model of models) {
    for (const withThinking of [true, false]) {
      const t0 = Date.now();
      try {
        const r = await call(model, withThinking);
        if (r.ok) { upstream = r; break; }
        let reason = "";
        try { reason = (await r.json())?.error?.status || ""; } catch {}
        tried.push(`${model}:${r.status}${reason ? " " + reason : ""}`);
        // Only retry without thinking if the request shape was rejected.
        if (!(r.status === 400 && withThinking)) break;
      } catch {
        tried.push(`${model}:timeout ${Date.now() - t0}ms`);
        break;
      }
    }
    if (upstream) break;
  }

  if (!upstream) {
    console.error("gemini failed:", tried.join(" | "));
    return json({ error: "The AI service is unavailable right now.", detail: tried }, 502);
  }

  // ── 5. parse Gemini's reply into our own shape ─────────────────────────
  let parsed;
  try {
    const data = await upstream.json();
    const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "")
      .replace(/```json?\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Got an unexpected reply. Try rephrasing." }, 502);
  }

  // ── 6. whitelist the fields we return — nothing extra reaches the client ─
  const clean = {
    intro: String(parsed?.intro ?? "").slice(0, 400),
    gifts: Array.isArray(parsed?.gifts)
      ? parsed.gifts.slice(0, 4).map((g) => ({
          name: String(g?.name ?? "").slice(0, 120),
          price: String(g?.price ?? "").slice(0, 24),
          why: String(g?.why ?? "").slice(0, 300),
          search: String(g?.search ?? "").slice(0, 160),
        }))
      : [],
  };

  if (!clean.gifts.length) {
    return json({ error: "No gifts came back. Try adding more detail." }, 502);
  }

  return json(clean);
}

/** Anything other than POST gets a clear answer instead of a stack trace. */
export async function onRequest({ request }) {
  if (request.method === "POST") return; // handled above
  return json({ error: "Use POST." }, 405);
}
