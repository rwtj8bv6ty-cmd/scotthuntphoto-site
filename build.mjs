// Builds the static site from content/ into dist/. No dependencies: run with `node build.mjs`.
// Published pages go to their normal URLs. Anything marked as a draft is built under
// /drafts/<slug>/ (hidden from menus and search engines) so it can be previewed before publishing.
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
const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.title).localeCompare(String(b.title));

const site = readJson(path.join(ROOT, 'content/site.json'));
const galleries = readDir(path.join(ROOT, 'content/galleries')).map((g) => ({ ...g, slug: g.slug || slugify(g.title) })).sort(byOrder);
const pages = readDir(path.join(ROOT, 'content/pages')).map((p) => ({ ...p, slug: p.slug || slugify(p.title) })).sort(byOrder);

const live = (x) => !x.draft;
const photosFor = (g) => (g.photos || []).filter((p) => p && p.image);
const forSale = galleries.filter(live).flatMap((g) => photosFor(g).filter((p) => p.forSale).map((p) => ({ ...p, gallery: g })));

// ---------- navigation ----------
function navItems() {
  const items = [];
  const liveGalleries = galleries.filter(live);
  if (liveGalleries.length) items.push({ title: site.galleriesMenuLabel || 'Galleries', href: url('galleries/'), children: liveGalleries.map((g) => ({ title: g.title, href: url(`${g.slug}/`) })) });
  if (site.showShop !== false && forSale.length) items.push({ title: site.shopMenuLabel || 'Prints', href: url('prints/') });
  for (const p of pages.filter((p) => live(p) && p.inMenu !== false)) items.push({ title: p.menuTitle || p.title, href: url(`${p.slug}/`) });
  return items;
}

function nav(current) {
  const li = navItems()
    .map((i) => {
      const active = current && (i.href === current || (i.children || []).some((c) => c.href === current)) ? ' class="active"' : '';
      if (!i.children) return `<li${active}><a href="${i.href}">${esc(i.title)}</a></li>`;
      return `<li class="has-sub${active ? ' active' : ''}"><a href="${i.href}">${esc(i.title)}</a><ul>${i.children
        .map((c) => `<li><a href="${c.href}">${esc(c.title)}</a></li>`)
        .join('')}</ul></li>`;
    })
    .join('');
  return `<header class="site-header">
  <a class="brand" href="${url()}">${esc(site.title)}</a>
  <button class="menu-toggle" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
  <nav><ul>${li}</ul></nav>
</header>`;
}

