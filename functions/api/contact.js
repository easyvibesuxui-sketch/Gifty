/**
 * POST /api/contact
 * Stores contact-form messages in the MESSAGES KV namespace (giftly-messages).
 * Read them in the Cloudflare dashboard: Storage & databases → Workers KV →
 * giftly-messages. Keys sort newest-first.
 *
 * No email provider yet — add one once there's a custom domain.
 */

const LIMITS = { name: 80, email: 160, topic: 60, message: 4000 };
const TOPICS = new Set([
  "General question", "Partnership / Affiliate", "Press enquiry",
  "Bug report", "Feedback", "Other",
]);
const RATE_LIMIT = 5;      // messages
const RATE_WINDOW = 600;   // seconds (10 min) per IP

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) : "";

export async function onRequestPost({ request, env }) {
  if (!env.MESSAGES) return json({ error: "Messages aren't set up yet." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }

  // Honeypot: real people never see or fill this field.
  if (clean(body?.website, 200)) return json({ ok: true });

  const msg = {
    name: clean(body?.name, LIMITS.name),
    email: clean(body?.email, LIMITS.email).toLowerCase(),
    topic: clean(body?.topic, LIMITS.topic),
    message: clean(body?.message, LIMITS.message),
  };

  if (!msg.name) return json({ error: "Please add your name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(msg.email)) {
    return json({ error: "That email address doesn't look right." }, 400);
  }
  if (msg.message.length < 5) return json({ error: "Please write a short message." }, 400);
  if (!TOPICS.has(msg.topic)) msg.topic = "Other";

  // Per-IP rate limit, reusing the RATE namespace with its own prefix.
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  if (env.RATE) {
    const key = `contact:${ip}`;
    const hits = parseInt((await env.RATE.get(key)) || "0", 10);
    if (hits >= RATE_LIMIT) {
      return json({ error: "You've sent a few messages already — try again in a bit." }, 429);
    }
    await env.RATE.put(key, String(hits + 1), { expirationTtl: RATE_WINDOW });
  }

  // Newest-first key: invert the timestamp so KV's lexical listing shows latest on top.
  const now = Date.now();
  const key = `msg:${String(9999999999999 - now).padStart(13, "0")}:${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    ...msg,
    receivedAt: new Date(now).toISOString(),
    country: request.cf?.country || null,
  };

  await env.MESSAGES.put(key, JSON.stringify(record, null, 2), {
    metadata: { from: msg.email, topic: msg.topic, at: record.receivedAt },
  });

  return json({ ok: true });
}

export async function onRequest({ request }) {
  if (request.method === "POST") return;
  return json({ error: "Use POST." }, 405);
}
