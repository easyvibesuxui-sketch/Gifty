#!/usr/bin/env python3
"""Build the static gift catalogue.

Reads data/products.py and writes:
  public/gifts/index.html          hub page listing every guide
  public/gifts/<slug>.html         one page per guide (served at /gifts/<slug>)
  public/data/products.json        the catalogue as JSON (for the homepage / AI later)
  public/sitemap.xml               every page in public/

Styles come from public/blog.html so the guides always match the site design.
Run after editing data/products.py:  python3 scripts/build_catalog.py
"""
import html
import json
import pathlib
import re
import sys
from urllib.parse import quote_plus

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SITE = "https://askgifty.com"
AMZ_TAG = "nathan120e-20"
YEAR = 2026

sys.path.insert(0, str(ROOT / "data"))
from products import P  # noqa: E402

PRODUCTS = [
    {"name": n, "price": p, "q": q, "why": w, "tags": t.split()}
    for (n, p, q, w, t) in P
]

# slug, group, label (used in "Gifts for …"), selector, title, intro
GUIDES = [
    # by person
    ("for-dad", "person", "Dad", lambda p: "dad" in p["tags"],
     "Gifts for Dad", "From the coffee ritual to the weekend project, these are gifts dads actually use — not another novelty mug."),
    ("for-mom", "person", "Mom", lambda p: "mom" in p["tags"],
     "Gifts for Mom", "Thoughtful, useful and a little indulgent: gifts that say you pay attention to what she loves."),
    ("for-him", "person", "Him", lambda p: "him" in p["tags"],
     "Gifts for Him", "For boyfriends, husbands, brothers and friends — practical upgrades and fun extras he will reach for daily."),
    ("for-her", "person", "Her", lambda p: "her" in p["tags"],
     "Gifts for Her", "For girlfriends, wives, sisters and friends — cosy, beautiful and genuinely useful picks."),
    ("for-kids", "person", "Kids", lambda p: "kids" in p["tags"],
     "Gifts for Kids", "Toys, books and creative kits that keep kids busy, curious and away from screens (mostly)."),
    ("for-teens", "person", "Teens", lambda p: "teens" in p["tags"],
     "Gifts for Teens", "The gadgets, games and room upgrades teenagers actually want this year."),
    ("for-coworkers", "person", "Coworkers", lambda p: "coworker" in p["tags"],
     "Gifts for Coworkers", "Office-appropriate gifts that still feel personal — perfect for Secret Santa and farewells."),
    ("for-couples", "person", "Couples", lambda p: "couple" in p["tags"] or "anniversary" in p["tags"],
     "Gifts for Couples", "Gifts made for two: date nights, shared hobbies and keepsakes."),
    # by interest
    ("for-coffee-lovers", "interest", "Coffee & Tea Lovers", lambda p: {"coffee", "tea"} & set(p["tags"]),
     "Gifts for Coffee & Tea Lovers", "Brewers, grinders and mugs that turn the morning cup into the best part of the day."),
    ("for-book-lovers", "interest", "Book Lovers", lambda p: "books" in p["tags"],
     "Gifts for Book Lovers", "E-readers, reading lights and great books for people who always have one on the go."),
    ("for-home-cooks", "interest", "Home Cooks", lambda p: "cooking" in p["tags"],
     "Gifts for Home Cooks", "Kitchen tools and cookbooks that serious and casual cooks will use every week."),
    ("for-gamers", "interest", "Gamers", lambda p: "gaming" in p["tags"],
     "Gifts for Gamers", "Controllers, headsets and board games for video gamers and game-night hosts."),
    ("for-travelers", "interest", "Travelers", lambda p: "travel" in p["tags"],
     "Gifts for Travelers", "Smart gear that makes packing lighter, flights calmer and trips smoother."),
    ("for-fitness-lovers", "interest", "Fitness Lovers", lambda p: "fitness" in p["tags"],
     "Gifts for Fitness Lovers", "Recovery tools, trackers and gear for runners, lifters and yogis."),
    ("self-care-gifts", "interest", "Self-Care Lovers", lambda p: "wellness" in p["tags"],
     "Self-Care Gifts", "Cosy, calming gifts that tell someone to slow down and look after themselves."),
    ("for-gardeners", "interest", "Gardeners", lambda p: "garden" in p["tags"],
     "Gifts for Gardeners", "For green thumbs indoors and out — tools, smart gardens and plants that never die."),
    ("for-tech-lovers", "interest", "Tech Lovers", lambda p: "tech" in p["tags"],
     "Gifts for Tech Lovers", "Gadgets that are genuinely useful, not just shiny."),
    ("for-artists", "interest", "Artists & Makers", lambda p: "art" in p["tags"],
     "Gifts for Artists & Makers", "Supplies and kits for painters, crafters and anyone who loves to make things."),
    ("for-music-lovers", "interest", "Music Lovers", lambda p: "music" in p["tags"],
     "Gifts for Music Lovers", "Speakers, turntables and instruments for people who always have a song playing."),
    ("for-outdoor-lovers", "interest", "Outdoor Lovers", lambda p: "outdoors" in p["tags"],
     "Gifts for Outdoor Lovers", "Gear for hikers, campers, anglers and golfers."),
    ("for-pet-lovers", "interest", "Pet Lovers", lambda p: "pets" in p["tags"],
     "Gifts for Pet Lovers", "Gifts for the pet — and for the person who loves them."),
    # by budget
    ("under-25", "budget", "Under $25", lambda p: p["price"] <= 25,
     "Gifts Under $25", "Small price, big smile: thoughtful gifts that do not feel cheap."),
    ("under-50", "budget", "Under $50", lambda p: p["price"] <= 50,
     "Gifts Under $50", "The sweet spot for birthdays, Secret Santa and just-because gifts."),
    ("under-100", "budget", "Under $100", lambda p: p["price"] <= 100,
     "Gifts Under $100", "Quality gifts that feel special without breaking the bank."),
    ("luxury-gifts", "budget", "Splurge ($150+)", lambda p: p["price"] >= 150,
     "Luxury Gifts", "When it is a big birthday, an anniversary or someone who deserves the best."),
    # by occasion
    ("anniversary-gifts", "occasion", "Anniversary", lambda p: "anniversary" in p["tags"] or "couple" in p["tags"],
     "Anniversary Gifts", "Romantic, personal and practical gifts to celebrate another year together."),
    ("housewarming-gifts", "occasion", "Housewarming", lambda p: "housewarming" in p["tags"],
     "Housewarming Gifts", "Gifts that help a new place feel like home from day one."),
]
GROUPS = [("person", "By person"), ("interest", "By interest"),
          ("budget", "By budget"), ("occasion", "By occasion")]

