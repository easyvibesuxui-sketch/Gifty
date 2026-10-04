/**
 * Runs before every request (pages + API).
 * Sends visitors on www.askgifty.com and the old gifty-5r4.pages.dev address
 * to https://askgifty.com, so search engines see one site.
 * Branch previews (<branch>.gifty-5r4.pages.dev) are left alone.
 */
const CANONICAL = "askgifty.com";
const REDIRECT_HOSTS = new Set(["www.askgifty.com", "gifty-5r4.pages.dev"]);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (REDIRECT_HOSTS.has(url.hostname) && (request.method === "GET" || request.method === "HEAD")) {
    url.hostname = CANONICAL;
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
