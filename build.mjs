// Builds the static site from content/ into dist/. No dependencies: run with `node build.mjs`.
// The site has two sides: Scott Hunt Photography (galleries, sidebar layout) and Rock'n H (sales and
// marketing). Each page says which side it belongs to. The root page is the entrance that leads to both.
// Anything marked as a draft is built under /drafts/<slug>/ (hidden from menus and search engines).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
// Version stamp on the stylesheet and script so browsers fetch new copies after each publish.
const ASSET_V = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src/style.css'))).update(fs.readFileSync(path.join(ROOT, 'src/site.js'))).digest('hex').slice(0, 8);
const OUT = path.join(ROOT, 'dist');
const BASE = (process.env.SITE_BASE || '/').replace(/\/?$/, '/'); // e.g. "/repo-name/" on a project Pages URL

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readDir = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...readJson(path.join(dir, f)) }))
    : [];

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slugify = (s = '') => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const url = (p = '') => BASE + String(p).replace(/^\//, '');
const absImg = (p = '') => (/^https?:/.test(p) ? p : absUrl(p));
// Full web address, for links shared outside the site (falls back to a site-relative path in local builds).
const absUrl = (p = '') => (process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') + String(p).replace(/^\//, '') : url(p));
const img = (p = '') => (/^https?:/.test(p) ? p : url(p));
// Small preview image made by scripts/thumbs.py (photos/<folder>/_thumbs/<name>); falls back to the full photo.
const thumb = (p = '') => {
  if (/^https?:/.test(p)) return p;
  const rel = String(p).replace(/^\//, '');
  const t = path.join(path.dirname(rel), '_thumbs', path.basename(rel));
  return fs.existsSync(path.join(ROOT, t)) ? url(t) : url(rel);
};
const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.title).localeCompare(String(b.title));

const site = readJson(path.join(ROOT, 'content/site.json'));
const PHOTO_NAME = site.photographyTitle || 'Scott Hunt Photography';
const ROCK_NAME = site.rocknhTitle || "Rock'n H";
const PHOTO_HOME = 'photography/';
const ROCK_HOME = 'rockn-h/';

const galleries = readDir(path.join(ROOT, 'content/galleries')).map((g) => ({ ...g, slug: g.slug || slugify(g.title), parent: slugify(g.parent || '') })).sort(byOrder);
// A gallery with a parent sits in a sub-menu under it, at /<parent>/<slug>/. Unknown parents are ignored.
for (const g of galleries) if (g.parent && (g.parent === g.slug || !galleries.some((x) => x.slug === g.parent && !x.parent))) g.parent = '';
const galleryPath = (g) => (g.parent ? `${g.parent}/${g.slug}` : g.slug);
const subGalleries = (g) => galleries.filter((x) => live(x) && x.parent === g.slug);
const pages = readDir(path.join(ROOT, 'content/pages'))
  .map((p) => ({ ...p, slug: p.slug || slugify(p.title), side: p.side === 'rocknh' ? 'rocknh' : 'photography' }))
  .sort(byOrder);

const live = (x) => !x.draft;
// Rock'n H print collections: content/collections/*.json, each with a list of prints for sale.
const collections = readDir(path.join(ROOT, 'content/collections')).map((c) => ({ ...c, slug: c.slug || slugify(c.title) })).sort(byOrder);
const usedPrintSlugs = new Set();
for (const c of collections) {
  c.prints = (c.prints || []).filter((p) => p && p.image).map((p) => {
    const base = slugify(p.title || path.basename(p.image).replace(/\.[^.]+$/, '')) || 'print';
    let slug = base, n = 2;
    while (usedPrintSlugs.has(slug)) slug = `${base}-${n++}`;
    usedPrintSlugs.add(slug);
    const options = (p.options && p.options.length ? p.options : c.options || []).filter((o) => o && o.price !== undefined && o.price !== '' && !isNaN(Number(String(o.price).replace(/[^0-9.]/g, ''))));
    return { ...p, slug, collection: c, options };
  });
}
const liveCollections = collections.filter(live);
const allPrints = liveCollections.flatMap((c) => c.prints);
const photosFor = (g) => (g.photos || []).filter((p) => p && p.image);
const menuPages = (side) => pages.filter((p) => live(p) && p.inMenu !== false && p.side === side);

// ---------- navigation ----------
function photoNav(current) {
  const link = (href, title) => `<li${href === current ? ' class="active"' : ''}><a href="${href}">${esc(title)}</a></li>`;
  const gal = galleries
    .filter((g) => live(g) && !g.parent)
    .map((g) => {
      const subs = subGalleries(g);
      if (!subs.length) return link(url(`${g.slug}/`), g.title);
      const inside = String(current).startsWith(url(`${g.slug}/`));
      return `<li class="nav-parent${inside ? ' open' : ''}${url(`${g.slug}/`) === current ? ' active' : ''}"><a href="${url(`${g.slug}/`)}" aria-expanded="${inside}"${String(g.description || '').replace(/<[^>]*>/g, '').trim() ? ' data-page' : ''}>${esc(g.title)}</a><div class="nav-sub-wrap"><ul class="nav-sub">${subs.map((x) => link(url(`${galleryPath(x)}/`), x.title)).join('')}</ul></div></li>`;
    })
    .join('');
  const pg = menuPages('photography').map((p) => link(url(`${p.slug}/`), p.menuTitle || p.title)).join('');
  return `<aside class="sidebar">
  <a class="brand" href="${url(PHOTO_HOME)}">${esc(PHOTO_NAME)}</a>
  <button class="menu-toggle" aria-label="Menu" aria-expanded="false">Menu</button>
  <nav>
    <ul class="nav-galleries">${gal}</ul>
    <ul class="nav-pages">${pg}</ul>
    <ul class="nav-other"><li><a href="${url(ROCK_HOME)}">${esc(ROCK_NAME)} →</a></li></ul>
  </nav>
</aside>`;
}

// Instagram: a handle (@name) or a full link.
const igHref = (v) => { v = String(v || '').trim(); return !v ? '' : /^https?:/.test(v) ? v : `https://www.instagram.com/${v.replace(/^@/, '')}/`; };
const IG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>';

function rockNav(current) {
  const link = (href, title) => `<li${href === current ? ' class="active"' : ''}><a href="${href}">${esc(title)}</a></li>`;
  const sub = [`<li><a href="${url(`${ROCK_HOME}collections/`)}">All Prints</a></li>`, ...liveCollections.map((c) => `<li><a href="${url(`${ROCK_HOME}collections/${c.slug}/`)}">${esc(c.title)}</a></li>`)].join('');
  const items = [
    link(url(ROCK_HOME), 'Home'),
    ...(liveCollections.length ? [`<li class="has-sub${String(current).includes('/collections/') || String(current).includes('/prints/') ? ' active' : ''}"><a href="${url(`${ROCK_HOME}collections/`)}">${esc(site.rockPrintsMenuLabel || 'The Prints')}</a><ul>${sub}</ul></li>`] : []),
    ...menuPages('rocknh').map((p) => link(url(`${p.slug}/`), p.menuTitle || p.title)),
  ].join('');
  return `<header class="site-header">
  <a class="brand" href="${url(ROCK_HOME)}">${site.rockLogo ? `<img src="${img(site.rockLogo)}" alt="${esc(ROCK_NAME)}">` : esc(ROCK_NAME)}</a>
  <button class="menu-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
  <nav><ul>${items}<li class="nav-cart"><a href="${url(`${ROCK_HOME}cart/`)}">Cart <span class="cart-count"></span></a></li><li class="nav-switch"><a href="${url(PHOTO_HOME)}">${esc(PHOTO_NAME)} →</a></li>${igHref(site.rockInstagram) ? `<li class="nav-ig"><a href="${esc(igHref(site.rockInstagram))}" target="_blank" rel="noopener" aria-label="Instagram">${IG_ICON}</a></li>` : ''}</ul></nav>
</header>`;
}

// ---------- layout ----------
// Browser-tab icons: the Scott Hunt Photography coin, or the Rock'n H coin on that side.
const iconLinks = (which) => `<link rel="icon" type="image/png" sizes="32x32" href="${url(`assets/icons/${which}-32.png`)}"><link rel="icon" type="image/png" sizes="512x512" href="${url(`assets/icons/${which}-512.png`)}"><link rel="apple-touch-icon" href="${url(`assets/icons/${which}-180.png`)}">`;

function layout({ title, body, current, side = 'photography', draft = false, bodyClass = '', description, share }) {
  const brand = side === 'rocknh' ? ROCK_NAME : side === 'entrance' ? site.title : PHOTO_NAME;
  const fullTitle = title ? `${title} · ${brand}` : brand;
  const chrome = side === 'photography' ? photoNav(current) : side === 'rocknh' ? rockNav(current) : '';
  const sideClass = side === 'photography' ? 'side-photo' : side === 'rocknh' ? 'side-rock' : 'side-entrance';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.tagline || '')}">
${draft ? '<meta name="robots" content="noindex, nofollow">' : ''}
${share ? `<meta property="og:type" content="website"><meta property="og:title" content="${esc(fullTitle)}"><meta property="og:url" content="${share.url}"><meta property="og:image" content="${share.image}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${url('assets/style.css')}?v=${ASSET_V}">
${iconLinks(side === 'rocknh' ? 'rock' : 'photo')}
</head>
<body class="${sideClass} ${bodyClass}">
${draft ? '<div class="draft-banner">Draft preview · not published · only people with this link can see it</div>' : ''}
${chrome}
<main>${body}</main>
${side === 'entrance' ? '' : `<footer class="site-footer"><p>© ${new Date().getFullYear()} ${esc(site.title)}. All photographs are protected by copyright.</p></footer>`}
<script src="${url('assets/site.js')}?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

// ---------- page bodies ----------
// Entrance: the coin intro (Variation 6). When it ends, the left coin links to the photography side
// and the right coin to Rock'n H. Within one visit, coming back here skips straight to the end.
function entranceHtml() {
  const links = { rolling: { href: url(PHOTO_HOME), label: PHOTO_NAME }, rocking: { href: url(ROCK_HOME), label: ROCK_NAME } };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.title)}</title>
<meta name="description" content="${esc(site.tagline || '')}">
${iconLinks('photo')}
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; background: #fff; color: #222; overflow: hidden; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
  #stage { position: fixed; inset: 0; background: #fff; }
  #skip { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); background: none; border: none; color: #9a958d; cursor: pointer; font: inherit; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; padding: 8px; }
  #skip:hover { color: #222; }
  .coin-label { position: absolute; transform: translateX(-50%); text-align: center; color: #a29d96; font-size: 11px; line-height: 1.5; letter-spacing: .22em; text-transform: uppercase; text-decoration: none; opacity: 0; transition: opacity 1.2s ease, color .2s; pointer-events: none; }
  .coin-label.on { opacity: 1; pointer-events: auto; }
  .coin-label:hover { color: #222; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head><body>
<h1 class="sr">${esc(site.title)}</h1>
<div id="stage"></div>
<nav class="sr"><a href="${links.rolling.href}">${esc(PHOTO_NAME)}</a> <a href="${links.rocking.href}">${esc(ROCK_NAME)}</a></nav>
<button id="skip" hidden>Skip</button>
<script src="${url('assets/intro/intro.js')}"></script>
<script>
  const $ = (id) => document.getElementById(id);
  const intro = CoinIntro.mount($('stage'), {
    rollingSrc: '${url('assets/intro/rolling-logo-black.png')}',
    rockingSrc: '${url('assets/intro/rocking-logo-inverted.png')}',
    ground: false, entry: true, rollTime: 4.5, turns: 1.5, panEase: 3.2,
    links: ${JSON.stringify(links)},
    onDone: () => { $('skip').hidden = true; requestAnimationFrame(invite); },
  });
  const LINKS = ${JSON.stringify(links)};
  // Grey names under each coin, and a gentle one-at-a-time invert so phone users see the coins are buttons.
  const labels = ['rolling', 'rocking'].map((k) => {
    const el = document.createElement('a');
    el.className = 'coin-label'; el.href = LINKS[k].href; el.textContent = LINKS[k].label; el.tabIndex = -1;
    $('stage').appendChild(el);
    return el;
  });
  const coins = () => [...$('stage').querySelectorAll('a:not(.coin-label)')];
  function placeLabels() {
    const c = coins();
    if (c.length < 2) return;
    const r = c.map((el) => ({ x: el.offsetLeft + el.offsetWidth / 2, top: el.offsetTop, d: el.offsetWidth }));
    const gap = Math.abs(r[1].x - r[0].x);
    labels.forEach((el, i) => {
      el.style.left = r[i].x + 'px';
      const small = r[i].d < 120;
      // On phones the label sits below the coin's reflection and tightens up so it wraps to two lines at most.
      el.style.top = (r[i].top + r[i].d * (small ? 1.55 : 1.12)) + 'px';
      el.style.width = Math.max(small ? 104 : 80, gap - 12) + 'px';
      el.style.fontSize = (small ? 10 : 11) + 'px';
      el.style.letterSpacing = small ? '.12em' : '';
    });
  }
  // Hovering a label inverts its coin too, and the reverse.
  labels.forEach((el, i) => {
    el.addEventListener('mouseenter', () => coins()[i]?.dispatchEvent(new Event('mouseenter')));
    el.addEventListener('mouseleave', () => coins()[i]?.dispatchEvent(new Event('mouseleave')));
  });
  // When the coins settle, the site titles fade in under them.
  function invite() {
    placeLabels();
    labels.forEach((el) => el.classList.add('on'));
  }
  window.addEventListener('resize', () => requestAnimationFrame(placeLabels));
  $('skip').addEventListener('click', () => intro.skip());
  let seen = false;
  try { seen = sessionStorage.getItem('introSeen') === '1'; sessionStorage.setItem('introSeen', '1'); } catch (e) {}
  $('skip').hidden = seen;
  intro.start().then(() => { if (seen) intro.skip(); });
</script>
</body></html>`;
}

// Photography home: one large photo at a time from the home slideshow, beside the gallery list.
function photoHomeBody() {
  const slides = (site.homeSlides || []).filter((s) => s && s.image);
  return `<section class="feature" data-interval="${Number(site.homeSlideSeconds) || 6}">${slides
    .map((s, i) => `<img class="feature-img${i === 0 ? ' on' : ''}" src="${img(s.image)}" alt=""${i ? ' loading="lazy"' : ''}>`)
    .join('')}</section>`;
}

function editionInfo(p) {
  if (!p.forSale) return '';
  const size = Number(p.editionSize) || 0;
  const sold = Number(p.editionsSold) || 0;
  const left = size ? Math.max(size - sold, 0) : null;
  const soldOut = left === 0;
  const bits = [];
  if (size) bits.push(`Limited edition of ${size}`);
  if (p.printSize) bits.push(esc(p.printSize));
  if (left !== null) bits.push(soldOut ? 'Sold out' : `${left} remaining`);
  if (p.price) bits.push(`${esc(site.currencySymbol || '$')}${esc(p.price)}`);
  const buy = !soldOut && p.buyLink ? `<a class="buy" href="${esc(p.buyLink)}" target="_blank" rel="noopener">Buy this print</a>` : soldOut ? '' : site.contactPageSlug ? `<a class="buy" href="${url(`${site.contactPageSlug}/`)}?about=${encodeURIComponent(p.title || p.image)}">Enquire</a>` : '';
  return `<div class="edition${soldOut ? ' sold-out' : ''}"><span>${bits.join(' · ')}</span>${buy}</div>`;
}

const showCaptions = site.showCaptions === true; // titles and captions stay hidden from visitors unless turned on in Site settings
const captionText = (p) => (showCaptions ? [p.title, p.caption].filter(Boolean).join(' · ') : '');

const hasIntro = (g) => String(g.description || '').replace(/<[^>]*>/g, '').trim() !== '';
// A gallery with its own photos and an Introduction opens on the introduction; the photos follow at <gallery>/photos/.
const introFirst = (g) => hasIntro(g) && photosFor(g).length > 0 && !subGalleries(g).length;
const introBody = (g) => `<section class="statement"><h1>${esc(g.title)}</h1><div class="statement-text">${g.description}</div><a class="statement-next" href="${url(`${galleryPath(g)}/photos/`)}">View the photographs →</a></section>`;

// Gallery: one large photo with arrows and a counter, plus a "show thumbnails" grid.
function galleryBody(g) {
  const photos = photosFor(g);
  const subs = subGalleries(g);
  // A gallery with sub-galleries and no photos of its own shows its sub-galleries as a grid of covers.
  // A parent gallery with an Introduction shows it as a statement page in place of the cover grid.
  if (subs.length && !photos.length && String(g.description || '').replace(/<[^>]*>/g, '').trim()) {
    return `<section class="statement"><h1>${esc(g.title)}</h1><div class="statement-text">${g.description}</div></section>`;
  }
  if (subs.length && !photos.length) {
    return `<section class="sub-index">${subs
      .map((x) => {
        const cover = x.cover || photosFor(x)[0]?.image;
        return `<a class="sub-card" href="${url(`${galleryPath(x)}/`)}">${cover ? `<img src="${thumb(cover)}" alt="" loading="lazy">` : '<span class="sub-blank"></span>'}<span>${esc(x.title)}</span></a>`;
      })
      .join('')}</section>`;
  }
  if (!photos.length) return `<section class="slideshow" aria-label="${esc(g.title)}"><p class="note">Photographs coming soon.</p></section>`;
  const data = photos.map((p) => ({ src: img(p.image), caption: captionText(p), edition: editionInfo(p), alt: p.alt || '' }));
  const first = data[0];
  return `<section class="slideshow" aria-label="${esc(g.title)}">
  ${first ? `<figure class="stage"><button class="prev" aria-label="Previous photo"></button><img src="${first.src}" alt="${esc(first.alt)}"><button class="next" aria-label="Next photo"></button></figure>` : '<p class="note">No photos in this gallery yet.</p>'}
  <div class="ss-bar">
    <span class="ss-caption">${esc(first?.caption || '')}</span>
    <span class="ss-controls"><button class="ss-prev" aria-label="Previous">‹</button><span class="ss-count">1 / ${photos.length}</span><button class="ss-next" aria-label="Next">›</button><button class="ss-thumbs">show thumbnails</button></span>
  </div>
  <div class="ss-edition">${first?.edition || ''}</div>
</section>
<section class="thumbs" hidden>${photos
    .map((p, i) => `<button class="thumb" data-index="${i}" aria-label="Photo ${i + 1}"><img src="${thumb(p.image)}" alt="" loading="lazy"></button>`)
    .join('')}</section>
<script type="application/json" class="ss-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function pageBody(p) {
  const form =
    p.contactForm && site.formEndpoint
      ? `<form class="contact" action="${esc(site.formEndpoint)}" method="POST">
  ${site.formAccessKey ? `<input type="hidden" name="access_key" value="${esc(site.formAccessKey)}">` : ''}
  <input type="hidden" name="subject" value="New message from ${esc(site.title)} website">
  <input type="checkbox" name="botcheck" class="hp" tabindex="-1" autocomplete="off">
  <label>Name<input name="name" required autocomplete="name"></label>
  <label>Email<input name="email" type="email" required autocomplete="email"></label>
  <label>Message<textarea name="message" rows="6" required></textarea></label>
  <button type="submit">Send message</button>
  <p class="form-status" aria-live="polite"></p>
</form>`
      : p.contactForm
        ? `<p class="note">The contact form will appear here once a form address is set in Site settings.</p>`
        : '';
  return `<section class="page-head"><h1>${esc(p.title)}</h1></section>
<article class="prose${p.image ? ' with-image' : ''}">${p.image ? `<img class="page-image" src="${img(p.image)}" alt="">` : ''}<div>${p.body || ''}${p.slug === PRINT_INFO_SLUG ? infoSections() : ''}${form}</div></article>`;
}


// ---------- Rock'n H (print shop) ----------
const money = (v) => `${esc(site.currencySymbol || '$')}${Number(String(v).replace(/[^0-9.]/g, '')).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const num = (v) => Number(String(v).replace(/[^0-9.]/g, ''));
// Purchase options: each print's own list, or its collection's list as the default. One row per material + size.
// Sizes match on their first two numbers, so "7x19" and "7 × 19 in (11 × 22 overall)" are the same size.
const sizeKey = (v) => { const n = String(v || '').match(/\d+(?:\.\d+)?/g); return n && n.length >= 2 ? `${n[0]}x${n[1]}` : String(v || '').trim().toLowerCase(); };
// Each option can carry its own edition size. A print records how many it has sold of each size (including sales
// from before the site); a size whose sales reach its edition drops out of the options.
const soldOf = (p, size) => (p.sales || []).filter((r) => r && sizeKey(r.size) === sizeKey(size)).reduce((a, r) => a + (Number(r.sold) || 0), 0);
const optsOf = (p) =>
  p.options
    .map((o, i) => ({ id: i, material: o.material || '', size: o.size || '', price: num(o.price), edition: Number(o.edition) || 0 }))
    .map((o) => ({ ...o, sold: soldOf(p, o.size) }))
    .filter((o) => !o.edition || o.sold < o.edition);
function fromPrice(p) {
  const prices = optsOf(p).map((o) => o.price);
  return prices.length ? `Prices from ${money(Math.min(...prices))}` : 'Price on request';
}
const soldOut = (p) =>
  (Number(p.editionSize) > 0 && (Number(p.editionsSold) || 0) >= Number(p.editionSize)) || (p.options.length > 0 && optsOf(p).length === 0);
function printCard(p) {
  return `<a class="product-card" href="${url(`${ROCK_HOME}prints/${p.slug}/`)}">
  <span class="pc-img"><img src="${thumb(p.image)}" alt="${esc(p.alt || '')}" loading="lazy">${soldOut(p) ? '<span class="badge">Sold out</span>' : ''}</span>
  <span class="pc-title">${esc(p.title || 'Untitled')}</span>
  <span class="pc-price">${soldOut(p) ? 'Sold out' : fromPrice(p)}</span>
</a>`;
}
// Shipping: a price per size for each region (regions are lists of state codes; a region with no states covers the rest
// of the U.S.). Materials listed as "shipped on request" can't go through checkout; buyers ask for a quote instead.
const listOf = (v) => String(v || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const quoteMaterials = listOf(site.rockShipOnRequest).map((m) => m.toLowerCase());
const onRequest = (material) => quoteMaterials.includes(String(material || '').trim().toLowerCase());
const shipZones = (site.rockShippingZones || []).filter((z) => z && z.name).map((z) => ({ name: String(z.name).trim(), states: listOf(z.states).map((x) => x.toUpperCase()) }));
const shipRates = (site.rockShippingRates || []).filter((r) => r && r.size && r.zone && String(r.price ?? '').trim() !== '')
  .map((r) => ({ size: String(r.size).trim(), zone: String(r.zone).trim(), price: num(r.price) }));
// Sales tax by the state an order ships to: a percentage, optionally charged on shipping too.
const salesTax = (site.rockSalesTax || []).filter((t) => t && t.state && num(t.rate) > 0)
  .flatMap((t) => listOf(t.state).map((st) => ({ state: st.toUpperCase(), rate: num(t.rate), shipping: t.taxShipping === true })));
const enquireHref = (p) => `${url(`${site.rockContactSlug || 'rockn-h-contact'}/`)}?about=${encodeURIComponent(p.title || p.slug)}`;

function newsletter() {
  if (!site.rockNewsletter || !site.formEndpoint) return '';
  return `<section class="rk-newsletter">
  <h2>${esc(site.rockNewsletterHeading || 'Be the first to see new releases')}</h2>
  <form class="contact newsletter" action="${esc(site.formEndpoint)}" method="POST">
    ${site.formAccessKey ? `<input type="hidden" name="access_key" value="${esc(site.formAccessKey)}">` : ''}
    <input type="hidden" name="subject" value="Newsletter sign-up from ${esc(ROCK_NAME)}">
    <input type="checkbox" name="botcheck" class="hp" tabindex="-1" autocomplete="off">
    <label class="sr">Email<input name="email" type="email" required placeholder="Email" autocomplete="email"></label>
    <button type="submit">Subscribe</button>
    <p class="form-status" aria-live="polite"></p>
  </form>
</section>`;
}

function rockHomeBody() {
  const featured = allPrints.filter((p) => p.featured).length ? allPrints.filter((p) => p.featured) : allPrints;
  const hero = site.rockHeroImage || allPrints[0]?.image;
  const statement = site.rockStatementText
    ? `<section class="rk-statement"><h2>${esc(site.rockStatementHeading || '')}</h2><div>${site.rockStatementText}</div><a class="rk-btn" href="${url(`${ROCK_HOME}collections/`)}">${esc(site.rockHeroButton || 'Explore the collection')}</a></section>`
    : '';
  const cards = liveCollections
    .map((c) => {
      const cover = c.cover || c.prints[0]?.image;
      return `<a class="card" href="${url(`${ROCK_HOME}collections/${c.slug}/`)}">${cover ? `<img src="${img(cover)}" alt="" loading="lazy">` : ''}<span>${esc(c.title)}</span></a>`;
    })
    .join('');
  const artist = site.rockArtistText
    ? `<section class="rk-artist">${site.rockArtistPhoto ? `<img src="${img(site.rockArtistPhoto)}" alt="">` : ''}<div><h2>${esc(site.rockArtistHeading || 'About the artist')}</h2>${site.rockArtistText}</div></section>`
    : '';
  // Room photos: prints shown on walls, full width, one after another.
  const rooms = (site.rockRoomPhotos || []).map((r) => (typeof r === 'string' ? r : r && r.image)).filter(Boolean);
  const roomsHtml = rooms.length ? `<section class="rk-rooms">${rooms.map((r) => `<img src="${img(r)}" alt="" loading="lazy">`).join('')}</section>` : '';
  return `<section class="rk-hero"${hero ? ` style="background-image:url('${img(hero)}')"` : ''}>
  <div class="rk-hero-text">
    <h1>${esc(site.rockHeroHeading || ROCK_NAME)}</h1>
    ${site.rockHeroText ? `<p>${esc(site.rockHeroText)}</p>` : ''}
    ${allPrints.length ? `<a class="rk-btn light" href="${url(`${ROCK_HOME}collections/`)}">${esc(site.rockHeroButton || 'Explore the collection')}</a>` : ''}
  </div>
</section>
${featured.length ? `<section class="rk-section"><div class="rk-head"><h2>${esc(site.rockFeaturedHeading || 'Featured prints')}</h2><a href="${url(`${ROCK_HOME}collections/`)}">View all</a></div><div class="product-grid">${featured.slice(0, 12).map(printCard).join('')}</div></section>` : ''}
${roomsHtml}
${statement}
${liveCollections.length > 1 ? `<section class="rk-section"><div class="rk-head"><h2>Collections</h2></div><div class="cards rk-cards">${cards}</div></section>` : ''}
${artist}
${newsletter()}`;
}

function collectionBody(title, prints, intro = '') {
  return `<section class="rk-section"><div class="rk-head"><h1>${esc(title)}</h1><span class="rk-count">${prints.length} ${prints.length === 1 ? 'print' : 'prints'}</span></div>
${intro ? `<div class="intro rk-intro">${intro}</div>` : ''}
<div class="product-grid">${prints.map(printCard).join('')}</div></section>
${newsletter()}`;
}

// The print information shows as drop-downs on each print page and all together on the About the Prints page.
const PRINT_INFO_SLUG = 'about-the-prints';
const infoList = () =>
  [
    ['Materials', site.rockMaterials],
    ['Limited Editions', site.rockLimitedEditions],
    ['Dimensions and Borders', site.rockDimensions],
    ['Shipping and Production Times', site.rockShippingDetails],
  ]
    .filter(([, html]) => html);
const infoSections = () => infoList().map(([t, html]) => `<section class="print-info"><h2>${t}</h2>${html}</section>`).join('');
const infoDropdowns = () => infoList().map(([t, html]) => `<details class="product-details"><summary>${t}</summary>${html}</details>`).join('');

// Share: the phone's own share sheet where there is one, otherwise copy link, email, Facebook and Pinterest.
function shareBox(p) {
  const link = absUrl(`${ROCK_HOME}prints/${p.slug}/`);
  const title = `${p.title || 'Untitled'} · ${ROCK_NAME}`;
  const e = encodeURIComponent;
  return `<div class="share" data-url="${esc(link)}" data-title="${esc(title)}">
      <button type="button" class="share-btn">Share</button>
      <div class="share-menu" hidden>
        <button type="button" class="share-copy">Copy link</button>
        <a href="mailto:?subject=${e(title)}&amp;body=${e(link)}">Email</a>
        <a href="https://www.facebook.com/sharer/sharer.php?u=${e(link)}" target="_blank" rel="noopener">Facebook</a>
        <a href="https://pinterest.com/pin/create/button/?url=${e(link)}&amp;media=${e(absImg(p.image))}&amp;description=${e(title)}" target="_blank" rel="noopener">Pinterest</a>
      </div>
    </div>`;
}

function productBody(p) {
  const opts = optsOf(p);
  const out = soldOut(p);
  const canBuy = !out && opts.length > 0;
  const materials = [...new Set(opts.map((o) => o.material))];
  const data = { slug: p.slug, title: p.title || 'Untitled', image: thumb(p.image), url: url(`${ROCK_HOME}prints/${p.slug}/`), quote: enquireHref(p),
    options: opts.map((o) => (onRequest(o.material) ? { ...o, onRequest: true } : o)) };
  const pick = (name, values) =>
    values.length > 1 || values[0]
      ? `<fieldset class="choice" data-name="${name}"><legend>${name === 'material' ? 'Material' : 'Size'}</legend>${values
          .map((v, i) => `<label class="size"><input type="radio" name="${name}" value="${esc(v)}"${i === 0 ? ' checked' : ''}><span>${esc(v || 'Standard')}</span></label>`)
          .join('')}</fieldset>`
      : '';
  return `<section class="product">
  <div class="product-img"><img class="zoom" src="${img(p.image)}" alt="${esc(p.alt || '')}" tabindex="0" role="button" aria-label="View larger"></div>
  <div class="product-info">
    <p class="crumb"><a href="${url(`${ROCK_HOME}collections/${p.collection.slug}/`)}">${esc(p.collection.title)}</a></p>
    <h1>${esc(p.title || 'Untitled')}</h1>
    <p class="price">${out ? 'Sold out' : fromPrice(p)}</p>
    ${
      canBuy
        ? `<form class="buy-form">
      ${pick('material', materials)}
      <fieldset class="choice" data-name="size"><legend>Size</legend><div class="size-list"></div></fieldset>
      <p class="edition-note"></p>
      <label class="qty">Quantity <input type="number" name="qty" min="1" max="10" value="1"></label>
      <button type="submit" class="rk-btn add-to-cart">Add to cart</button>
      <p class="ship-request" hidden>Shipping for this material is quoted on request. <a class="rk-btn" href="${enquireHref(p)}">Request a shipping quote</a></p>
      <p class="added" aria-live="polite"></p>
    </form>
    <script type="application/json" class="print-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
        : out
          ? ''
          : `<a class="rk-btn" href="${enquireHref(p)}">Enquire</a>`
    }
    ${p.description ? `<div class="product-desc">${p.description}</div>` : ''}
    ${shareBox(p)}
    ${infoDropdowns()}
  </div>
</section>`;
}

// Cart: drawn in the browser from the visitor's saved cart. Prices are always re-read from this catalog,
// never from what the browser saved. Checkout uses PayPal (cards accepted without a PayPal account).
const US_STATES = [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']];
function cartBody() {
  const catalog = Object.fromEntries(allPrints.filter((p) => !soldOut(p)).map((p) => [p.slug, { title: p.title || 'Untitled', image: thumb(p.image), url: url(`${ROCK_HOME}prints/${p.slug}/`), options: optsOf(p).filter((o) => !onRequest(o.material)) }]));
  const cfg = {
    clientId: site.rockPaypalClientId || '',
    currency: site.rockCurrency || 'USD',
    symbol: site.currencySymbol || '$',
    shipping: num(site.rockShippingCost || 0) || 0,
    zones: shipRates.length ? shipZones : [],
    rates: shipRates,
    tax: salesTax,
    store: ROCK_NAME,
    shop: url(`${ROCK_HOME}collections/`),
    contact: url(`${site.rockContactSlug || 'rockn-h-contact'}/`),
  };
  return `<section class="rk-section cart">
  <div class="rk-head"><h1>Your cart</h1></div>
  <div class="cart-items"></div>
  <div class="cart-summary" hidden>
    <p class="row"><span>Subtotal</span><span class="subtotal"></span></p>
    <label class="ship-to" hidden>Ship to <select><option value="">Choose a state</option>${US_STATES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></label>
    <p class="row"><span>Shipping</span><span class="shipping"></span></p>
    <p class="row tax-row" hidden><span>Sales tax</span><span class="tax"></span></p>
    <p class="ship-missing" hidden>We don't have a shipping price for one of these sizes yet. <a href="${cfg.contact}?about=shipping">Send us a message</a> and we'll quote it.</p>
    <p class="row total"><span>Total</span><span class="grand"></span></p>
    ${site.rockShippingNote ? `<div class="cart-note">${site.rockShippingNote}</div>` : ''}
    <div id="paypal-buttons"></div>
    <p class="checkout-off" hidden>Online checkout is being set up. To order now, <a href="${cfg.contact}?about=my%20cart">send us a message</a>.</p>
  </div>
  <div class="cart-done" hidden><h2>Thank you for your order</h2><p>A receipt is on its way to your email. We'll be in touch about production and shipping.</p></div>
</section>
<script type="application/json" class="cart-catalog">${JSON.stringify(catalog).replace(/</g, '\\u003c')}</script>
<script type="application/json" class="cart-config">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`;
}

// ---------- write ----------
function write(rel, html) {
  const file = path.join(OUT, rel, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(ROOT, 'src'), path.join(OUT, 'assets'));
copyDir(path.join(ROOT, 'photos'), path.join(OUT, 'photos'));

write('', entranceHtml());
write(PHOTO_HOME, layout({ body: photoHomeBody(), current: url(PHOTO_HOME), bodyClass: 'photo-home' }));
write(ROCK_HOME, layout({ side: 'rocknh', current: url(ROCK_HOME), body: rockHomeBody(), bodyClass: 'rock-home' }));
write(`${ROCK_HOME}cart`, layout({ title: 'Cart', side: 'rocknh', current: url(`${ROCK_HOME}cart/`), body: cartBody() }));
write(`${ROCK_HOME}collections`, layout({ title: 'All Prints', side: 'rocknh', current: url(`${ROCK_HOME}collections/`), body: collectionBody('All Prints', allPrints) }));
for (const c of collections) {
  const where = c.draft ? `drafts/collections/${c.slug}` : `${ROCK_HOME}collections/${c.slug}`;
  write(where, layout({ title: c.title, side: 'rocknh', draft: !!c.draft, current: url(`${ROCK_HOME}collections/${c.slug}/`), body: collectionBody(c.title, c.prints, c.description) }));
  for (const p of c.prints) {
    const pw = c.draft ? `drafts/prints/${p.slug}` : `${ROCK_HOME}prints/${p.slug}`;
    write(pw, layout({ title: p.title, side: 'rocknh', draft: !!c.draft, current: url(`${ROCK_HOME}prints/${p.slug}/`), body: productBody(p),
      share: { url: absUrl(`${ROCK_HOME}prints/${p.slug}/`), image: absImg(p.image) } }));
  }
}
// Old addresses: send visitors to the right side.
const redirect = (to) => `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${to}"><link rel="canonical" href="${to}">`;
write('galleries', redirect(url(PHOTO_HOME)));
write('prints', redirect(url(`${ROCK_HOME}collections/`)));
if (!galleries.some((g) => g.slug === 'pocket-pictures' && !g.parent)) write('pocket-pictures', redirect(url(galleries.some((g) => g.slug === 'pocket-pictures' && g.parent === 'anthologies') ? 'anthologies/pocket-pictures/' : 'anthologies/'))); // renamed 2026-10-15

const drafts = [];
for (const g of galleries) {
  const where = g.draft ? `drafts/${galleryPath(g)}` : galleryPath(g);
  const current = url(`${galleryPath(g)}/`);
  if (introFirst(g)) {
    write(where, layout({ title: g.title, body: introBody(g), current, draft: !!g.draft, bodyClass: 'gallery-page' }));
    write(`${where}/photos`, layout({ title: g.title, body: galleryBody(g), current, draft: !!g.draft, bodyClass: 'gallery-page' }));
  } else write(where, layout({ title: g.title, body: galleryBody(g), current, draft: !!g.draft, bodyClass: 'gallery-page' }));
  if (g.draft) drafts.push({ kind: 'Gallery', title: g.title, href: url(`${where}/`) });
}
for (const c of collections.filter((c) => c.draft)) drafts.push({ kind: 'Print collection', title: c.title, href: url(`drafts/collections/${c.slug}/`) });
for (const p of pages) {
  const where = p.draft ? `drafts/${p.slug}` : p.slug;
  write(where, layout({ title: p.title, side: p.side, body: pageBody(p), current: url(`${p.slug}/`), draft: !!p.draft }));
  if (p.draft) drafts.push({ kind: 'Page', title: p.title, href: url(`${where}/`) });
}
write(
  'drafts',
  layout({
    title: 'Drafts',
    draft: true,
    body: `<section class="page-head"><h1>Drafts</h1><div class="intro"><p>Everything here is unpublished. Turn off “Draft” in the editor to publish it.</p></div></section>
<article class="prose"><div>${drafts.length ? `<ul>${drafts.map((d) => `<li>${d.kind}: <a href="${d.href}">${esc(d.title)}</a></li>`).join('')}</ul>` : '<p>No drafts right now.</p>'}</div></article>`,
  }),
);
fs.writeFileSync(path.join(OUT, '404.html'), layout({ title: 'Not found', body: `<section class="page-head"><h1>Page not found</h1><div class="intro"><p><a href="${url()}">Back to the home page</a></p></div></section>` }));
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /drafts/\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
if (site.customDomain) fs.writeFileSync(path.join(OUT, 'CNAME'), site.customDomain + '\n');

console.log(`Built ${galleries.filter(live).length} galleries, ${pages.filter(live).length} pages, ${allPrints.length} prints in ${liveCollections.length} collections, ${drafts.length} drafts.`);