# outline icons (24px grid, stroke) — one per product family
ICONS = {
    "coffee": '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M8 3v2M12 3v2"/>',
    "books": '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
    "cooking": '<path d="M3 11h14v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-4z"/><path d="M17 13h4"/><path d="M7 7c0-1 1-1 1-2M11 7c0-1 1-1 1-2"/>',
    "gaming": '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".8"/><circle cx="18" cy="13.5" r=".8"/>',
    "travel": '<path d="M2 16l20-7-3-2-7 2-5-4-2 1 3 5-4 1-2-1-1 1z"/><path d="M3 21h18"/>',
    "fitness": '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
    "wellness": '<path d="M12 21c-4-3-8-6.5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 4.5-4 8-8 11z"/>',
    "garden": '<path d="M12 21V11"/><path d="M12 11C12 7 9 4 4 4c0 4 3 7 8 7z"/><path d="M12 13c0-3 2.5-5.5 7-5.5 0 3.5-2.5 5.5-7 5.5z"/>',
    "tech": '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    "art": '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    "music": '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    "pets": '<circle cx="5" cy="10" r="2"/><circle cx="9" cy="5.5" r="2"/><circle cx="15" cy="5.5" r="2"/><circle cx="19" cy="10" r="2"/><path d="M12 11c-3 0-6 4.5-6 7a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3c0-2.5-3-7-6-7z"/>',
    "photo": '<path d="M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>',
    "drinks": '<path d="M8 3h8l-1 8a3 3 0 0 1-6 0z"/><path d="M12 14v7M8 21h8"/>',
    "fashion": '<path d="M8 3l4 3 4-3 5 4-3 4-2-1v11H8V10l-2 1-3-4z"/>',
    "outdoors": '<path d="M3 20l6-11 4 6 3-4 5 9z"/><circle cx="17" cy="5" r="2"/>',
    "home": '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    "kids": '<rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><rect x="8" y="3" width="8" height="8" rx="1"/>',
    "gift": '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13"/><path d="M12 8C10 4 6 4 6 6.5S10 8 12 8zM12 8c2-4 6-4 6-1.5S14 8 12 8z"/>',
}
ICON_ORDER = ["coffee", "books", "cooking", "gaming", "music", "pets", "photo", "garden",
              "fitness", "wellness", "art", "drinks", "fashion", "travel", "outdoors", "tech",
              "home", "kids"]