// ---------- layout ----------
function layout({ title, body, current, draft = false, bodyClass = '', description }) {
  const fullTitle = title ? `${title} · ${site.title}` : site.title;
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
<body class="${bodyClass}">
${draft ? '<div class="draft-banner">Draft preview · not published · only people with this link can see it</div>' : ''}
${nav(current)}
<main>${body}</main>
<footer class="site-footer"><p>© ${new Date().getFullYear()} ${esc(site.title)}. All photographs are protected by copyright.</p></footer>
<script src="${url('assets/site.js')}" defer></script>
</body>
</html>`;
}

// ---------- page bodies ----------
function homeBody() {
  const slides = (site.homeSlides || []).filter((s) => s && s.image);
  const slideHtml = slides
    .map((s, i) => `<div class="slide${i === 0 ? ' on' : ''}" style="background-image:url('${img(s.image)}')" role="img" aria-label="${esc(s.title || '')}"></div>`)
    .join('');
  const featured = galleries.filter(live).filter((g) => g.featured !== false);
  const cards = featured
    .map((g) => {
      const cover = g.cover || photosFor(g)[0]?.image;
      return `<a class="card" href="${url(`${g.slug}/`)}">${cover ? `<img src="${img(cover)}" alt="" loading="lazy">` : ''}<span>${esc(g.title)}</span></a>`;
    })
    .join('');
  return `<section class="hero" data-interval="${Number(site.homeSlideSeconds) || 6}">
  <div class="slides">${slideHtml}</div>
  <div class="hero-text">
    <h1 class="reveal">${esc(site.title).split('').map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</h1>
    ${site.tagline ? `<p class="tagline">${esc(site.tagline)}</p>` : ''}
    ${featured.length ? `<a class="hero-cta" href="#work">${esc(site.homeButtonLabel || 'View the work')}</a>` : ''}
  </div>
</section>
${featured.length ? `<section id="work" class="cards">${cards}</section>` : ''}`;
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

function photoFigure(p, i) {
  const show = site.showCaptions === true; // titles and captions stay hidden from visitors unless turned on in Site settings
  const data = { src: img(p.image), title: show ? p.title || '' : '', caption: show ? p.caption || '' : '', edition: editionInfo(p) };
  return `<figure class="photo" data-index="${i}" data-photo='${esc(JSON.stringify(data))}'>
  <button class="open" aria-label="View photo larger"><img src="${img(p.image)}" alt="${esc(p.alt || '')}" loading="lazy"></button>
  ${show && (p.title || p.caption) ? `<figcaption>${p.title ? `<strong>${esc(p.title)}</strong>` : ''}${p.caption ? ` <span>${esc(p.caption)}</span>` : ''}</figcaption>` : ''}
  ${editionInfo(p)}
</figure>`;
}

const lightbox = `<div class="lightbox" hidden><button class="lb-close" aria-label="Close">×</button><button class="lb-prev" aria-label="Previous">‹</button><figure><img alt=""><figcaption></figcaption></figure><button class="lb-next" aria-label="Next">›</button></div>`;

function galleryBody(g) {
  const photos = photosFor(g);
  return `<section class="page-head"><h1>${esc(g.title)}</h1>${g.description ? `<div class="intro">${g.description}</div>` : ''}</section>
<section class="gallery layout-${esc(g.layout || 'masonry')}">${photos.map(photoFigure).join('')}</section>${lightbox}`;
}

function galleriesIndexBody() {
  return `<section class="page-head"><h1>${esc(site.galleriesMenuLabel || 'Galleries')}</h1></section>
<section class="cards">${galleries
    .filter(live)
    .map((g) => {
      const cover = g.cover || photosFor(g)[0]?.image;
      return `<a class="card" href="${url(`${g.slug}/`)}">${cover ? `<img src="${img(cover)}" alt="" loading="lazy">` : ''}<span>${esc(g.title)}</span></a>`;
    })
    .join('')}</section>`;
}

function shopBody() {
  return `<section class="page-head"><h1>${esc(site.shopMenuLabel || 'Prints')}</h1>${site.shopIntro ? `<div class="intro">${site.shopIntro}</div>` : ''}</section>
<section class="gallery layout-grid shop">${forSale.map(photoFigure).join('')}</section>${lightbox}`;
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

write('', layout({ body: homeBody(), current: url(), bodyClass: 'home' }));
if (galleries.some(live)) write('galleries', layout({ title: site.galleriesMenuLabel || 'Galleries', body: galleriesIndexBody(), current: url('galleries/') }));
if (site.showShop !== false && forSale.length) write('prints', layout({ title: site.shopMenuLabel || 'Prints', body: shopBody(), current: url('prints/') }));

const drafts = [];
for (const g of galleries) {
  const where = g.draft ? `drafts/${g.slug}` : g.slug;
  write(where, layout({ title: g.title, body: galleryBody(g), current: url(`${g.slug}/`), draft: !!g.draft }));
  if (g.draft) drafts.push({ kind: 'Gallery', title: g.title, href: url(`${where}/`) });
}
for (const p of pages) {
  const where = p.draft ? `drafts/${p.slug}` : p.slug;
  write(where, layout({ title: p.title, body: pageBody(p), current: url(`${p.slug}/`), draft: !!p.draft }));
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
