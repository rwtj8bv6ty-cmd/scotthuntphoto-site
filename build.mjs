// Builds the static site from content/ into dist/. No dependencies: run with `node build.mjs`.
// The site has two sides: Scott Hunt Photography (galleries, sidebar layout) and Rock'n H (sales and
// marketing). Each page says which side it belongs to. The root page is the entrance that leads to both.
// Anything marked as a draft is built under /drafts/<slug>/ (hidden from menus and search engines).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
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

const galleries = readDir(path.join(ROOT, 'content/galleries')).map((g) => ({ ...g, slug: g.slug || slugify(g.title) })).sort(byOrder);
const pages = readDir(path.join(ROOT, 'content/pages'))
  .map((p) => ({ ...p, slug: p.slug || slugify(p.title), side: p.side === 'rocknh' ? 'rocknh' : 'photography' }))
  .sort(byOrder);

const live = (x) => !x.draft;
const photosFor = (g) => (g.photos || []).filter((p) => p && p.image);
const forSale = galleries.filter(live).flatMap((g) => photosFor(g).filter((p) => p.forSale).map((p) => ({ ...p, gallery: g })));
const showShop = site.showShop !== false && forSale.length > 0;
const menuPages = (side) => pages.filter((p) => live(p) && p.inMenu !== false && p.side === side && p.slug !== 'rockn-h');

// ---------- navigation ----------
function photoNav(current) {
  const link = (href, title) => `<li${href === current ? ' class="active"' : ''}><a href="${href}">${esc(title)}</a></li>`;
  const gal = galleries.filter(live).map((g) => link(url(`${g.slug}/`), g.title)).join('');
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

function rockNav(current) {
  const link = (href, title) => `<li${href === current ? ' class="active"' : ''}><a href="${href}">${esc(title)}</a></li>`;
  const items = [
    ...(showShop ? [link(url('prints/'), site.shopMenuLabel || 'Prints')] : []),
    ...menuPages('rocknh').map((p) => link(url(`${p.slug}/`), p.menuTitle || p.title)),
    `<li><a href="${url(PHOTO_HOME)}">${esc(PHOTO_NAME)} →</a></li>`,
  ].join('');
  return `<header class="site-header">
  <a class="brand" href="${url(ROCK_HOME)}">${esc(ROCK_NAME)}</a>
  <button class="menu-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
  <nav><ul>${items}</ul></nav>
</header>`;
}

// ---------- layout ----------
function layout({ title, body, current, side = 'photography', draft = false, bodyClass = '', description }) {
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
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${url('assets/style.css')}">
</head>
<body class="${sideClass} ${bodyClass}">
${draft ? '<div class="draft-banner">Draft preview · not published · only people with this link can see it</div>' : ''}
${chrome}
<main>${body}</main>
${side === 'entrance' ? '' : `<footer class="site-footer"><p>© ${new Date().getFullYear()} ${esc(site.title)}. All photographs are protected by copyright.</p></footer>`}
<script src="${url('assets/site.js')}" defer></script>
</body>
</html>`;
}

// ---------- page bodies ----------
// Entrance: a stand-in until the coin intro is chosen. Two doors: photography and Rock'n H.
function entranceBody() {
  const slides = (site.homeSlides || []).filter((s) => s && s.image);
  const slideHtml = slides
    .map((s, i) => `<div class="slide${i === 0 ? ' on' : ''}" style="background-image:url('${img(s.image)}')" role="img" aria-label=""></div>`)
    .join('');
  return `<section class="hero" data-interval="${Number(site.homeSlideSeconds) || 6}">
  <div class="slides">${slideHtml}</div>
  <div class="hero-text doors">
    <a class="door" href="${url(PHOTO_HOME)}">${esc(PHOTO_NAME)}</a>
    <a class="door" href="${url(ROCK_HOME)}">${esc(ROCK_NAME)}</a>
  </div>
</section>`;
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

// Gallery: one large photo with arrows and a counter, plus a "show thumbnails" grid.
function galleryBody(g) {
  const photos = photosFor(g);
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

function shopBody() {
  return `<section class="page-head"><h1>${esc(site.shopMenuLabel || 'Prints')}</h1>${site.shopIntro ? `<div class="intro">${site.shopIntro}</div>` : ''}</section>
<section class="shop-grid">${forSale
    .map((p) => `<figure class="shop-item"><img src="${thumb(p.image)}" alt="${esc(p.alt || '')}" loading="lazy">${editionInfo(p)}</figure>`)
    .join('')}</section>`;
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
<article class="prose${p.image ? ' with-image' : ''}">${p.image ? `<img class="page-image" src="${img(p.image)}" alt="">` : ''}<div>${p.body || ''}${form}</div></article>`;
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

write('', layout({ body: entranceBody(), side: 'entrance', bodyClass: 'home' }));
write(PHOTO_HOME, layout({ body: photoHomeBody(), current: url(PHOTO_HOME), bodyClass: 'photo-home' }));
// The Rock'n H landing page is the page with the slug "rockn-h"; a placeholder is used until it exists.
const rockHome = pages.find((p) => p.slug === 'rockn-h' && live(p));
write(
  ROCK_HOME,
  layout({
    title: rockHome?.title,
    side: 'rocknh',
    current: url(ROCK_HOME),
    body: rockHome ? pageBody(rockHome) : `<section class="page-head"><h1>${esc(ROCK_NAME)}</h1><div class="intro"><p>Coming soon.</p></div></section>`,
  }),
);
// Old address of the galleries list: send visitors to the photography side.
write('galleries', `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${url(PHOTO_HOME)}"><link rel="canonical" href="${url(PHOTO_HOME)}">`);
if (showShop) write('prints', layout({ title: site.shopMenuLabel || 'Prints', side: 'rocknh', body: shopBody(), current: url('prints/') }));

const drafts = [];
for (const g of galleries) {
  const where = g.draft ? `drafts/${g.slug}` : g.slug;
  write(where, layout({ title: g.title, body: galleryBody(g), current: url(`${g.slug}/`), draft: !!g.draft, bodyClass: 'gallery-page' }));
  if (g.draft) drafts.push({ kind: 'Gallery', title: g.title, href: url(`${where}/`) });
}
for (const p of pages) {
  if (p.slug === 'rockn-h' && live(p)) continue;
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

console.log(`Built ${galleries.filter(live).length} galleries, ${pages.filter(live).length} pages, ${forSale.length} prints for sale, ${drafts.length} drafts.`);