LABELS = {"coffee": "Coffee & tea", "tea": "Coffee & tea", "books": "Books", "cooking": "Kitchen",
          "gaming": "Games", "travel": "Travel", "fitness": "Fitness", "wellness": "Self-care",
          "garden": "Garden", "tech": "Tech", "art": "Creative", "music": "Music", "pets": "Pets",
          "photo": "Photo", "drinks": "Drinks", "fashion": "Style", "outdoors": "Outdoors",
          "home": "Home", "kids": "Kids"}


def kind(p):
    tags = set(p["tags"]) | ({"coffee"} if "tea" in p["tags"] else set())
    for k in ICON_ORDER:
        if k in tags:
            return k
    return "gift"


def icon(k, size=44):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[k]}</svg>')


def amz(q):
    return f"https://www.amazon.com/s?k={quote_plus(q)}&tag={AMZ_TAG}"


def e(s):
    return html.escape(str(s), quote=True)


def base_css():
    src = (PUBLIC / "blog.html").read_text()
    m = re.search(r"<style>(.*?)</style>", src, re.S)
    if not m:
        sys.exit("could not read styles from public/blog.html")
    return m.group(1)


EXTRA_CSS = """
/* ── gift guides ── */
.ask{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;
  background:var(--cocoa-soft);border-radius:26px;padding:22px 26px;margin-bottom:30px}
.ask p{color:var(--cream-70);font-size:.95rem;margin:0}
.ask b{color:var(--cream);font-weight:600}
.ggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:clamp(12px,1.6vw,18px)}
.gcard{background:var(--cocoa-soft);border-radius:26px;overflow:hidden;text-decoration:none;
  color:var(--cream);display:flex;flex-direction:column;transition:transform .5s var(--spring),background .4s,color .4s}
.gcard:hover{transform:translateY(-6px);background:var(--cream);color:var(--ink)}
.gcard-top{height:120px;display:flex;align-items:center;justify-content:center;color:var(--ink)}
.gcard:nth-child(3n+1) .gcard-top{background:var(--blaze);color:var(--cream)}
.gcard:nth-child(3n+2) .gcard-top{background:var(--lilac)}
.gcard:nth-child(3n+3) .gcard-top{background:var(--butter)}
.gcard-bd{padding:20px 22px 22px;flex:1;display:flex;flex-direction:column}
.gcard-cat{font-size:.64rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--blaze);margin-bottom:9px}
.gcard-nm{font-family:var(--serif);font-size:1.32rem;line-height:1.12;margin-bottom:9px}
.gcard-ds{font-size:.86rem;opacity:.68;line-height:1.65;flex:1;margin-bottom:16px}
.gcard-ft{display:flex;justify-content:space-between;align-items:center;gap:10px}
.gcard-pr{font-family:var(--serif);font-size:1.4rem;color:var(--butter)}
.gcard:hover .gcard-pr{color:var(--blaze)}
.gcard-go{font-size:.78rem;font-weight:600;opacity:.75}
.gcard.hide{display:none}
.note{font-size:.78rem;color:var(--cream-45);margin-top:22px}
.related{display:flex;flex-wrap:wrap;gap:8px}
.pill{display:inline-block;border:1.5px solid var(--cream-22);color:var(--cream-70);text-decoration:none;
  padding:10px 18px;border-radius:100px;font-size:.84rem;transition:all .3s var(--spring)}
.pill:hover{background:var(--cream);color:var(--ink);border-color:var(--cream)}
.pill small{opacity:.55;margin-left:6px}
.sec-t{font-family:var(--serif);font-size:clamp(1.6rem,3.4vw,2.4rem);margin:54px 0 18px;letter-spacing:-.015em}
.hubgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.hub{background:var(--cocoa-soft);border-radius:22px;padding:22px 24px;text-decoration:none;color:var(--cream);
  display:flex;align-items:center;gap:16px;transition:all .4s var(--spring)}
.hub:hover{background:var(--cream);color:var(--ink);transform:translateY(-4px)}
.hub span{font-family:var(--serif);font-size:1.25rem;line-height:1.1}
.hub small{display:block;font-family:var(--sans);font-size:.75rem;opacity:.55;margin-top:4px}
.hub svg{flex:none;color:var(--blaze)}
@media(max-width:560px){nav{padding:0 16px}.nav-links{gap:13px}.nav-links a{font-size:.78rem}.logo{font-size:1.45rem}.nav-links li:first-child{display:none}}
"""

