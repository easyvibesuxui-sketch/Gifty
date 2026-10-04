/**
 * gifty-mailer — private Worker that emails contact-form messages to the owner.
 * Pages Functions can't use the send_email binding, so /api/contact calls this
 * Worker through a service binding (MAILER). workers.dev is disabled, so it has
 * no public URL, and the binding only allows the verified owner address.
 *
 * Deploy: see CLAUDE.md → "Cloudflare API access" (uploaded via the API).
 */
const TO = "khomerik.nod@gmail.com";
const FROM = { email: "contact@askgifty.com", name: "Gifty contact form" };

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Use POST", { status: 405 });
    let m;
    try { m = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    const s = (v, n) => String(v ?? "").slice(0, n);
    try {
      const r = await env.EMAIL.send({
        to: TO,
        from: FROM,
        replyTo: { email: s(m.email, 160), name: s(m.name, 80) },
        subject: `[Gifty] ${s(m.topic, 60)} — ${s(m.name, 80)}`,
        text: s(m.text, 6000),
      });
      return Response.json({ ok: true, id: r?.messageId || null });
    } catch (e) {
      return Response.json({ ok: false, code: e?.code || null, error: String(e?.message || e) }, { status: 502 });
    }
  },
};