NAV = """<nav id="nav">
  <a href="/" class="logo">Gifty</a>
  <ul class="nav-links">
    <li><a href="/#finder">Find</a></li>
    <li><a href="/gifts/"{now}>Gift ideas</a></li>
    <li><a href="/blog">Journal</a></li>
    <li><a href="/about">About</a></li>
    <li><a href="/contact">Contact</a></li>
  </ul>
</nav>"""

BLOBS = """<div id="blobs">
  <div class="blob b1"><svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <path fill="#FF4A1C" d="M45.7,-58.2C58.3,-49.4,67.3,-34.6,71.2,-18.4C75.1,-2.2,73.9,15.4,66.4,29.5C58.9,43.6,45.1,54.2,30.1,61.3C15.1,68.4,-1.1,72,-16.6,68.7C-32.1,65.4,-46.9,55.2,-57.4,41.4C-67.9,27.6,-74.1,10.2,-72.4,-6.3C-70.7,-22.8,-61.1,-38.4,-48.2,-47.6C-35.3,-56.8,-19.1,-59.6,-1.9,-57.3C15.3,-55,33.1,-67,45.7,-58.2Z" transform="translate(100 100)"/></svg></div>
  <div class="blob b2"><svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <path fill="#FF4A1C" d="M38.5,-52.8C50.9,-42.8,62.4,-31.9,67.3,-18.3C72.2,-4.7,70.5,11.6,63.8,25.3C57.1,39,45.4,50.1,32,56.9C18.6,63.7,3.5,66.2,-12.4,64.4C-28.3,62.6,-45,56.5,-55.9,44.6C-66.8,32.7,-71.9,15,-70.6,-1.7C-69.3,-18.4,-61.6,-34.1,-49.6,-44.7C-37.6,-55.3,-21.3,-60.8,-5.3,-58.3C10.7,-55.8,26.1,-62.8,38.5,-52.8Z" transform="translate(100 100)"/></svg></div>
</div>
<div class="veil"></div>"""


def footer(guides):
    occ = "".join(f'<li><a href="/gifts/{g[0]}">{e(g[4])}</a></li>' for g in guides
                  if g[0] in ("for-dad", "for-mom", "under-50", "anniversary-gifts"))
    return f"""<footer>
  <div class="f-grid">
    <div>
      <a href="/" class="f-logo">Gifty</a>
      <p class="f-tag">AI-powered gift ideas for every person and every occasion. Free, no sign-up.</p>
    </div>
    <div class="f-col"><h4>Gift ideas</h4><ul>{occ}</ul></div>
    <div class="f-col"><h4>Company</h4><ul>
      <li><a href="/about">About</a></li><li><a href="/blog">Journal</a></li>
      <li><a href="/contact">Contact</a></li><li><a href="/affiliate">Affiliates</a></li></ul></div>
    <div class="f-col"><h4>Legal</h4><ul>
      <li><a href="/privacy">Privacy</a></li><li><a href="/cookies">Cookies</a></li>
      <li><a href="/terms">Terms</a></li><li><a href="/affiliate">Disclosure</a></li></ul></div>
  </div>
  <div class="f-bot">
    <span>&copy; {YEAR} Gifty. Some links are affiliate links &mdash; we earn a commission at no cost to you.
      As an Amazon Associate we earn from qualifying purchases.</span>
    <div class="f-legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cookies">Cookies</a></div>
  </div>
</footer>"""


SCRIPT = """<script>
const nav=document.getElementById('nav'),prog=document.getElementById('prog');
addEventListener('scroll',()=>{nav.classList.toggle('stuck',scrollY>60);
  const m=document.body.scrollHeight-innerHeight;prog.style.width=(m>0?(scrollY/m)*100:0)+'%';},{passive:true});
const io=new IntersectionObserver(es=>{es.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},
  {threshold:.1,rootMargin:'0px 0px -50px 0px'});
document.querySelectorAll('.rv').forEach(x=>io.observe(x));
document.querySelectorAll('.rf[data-max]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.rf[data-max]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b)});
  const lo=+b.dataset.min,hi=+b.dataset.max;
  document.querySelectorAll('.gcard').forEach(c=>{const p=+c.dataset.price;c.classList.toggle('hide',p<lo||p>hi)});
}));
</script>"""


def page(title, desc, path, body, now=False, jsonld=None):
    ld = f'<script type="application/ld+json">{json.dumps(jsonld)}</script>\n' if jsonld else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE}{path}">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{SITE}{path}">
<meta property="og:image" content="{SITE}/hero-poster.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>{base_css()}{EXTRA_CSS}</style>
{ld}</head>
<body>
<a href="#main" class="skip">Skip to content</a>
<div class="grain"></div>
<div id="prog"></div>
{BLOBS}
<div class="page">
{NAV.format(now=' class="now"' if now else '')}
{body}
{footer(GUIDES)}
</div>
{SCRIPT}
</body>
</html>
"""


def card(p):
    k = kind(p)
    return f"""<a class="gcard rv" data-price="{p['price']}" href="{e(amz(p['q']))}" target="_blank" rel="sponsored nofollow noopener">
  <div class="gcard-top">{icon(k)}</div>
  <div class="gcard-bd">
    <div class="gcard-cat">{e(LABELS.get(k, 'Gift'))}</div>
    <div class="gcard-nm">{e(p['name'])}</div>
    <div class="gcard-ds">{e(p['why'])}</div>
    <div class="gcard-ft"><div class="gcard-pr">~${p['price']}</div><div class="gcard-go">View on Amazon &rarr;</div></div>
  </div></a>"""


def guide_page(g, items, counts):
    slug, group, label, _, title, intro = g
    path = f"/gifts/{slug}"
    h1_word = title.split(" ", 1)
    h1 = f"{e(h1_word[0])} <em>{e(h1_word[1])}</em>" if len(h1_word) == 2 else e(title)
    bands = [(0, 25, "Under $25"), (26, 50, "$25–50"), (51, 100, "$50–100"), (101, 99999, "$100+")]
    rail = ['<button class="rf on" data-min="0" data-max="99999" aria-pressed="true">All prices</button>']
    if group != "budget":
        for lo, hi, lab in bands:
            if any(lo <= p["price"] <= hi for p in items):
                rail.append(f'<button class="rf" data-min="{lo}" data-max="{hi}" aria-pressed="false">{lab}</button>')
    related = [x for x in GUIDES if x[0] != slug and (x[1] == group or x[1] == "budget")][:10]
    rel = "".join(f'<a class="pill" href="/gifts/{x[0]}">{e(x[4])}<small>{counts[x[0]]}</small></a>' for x in related)
    lo = min(p["price"] for p in items)
    hi = max(p["price"] for p in items)
    desc = f"{len(items)} hand-picked {title.lower()} for {YEAR}, from ${lo} to ${hi}. {intro}"[:300]
    body = f"""<header class="phead">
  <div class="kicker">Gift guide &middot; {len(items)} ideas</div>
  <h1>{h1}</h1>
  <p class="sub">{e(intro)}</p>
</header>
<main id="main">
<div class="wrap wide">
  <div class="ask rv"><p><b>Shopping for someone specific?</b> Describe them and Gifty's AI picks gifts in seconds.</p>
    <a class="btn btn-fill" href="/#finder">Ask Gifty &rarr;</a></div>
  {'<div class="rail">' + ''.join(rail) + '</div>' if len(rail) > 2 else ''}
  <div class="ggrid">
{chr(10).join(card(p) for p in items)}
  </div>
  <p class="note">Prices are approximate and change often — check Amazon for today's price. Links are affiliate links.</p>
  <h2 class="sec-t">More gift guides</h2>
  <div class="related">{rel}<a class="pill" href="/gifts/">All gift guides</a></div>
</div>
</main>"""
    ld = {
        "@context": "https://schema.org", "@type": "ItemList", "name": title,
        "url": SITE + path, "numberOfItems": len(items),
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": p["name"]}
                            for i, p in enumerate(items)],
    }
    return page(f"{title} ({YEAR}): {len(items)} Ideas They'll Love — Gifty", desc, path, body, now=True, jsonld=ld)


def hub_page(counts):
    secs = []
    for key, name in GROUPS:
        tiles = []
        for g in GUIDES:
            if g[1] != key:
                continue
            sample = next(p for p in PRODUCTS if g[3](p))
            ic = {"budget": "gift", "occasion": "gift"}.get(key) or ("kids" if g[0] == "for-kids" else kind(sample))
            if key == "person":
                ic = "gift" if g[0] != "for-kids" else "kids"
            tiles.append(f'<a class="hub rv" href="/gifts/{g[0]}">{icon(ic, 30)}<span>{e(g[4])}'
                         f'<small>{counts[g[0]]} ideas</small></span></a>')
        secs.append(f'<h2 class="sec-t">{name}</h2>\n<div class="hubgrid">{"".join(tiles)}</div>')
    body = f"""<header class="phead">
  <div class="kicker">Gift ideas &middot; {len(PRODUCTS)} hand-picked products</div>
  <h1>Every kind of gift, <em>sorted.</em></h1>
  <p class="sub">Browse by person, interest, budget or occasion — or describe someone to Gifty's AI and get ideas made just for them.</p>
</header>
<main id="main">
<div class="wrap wide">
  <div class="ask rv"><p><b>Not sure where to start?</b> Tell Gifty about them in one sentence.</p>
    <a class="btn btn-fill" href="/#finder">Ask Gifty &rarr;</a></div>
  {chr(10).join(secs)}
</div>
</main>"""
    return page(f"Gift Ideas for Everyone ({YEAR}) — Gifty",
                f"{len(PRODUCTS)} hand-picked gift ideas sorted by person, interest, budget and occasion. Or ask Gifty's AI for ideas made for one specific person.",
                "/gifts/", body, now=True)


def sitemap():
    urls = []
    for f in sorted(PUBLIC.rglob("*.html")):
        rel = f.relative_to(PUBLIC).as_posix()[:-5]
        if rel == "index":
            path, pri = "/", "1.0"
        elif rel.endswith("/index"):
            path, pri = "/" + rel[:-6] + "/", "0.9"
        else:
            path = "/" + rel
            pri = "0.8" if rel.startswith("gifts/") else ("0.6" if rel.startswith("blog") else "0.3")
        urls.append(f"  <url><loc>{SITE}{path}</loc><priority>{pri}</priority></url>")
    (PUBLIC / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                        + "\n".join(urls) + "\n</urlset>\n")
    return len(urls)


def main():
    out = PUBLIC / "gifts"
    out.mkdir(exist_ok=True)
    for old in out.glob("*.html"):
        old.unlink()
    counts = {}
    for g in GUIDES:
        items = sorted((p for p in PRODUCTS if g[3](p)), key=lambda p: (p["price"], p["name"]))
        if len(items) < 6:
            sys.exit(f"guide {g[0]} has only {len(items)} products")
        counts[g[0]] = len(items)
    for g in GUIDES:
        items = sorted((p for p in PRODUCTS if g[3](p)), key=lambda p: (p["price"], p["name"]))
        (out / f"{g[0]}.html").write_text(guide_page(g, items, counts))
    (out / "index.html").write_text(hub_page(counts))
    (PUBLIC / "data").mkdir(exist_ok=True)
    (PUBLIC / "data" / "products.json").write_text(json.dumps(
        [{**p, "url": amz(p["q"])} for p in PRODUCTS], ensure_ascii=False, indent=1))
    n = sitemap()
    print(f"{len(PRODUCTS)} products, {len(GUIDES)} guides, sitemap {n} urls")
    for g in GUIDES:
        print(f"  /gifts/{g[0]:<22} {counts[g[0]]}")


if __name__ == "__main__":
    main()
