// Scott Hunt Site Manager: edits the website's content (content/*.json and photos/) and publishes it to GitHub.
// The forms come from the site's own .pages.yml, so new kinds of content added to the site show up here too.
'use strict';

// ---------- small helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value' || k === 'checked' || k === 'innerHTML') el[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const $ = (sel, el = document) => el.querySelector(sel);
const slugify = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirname = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const serialize = (data) => JSON.stringify(data, null, 2);
const cleanLabel = (s) => String(s || '').replace(/\s*\((drag to reorder|e\.g\.[^)]*)\)\s*/gi, ' ').replace(/\s+([.,])/g, '$1').trim();
// Labels inside a group view don't need the group's name in front ("Checkout: currency code" -> "Currency code").
const shortLabel = (s) => { const t = cleanLabel(s).replace(/^(print pages|checkout):\s*/i, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const columnLabel = (s) => cleanLabel(s).replace(/\s*\([^)]*\)\s*/g, ' ').trim();

let toastTimer;
function toast(text, action) {
  const el = $('#toast');
  el.replaceChildren(...[h('span', {}, text), action ? h('button', { class: 'link', onclick: () => { el.hidden = true; action.run(); } }, action.label) : null].filter(Boolean));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3500);
}

function modal(title, body, buttons, opts = {}) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(null); };
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
      title ? h('h2', {}, title) : null,
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-buttons' }, buttons.map((b) => h('button', {
        class: b.primary ? 'primary' : b.danger ? 'danger' : '',
        onclick: async () => { if (b.check && !(await b.check())) return; close(b.value !== undefined ? b.value : b.label); },
      }, b.label))));
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back && !opts.sticky) close(null); } }, box);
    document.body.append(back);
    document.addEventListener('keydown', key);
    const first = box.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    if (opts.onOpen) opts.onOpen(box, close);
  });
}
async function askText(title, label, initial = '', okLabel = 'OK') {
  const input = h('input', { type: 'text', value: initial });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
  let ok;
  const res = modal(title, h('label', { class: 'field' }, h('span', {}, label), input),
    [{ label: 'Cancel', value: null }, { label: okLabel, primary: true, value: 'ok' }],
    { onOpen: (box) => { ok = box.querySelector('.modal-buttons .primary'); } });
  return (await res) === 'ok' ? input.value.trim() : null;
}
const confirmBox = (title, text, okLabel, danger = true) =>
  modal(title, h('p', {}, text), [{ label: 'Cancel', value: false }, { label: okLabel, value: true, danger, primary: !danger }]);

// ---------- state ----------
const S = {
  config: null,
  repo: null,
  snap: null,        // { commit, treeSha, files: Map(path -> sha) }
  schema: [],        // content entries from .pages.yml
  media: { input: 'photos', output: '/photos' },
  docs: new Map(),   // path -> { path, entry, data, canon, isNew, deleted }
  uploads: new Map(),// repo path -> { blob, thumb, url, thumbUrl }
  initialRefs: new Set(),
  undo: [],
  view: { type: 'start' },
};

const PHOTO_SIDE_FIELDS = new Set(['photographyTitle', 'homeSlides', 'homeSlideSeconds', 'homeButtonLabel', 'galleriesMenuLabel', 'showCaptions']);
const SIDES = { photography: 'Scott Hunt Photography', rocknh: "Rock'n H" };

function entrySide(entry) {
  if (/^rock'?n'? ?h\b/i.test(entry.label || '')) return 'rocknh';
  if (entry.type === 'collection' && entry.fields.some((f) => f.name === 'side')) return 'split';
  if (entry.type === 'file' && entry.name === 'site') return 'fields';
  return 'photography';
}
// Groups of site.json fields, each its own page in the sidebar.
const GROUPS = {
  photography: { side: 'photography', title: 'Home page' },
  rocknh: { side: 'rocknh', title: 'Home page & artist' },
  'rocknh-print': { side: 'rocknh', title: 'Print pages' },
  'rocknh-checkout': { side: 'rocknh', title: 'Checkout' },
  settings: { side: 'settings', title: 'Site settings' },
};
function fieldGroup(entry, f) {
  if (entry.side !== 'fields') return entry.side;
  if (/^checkout:/i.test(f.label || '') || /^rock(Paypal|Currency|ShippingCost|ShippingNote|Checkout)/.test(f.name)) return 'rocknh-checkout';
  if (/^print pages:/i.test(f.label || '') || /^rock(PrintDetails|LimitedEditions|Dimensions|ShippingDetails)/.test(f.name)) return 'rocknh-print';
  if (/^rock/i.test(f.name)) return 'rocknh';
  if (PHOTO_SIDE_FIELDS.has(f.name)) return 'photography';
  return 'settings';
}
function docSide(doc) {
  if (doc.entry.side !== 'split') return doc.entry.side;
  const f = doc.entry.fields.find((x) => x.name === 'side');
  return doc.data.side || (f && f.default) || 'photography';
}
const docTitle = (doc) => String(doc.data[doc.entry.primary] || doc.data.title || basename(doc.path).replace(/\.json$/, '')) || 'Untitled';
const kindName = (entry) => entry.name === 'galleries' ? 'gallery' : entry.name === 'collections' ? 'print collection'
  : cleanLabel(entry.label).replace(/^rock'?n'? ?h\s*/i, '').replace(/ies$/, 'y').replace(/s$/, '').toLowerCase() || 'item';
const isImageList = (f) => f && f.type === 'object' && f.list && (f.fields || []).some((s) => s.type === 'image');
const imageKey = (f) => f.fields.find((s) => s.type === 'image').name;
const photoListField = (entry) => entry.fields.find(isImageList);
const liveDocs = (entry) => [...S.docs.values()].filter((d) => d.entry === entry && !d.deleted);
function sortedDocs(entry, side) {
  return liveDocs(entry).filter((d) => !side || entry.side !== 'split' || docSide(d) === side)
    .sort((a, b) => (num(a.data.order) - num(b.data.order)) || docTitle(a).localeCompare(docTitle(b)));
}
const num = (v) => (typeof v === 'number' ? v : v === '' || v == null ? 9999 : Number(v) || 9999);

// Sub-galleries: a gallery whose `parent` is another (main) gallery's web address sits in a sub-menu under it.
// Same rule as the site's build.mjs: slug = its own slug, else the title made web-safe.
const siteSlug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hasParents = (entry) => entry.fields.some((f) => f.name === 'parent');
const docSlug = (d) => d.data.slug || siteSlug(d.data[d.entry.primary] || d.data.title);
function parentOf(d) {
  if (!hasParents(d.entry) || !d.data.parent) return null;
  const want = siteSlug(d.data.parent);
  return liveDocs(d.entry).find((x) => x !== d && !x.data.parent && docSlug(x) === want) || null;
}
const childrenOf = (d) => (hasParents(d.entry) ? sortedDocs(d.entry).filter((x) => parentOf(x) === d) : []);
const siblingsOf = (d, side) => sortedDocs(d.entry, side).filter((x) => parentOf(x) === parentOf(d));
const fullTitle = (d) => (parentOf(d) ? `${docTitle(parentOf(d))} › ${docTitle(d)}` : docTitle(d));
const isDirty = (d) => (d.deleted ? !d.isNew : d.isNew || serialize(d.data) !== d.canon);

// ---------- photos ----------
const inDir = () => S.media.input.replace(/\/$/, '');
const outDir = () => S.media.output.replace(/\/$/, '');
function repoPathOf(value) {
  if (!value || typeof value !== 'string' || /^https?:/i.test(value)) return null;
  let v = value.trim();
  if (v.startsWith(outDir() + '/')) return inDir() + v.slice(outDir().length);
  return v.replace(/^\//, '');
}
const valueOf = (repoPath) => outDir() + repoPath.slice(inDir().length);
const thumbPath = (p) => `${dirname(p)}/_thumbs/${basename(p)}`;
function imgSrc(value, full) {
  if (typeof value === 'string' && /^https?:/i.test(value)) return value;
  const p = repoPathOf(value);
  if (!p) return '';
  const up = S.uploads.get(p);
  if (up) return full ? up.url : up.thumbUrl;
  const sha = (!full && S.snap.files.get(thumbPath(p))) || S.snap.files.get(p);
  return sha ? Native.blobURL(S.config.owner, S.config.repo, sha) : '';
}
const isPhotoPath = (p) => p.startsWith(inDir() + '/') && !p.includes('/_thumbs/') && /\.(jpe?g|png|webp|gif)$/i.test(p);
function allPhotoPaths() {
  const set = new Set([...S.snap.files.keys()].filter(isPhotoPath));
  for (const p of S.uploads.keys()) set.add(p);
  return [...set].sort();
}
function collectRefs(value, out) {
  if (typeof value === 'string') { const p = repoPathOf(value); if (p && isPhotoPath(p)) out.add(p); }
  else if (Array.isArray(value)) value.forEach((v) => collectRefs(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectRefs(v, out));
  return out;
}
const currentRefs = () => collectRefs([...S.docs.values()].filter((d) => !d.deleted).map((d) => d.data), new Set());

async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } finally { URL.revokeObjectURL(url); }
  return img;
}
function scaleImage(img, max, quality) {
  const w = img.naturalWidth, ht = img.naturalHeight;
  const r = Math.min(1, max / Math.max(w, ht));
  const tw = Math.round(w * r), th = Math.round(ht * r);
  let src = img, sw = w, sh = ht;
  // Halve in steps first; one big jump down looks jagged.
  while (sw / 2 >= tw * 1.25) {
    const c = h('canvas', { width: Math.round(sw / 2), height: Math.round(sh / 2) });
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  const c = h('canvas', { width: tw, height: th });
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, tw, th);
  x.drawImage(src, 0, 0, tw, th);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not convert the photo'))), 'image/jpeg', quality));
}
function uniquePhotoPath(folder, name) {
  const base = slugify(name.replace(/\.[^.]+$/, '')) || 'photo';
  let p = `${folder}/${base}.jpg`;
  for (let n = 2; S.snap.files.has(p) || S.uploads.has(p); n++) p = `${folder}/${base}-${n}.jpg`;
  return p;
}
const looksLikeImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|tiff?|gif)$/i.test(f.name);
// Resizes the chosen files for the web and keeps them ready to publish. Returns their content values.
async function prepareUploads(files, folder) {
  files = [...files].filter(looksLikeImage);
  const values = [], failed = [];
  for (let i = 0; i < files.length; i++) {
    toast(`Preparing photo ${i + 1} of ${files.length}…`);
    try {
      const img = await decodeImage(files[i]);
      const blob = await scaleImage(img, 2500, 0.86);
      const thumb = await scaleImage(img, 400, 0.78);
      const path = uniquePhotoPath(folder, files[i].name);
      S.uploads.set(path, { blob, thumb, url: URL.createObjectURL(blob), thumbUrl: URL.createObjectURL(thumb) });
      values.push(valueOf(path));
    } catch {
      failed.push(files[i].name);
    }
  }
  if (failed.length) toast(`Couldn't read ${plural(failed.length, 'file')}: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`);
  else if (values.length) toast(`Added ${plural(values.length, 'photo')}. Publish when you're ready.`);
  return values;
}
function uploadFolder(doc) {
  if (!doc || doc.entry.type !== 'collection') return `${inDir()}/site`;
  const own = slugify(doc.data.slug || docTitle(doc)) || 'photos';
  const parent = parentOf(doc);
  return parent ? `${inDir()}/${slugify(docSlug(parent))}/${own}` : `${inDir()}/${own}`;
}

function chooseFiles(multiple = true) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*,.heic,.heif', multiple, style: 'display:none' });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- undo ----------
function snapshotState() {
  return JSON.stringify([...S.docs.values()].map((d) => [d.path, d.entry.name, d.deleted, d.isNew, d.data, d.canon]));
}
function checkpoint() {
  const s = snapshotState();
  if (S.undo[S.undo.length - 1] !== s) { S.undo.push(s); if (S.undo.length > 80) S.undo.shift(); }
}
function undo() {
  const cur = snapshotState();
  let s;
  do s = S.undo.pop(); while (s === cur);
  if (!s) return toast('Nothing to undo.');
  S.docs = new Map(JSON.parse(s).map(([path, name, deleted, isNew, data, canon]) =>
    [path, { path, entry: S.schema.find((e) => e.name === name), deleted, isNew, data, canon }]));
  if (S.view.path && !S.docs.has(S.view.path)) S.view = { type: 'home' };
  render();
  toast('Undone.');
}

// ---------- loading ----------
async function start() {
  S.config = Object.assign({ owner: 'rwtj8bv6ty-cmd', repo: 'scotthuntphoto-site', branch: 'main' }, await Native.loadConfig());
  if (!S.config.token && Native.inApp) return renderSetup();
  await loadAll();
}

async function loadAll(keepView) {
  const app = $('#app');
  app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'spinner' }), h('p', {}, 'Loading your website…')));
  try {
    S.repo = new GitHub.Repo(S.config);
    S.snap = await S.repo.snapshot();
    const ymlSha = S.snap.files.get('.pages.yml');
    if (!ymlSha) throw new Error('This repository has no .pages.yml, so the app does not know how the content is laid out.');
    const y = YAML.parse(await S.repo.readText(ymlSha)) || {};
    const m = Array.isArray(y.media) ? y.media[0] : y.media;
    S.media = typeof m === 'string' ? { input: m, output: '/' + m } : { input: (m && m.input) || 'photos', output: (m && m.output) || '/photos' };
    S.schema = (y.content || []).filter((e) => (e.format || 'json') === 'json').map((e) => {
      const entry = { ...e, fields: e.fields || [], primary: (e.view && e.view.primary) || 'title' };
      entry.side = entrySide(entry);
      return entry;
    });
    const wanted = [];
    for (const entry of S.schema) {
      if (entry.type === 'collection') {
        for (const p of S.snap.files.keys()) if (dirname(p) === entry.path && p.endsWith('.json')) wanted.push([p, entry]);
      } else if (S.snap.files.has(entry.path)) wanted.push([entry.path, entry]);
    }
    const texts = await S.repo.readMany(wanted.map(([p]) => S.snap.files.get(p)));
    S.docs = new Map();
    wanted.forEach(([path, entry], i) => {
      let data;
      try { data = JSON.parse(texts[i]); } catch { data = {}; }
      S.docs.set(path, { path, entry, data, canon: serialize(data), isNew: false, deleted: false });
    });
    for (const entry of S.schema) {
      if (entry.type === 'file' && !S.docs.has(entry.path)) S.docs.set(entry.path, { path: entry.path, entry, data: {}, canon: serialize({}), isNew: false, deleted: false });
    }
    addFieldsFoundInContent();
    S.initialRefs = currentRefs();
    for (const [p, u] of S.uploads) if (S.snap.files.has(p)) { URL.revokeObjectURL(u.url); URL.revokeObjectURL(u.thumbUrl); S.uploads.delete(p); }
    S.undo = [];
    if (!keepView || (S.view.path && !S.docs.has(S.view.path))) S.view = { type: 'home' };
    render();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'center' },
      h('h2', {}, "Couldn't load the website"), h('p', { class: 'muted' }, e.message),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => loadAll() }, 'Try again'),
        h('button', { onclick: renderSetup }, 'Account settings'))));
  }
}

// Settings the site uses but .pages.yml doesn't list yet (e.g. a page's menu name) are still editable:
// any plain value found at the top level of a content file becomes a field for that kind of content.
const EXTRA_LABELS = {
  menuTitle: 'Name in the menu (leave blank to use the title)',
  rockPrintsMenuLabel: "Rock'n H menu name for the prints",
};
const OBSOLETE = new Set(['forSale', 'printSize', 'price', 'buyLink']);
function addFieldsFoundInContent() {
  for (const entry of S.schema) {
    const known = new Set(entry.fields.map((f) => f.name));
    for (const d of S.docs.values()) {
      if (d.entry !== entry) continue;
      for (const [k, v] of Object.entries(d.data)) {
        if (known.has(k) || OBSOLETE.has(k) || v === null || typeof v === 'object') continue;
        known.add(k);
        const label = EXTRA_LABELS[k] || (k.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
        entry.fields.push({ name: k, label, type: typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string', found: true });
      }
    }
  }
}

// ---------- setup ----------
function renderSetup() {
  const c = S.config;
  const token = h('input', { type: 'password', placeholder: 'ghp_…', value: c.token || '' });
  const repo = h('input', { type: 'text', value: `${c.owner}/${c.repo}` });
  const branch = h('input', { type: 'text', value: c.branch });
  const msg = h('p', { class: 'error' });
  const tokenURL = 'https://github.com/settings/tokens/new?scopes=repo&description=Scott%20Hunt%20Site%20Manager';
  async function connect() {
    const [owner, name] = repo.value.trim().split('/');
    const next = { ...c, token: token.value.trim(), owner, repo: name, branch: branch.value.trim() || 'main' };
    if (!next.token && Native.inApp) return (msg.textContent = 'Paste your access key first.');
    msg.textContent = 'Checking…';
    try {
      const prev = S.config;
      S.config = next;
      await Native.saveConfig(next);
      const info = await new GitHub.Repo(next).info();
      if (info.permissions && !info.permissions.push) {
        S.config = prev;
        return (msg.textContent = 'This key can read the website but not change it. Make a key with the "repo" box ticked.');
      }
      await loadAll();
    } catch (e) {
      msg.textContent = e.message;
    }
  }
  token.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  $('#app').replaceChildren(h('div', { class: 'setup' },
    h('img', { src: 'icon.png', class: 'setup-logo', alt: '' }),
    h('h1', {}, 'Connect to your website'),
    h('p', {}, 'The app saves your changes straight to your website on GitHub. It needs an access key from GitHub once; it stays on this Mac.'),
    h('ol', {},
      h('li', {}, h('button', { class: 'link', onclick: () => Native.open(tokenURL) }, 'Open GitHub to make a key'), ' (sign in if asked). The note and the ', h('b', {}, 'repo'), ' box are filled in for you.'),
      h('li', {}, 'Under ', h('b', {}, 'Expiration'), ', choose ', h('b', {}, 'No expiration'), ' (or a date, and make a new key then).'),
      h('li', {}, 'Click ', h('b', {}, 'Generate token'), ' at the bottom, copy the key, and paste it here.')),
    h('label', { class: 'field' }, h('span', {}, 'Access key'), token),
    h('details', {}, h('summary', {}, 'Website repository'),
      h('label', { class: 'field' }, h('span', {}, 'Repository'), repo),
      h('label', { class: 'field' }, h('span', {}, 'Branch'), branch)),
    msg,
    h('div', { class: 'row' },
      S.snap ? h('button', { onclick: () => render() }, 'Cancel') : null,
      h('button', { class: 'primary', onclick: connect }, 'Connect'))));
}

// ---------- layout ----------
function render() {
  const app = $('#app');
  let main = $('.main-scroll');
  const scroll = main && S.view.key === main.dataset.key ? main.scrollTop : 0;
  app.replaceChildren(h('div', { class: 'shell' }, renderSidebar(), h('main', {}, renderTopbar(), (main = renderView()))));
  main.dataset.key = S.view.key = viewKey(S.view);
  main.scrollTop = scroll;
}
const viewKey = (v) => [v.type, v.path, v.entry && v.entry.name, v.side, v.group].join('|');
function go(view) { S.view = view; render(); }

function pendingCount() {
  const refs = currentRefs();
  return [...S.docs.values()].filter(isDirty).length + [...S.uploads.keys()].filter((p) => refs.has(p)).length;
}
window.pendingChangeCount = pendingCount;
window.reloadFromWebsite = async () => {
  const n = pendingCount();
  if (n && !(await confirmBox('Reload from the website?', `This throws away ${plural(n, 'unpublished change')}.`, 'Reload'))) return;
  S.uploads.clear();
  loadAll(true);
};

function updateTopbar() {
  const n = pendingCount();
  const c = $('.pending');
  if (!c) return;
  c.textContent = n ? `${plural(n, 'unpublished change')}` : 'Everything is published';
  $('.publish').disabled = !n;
  $('.discard').hidden = !n;
}
function changed() { updateTopbar(); refreshSidebarCounts(); }

function siteURL() {
  const site = siteDoc() ? siteDoc().data : {};
  if (site.customDomain) return `https://${String(site.customDomain).replace(/^https?:\/\//, '').replace(/\/$/, '')}/`;
  return `https://${S.config.owner}.github.io/${S.config.repo}/`;
}
const siteDoc = () => [...S.docs.values()].find((d) => d.entry.name === 'site');

function renderTopbar() {
  const bar = h('header', { class: 'topbar' },
    h('button', { title: 'Undo the last change (not yet published)', onclick: undo }, '↶ Undo'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'pending' }),
    h('button', { class: 'discard', onclick: window.reloadFromWebsite }, 'Discard'),
    h('button', { class: 'primary publish', onclick: publishDialog }, 'Publish'),
    h('button', { title: 'Open the live website', onclick: () => Native.open(siteURL()) }, 'View site ↗'));
  setTimeout(updateTopbar);
  return bar;
}

function renderSidebar() {
  const site = siteDoc() ? siteDoc().data : {};
  const nav = h('nav', { class: 'sidebar' });
  const item = (label, view, extra = {}) => {
    const active = viewKey(view) === viewKey(S.view);
    return h('a', { class: 'nav-item' + (active ? ' active' : '') + (extra.cls ? ' ' + extra.cls : ''), onclick: () => go(view), ...extra.attrs },
      h('span', { class: 'nav-label' }, label), extra.badge != null ? h('span', { class: 'badge' }, extra.badge) : null);
  };
  for (const side of ['photography', 'rocknh']) {
    nav.append(h('div', { class: 'side-head' }, side === 'photography' ? site.photographyTitle || SIDES.photography : site.rocknhTitle || SIDES.rocknh));
    for (const entry of S.schema) {
      if (entry.type === 'collection' && (entry.side === side || entry.side === 'split')) {
        const label = cleanLabel(entry.label).replace(/^rock'?n'? ?h\s*/i, '');
        const cview = { type: 'collection', entry, side };
        nav.append(h('div', { class: 'nav-group' },
          item(label.charAt(0).toUpperCase() + label.slice(1), cview, { cls: 'group-head' }),
          h('button', { class: 'add', title: `New ${kindName(entry)}`, onclick: (e) => { e.stopPropagation(); newDoc(entry, side); } }, '+')));
        const list = h('div', { class: 'nav-docs' });
        const addDoc = (d, sub) => {
          const pf = photoListField(entry);
          const count = pf ? (d.data[pf.name] || []).length : null;
          const a = item(docTitle(d), { type: 'doc', path: d.path }, { badge: count || (childrenOf(d).length ? null : count), cls: 'doc' + (sub ? ' sub' : '') + (d.data.draft ? ' is-draft' : ''), attrs: { 'data-path': d.path } });
          docDragTarget(a, d, entry, side);
          list.append(a);
        };
        for (const d of sortedDocs(entry, side)) {
          if (parentOf(d)) continue;
          addDoc(d, false);
          childrenOf(d).forEach((c) => addDoc(c, true));
        }
        nav.append(list);
      } else if (entry.type === 'file') {
        const groups = new Set(entry.fields.map((f) => fieldGroup(entry, f)));
        if (entry.side !== 'fields') {
          if (groups.has(side)) nav.append(item(cleanLabel(entry.label).replace(/^rock'?n'? ?h\s*/i, ''), { type: 'file', path: entry.path, group: side }, { cls: 'group-head' }));
        } else {
          for (const [key, g] of Object.entries(GROUPS)) {
            if (g.side === side && groups.has(key)) nav.append(item(g.title, { type: 'file', path: entry.path, group: key }, { cls: 'group-head' }));
          }
        }
      }
    }
  }
  nav.append(h('div', { class: 'side-head' }, 'Settings'));
  for (const entry of S.schema) {
    if (entry.type === 'file' && entry.fields.some((f) => fieldGroup(entry, f) === 'settings')) {
      nav.append(item(cleanLabel(entry.label), { type: 'file', path: entry.path, group: 'settings' }, { cls: 'group-head' }));
    }
  }
  nav.append(item('Account', { type: 'account' }, { cls: 'group-head' }));
  return nav;
}
function refreshSidebarCounts() {
  for (const a of document.querySelectorAll('.nav-item.doc')) {
    const d = S.docs.get(a.dataset.path);
    if (!d) continue;
    const pf = photoListField(d.entry);
    const b = a.querySelector('.badge');
    if (pf && b) b.textContent = (d.data[pf.name] || []).length;
    a.querySelector('.nav-label').textContent = docTitle(d);
    a.classList.toggle('is-draft', !!d.data.draft);
  }
}

// Sidebar entries: drag to reorder, and drop photos on them to move (or copy with Option) photos there.
let DRAG = null;
function docDragTarget(a, doc, entry, side) {
  const canOrder = entry.fields.some((f) => f.name === 'order');
  a.draggable = canOrder;
  a.addEventListener('dragstart', (e) => { DRAG = { type: 'doc', doc, entry, side }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', docTitle(doc)); });
  a.addEventListener('dragend', () => { DRAG = null; clearDropMarks(); });
  a.addEventListener('dragover', (e) => {
    if (DRAG && DRAG.type === 'doc' && DRAG.entry === entry && DRAG.doc !== doc && parentOf(DRAG.doc) === parentOf(doc)) {
      e.preventDefault();
      const after = e.offsetY > a.offsetHeight / 2;
      clearDropMarks();
      a.classList.add(after ? 'drop-after' : 'drop-before');
    } else if (DRAG && DRAG.type === 'photos' && DRAG.doc !== doc && photoListField(entry)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      clearDropMarks();
      a.classList.add('drop-into');
    }
  });
  a.addEventListener('dragleave', () => a.classList.remove('drop-before', 'drop-after', 'drop-into'));
  a.addEventListener('drop', (e) => {
    e.preventDefault();
    const d = DRAG;
    clearDropMarks();
    if (!d) return;
    if (d.type === 'doc') {
      if (parentOf(d.doc) !== parentOf(doc)) return;
      const list = siblingsOf(doc, side).filter((x) => x !== d.doc);
      let at = list.indexOf(doc) + (e.offsetY > a.offsetHeight / 2 ? 1 : 0);
      list.splice(at, 0, d.doc);
      reorderDocs(list);
    } else if (d.type === 'photos') {
      transferPhotos(d, doc, photoListField(entry), e.altKey);
    }
  });
}
function clearDropMarks() { document.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into')); }
function reorderDocs(list) {
  checkpoint();
  list.forEach((d, i) => { if (d.data.order !== i + 1) d.data.order = i + 1; });
  render();
}

// ---------- views ----------
function renderView() {
  const v = S.view;
  const wrap = h('section', { class: 'main-scroll' });
  if (v.type === 'collection') wrap.append(collectionView(v.entry, v.side));
  else if (v.type === 'doc' && S.docs.get(v.path)) wrap.append(docView(S.docs.get(v.path)));
  else if (v.type === 'file' && S.docs.get(v.path)) wrap.append(fileView(S.docs.get(v.path), v.group));
  else if (v.type === 'account') wrap.append(accountView());
  else wrap.append(homeView());
  return wrap;
}

function homeView() {
  const galleries = S.schema.find((e) => e.name === 'galleries') || S.schema.find((e) => e.type === 'collection');
  return h('div', { class: 'page' },
    h('h1', {}, 'Your website'),
    h('p', { class: 'muted' }, 'Pick something on the left to edit it. Changes stay on this Mac until you press ', h('b', {}, 'Publish'), '; the website updates about a minute after that.'),
    h('div', { class: 'tips' },
      tip('Add photos', 'Open a gallery and drag photos from Finder onto it, or click Add photos.'),
      tip('Rearrange', 'Drag photos into a new order. Drag galleries in the sidebar to change the menu order.'),
      tip('Move between galleries', 'Select photos and drag them onto another gallery in the sidebar. Hold Option to copy instead.'),
      tip('Sell a print', "Select photos in a gallery and choose Copy to… a Rock'n H print collection. Set the collection's price list once; a print can have its own."),
      tip('Drafts', 'New galleries and pages start as drafts. Switch them to Published when they are ready.'),
      tip('Undo', 'Undo steps back through your changes. Discard throws away everything not yet published.')),
    galleries ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => go({ type: 'collection', entry: galleries, side: 'photography' }) }, `See all ${cleanLabel(galleries.label).toLowerCase()}`)) : null);
}
const tip = (t, d) => h('div', { class: 'tip' }, h('h3', {}, t), h('p', {}, d));

function coverOf(d) {
  const pf = photoListField(d.entry);
  const list = pf ? d.data[pf.name] || [] : [];
  return d.data.cover || d.data.image || (list[0] && list[0][imageKey(pf)]) || (childrenOf(d)[0] && coverOf(childrenOf(d)[0])) || '';
}

function collectionView(entry, side) {
  const docs = sortedDocs(entry, side).filter((d) => !parentOf(d));
  const pf = photoListField(entry);
  const label = cleanLabel(entry.label).replace(/^rock'?n'? ?h\s*/i, '');
  const grid = h('div', { class: 'cards' });
  const canOrder = entry.fields.some((f) => f.name === 'order');
  docs.forEach((d) => {
    const list = pf ? d.data[pf.name] || [] : [];
    const cover = coverOf(d);
    const card = h('div', { class: 'card', draggable: canOrder ? 'true' : null, onclick: () => go({ type: 'doc', path: d.path }) },
      h('div', { class: 'card-img' }, cover ? h('img', { src: imgSrc(cover), loading: 'lazy', alt: '' }) : h('span', { class: 'muted' }, 'No photo')),
      h('div', { class: 'card-text' }, h('b', {}, docTitle(d)),
        h('span', { class: 'muted' }, [childrenOf(d).length ? plural(childrenOf(d).length, 'sub-gallery', 'sub-galleries') : null,
          pf && (list.length || !childrenOf(d).length) ? plural(list.length, 'photo') : null, d.data.draft ? 'Draft' : null].filter(Boolean).join(' · '))));
    if (canOrder) {
      card.addEventListener('dragstart', () => { DRAG = { type: 'card', doc: d }; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { DRAG = null; card.classList.remove('dragging'); clearDropMarks(); });
      card.addEventListener('dragover', (e) => {
        if (!DRAG || DRAG.type !== 'card' || DRAG.doc === d) return;
        e.preventDefault();
        clearDropMarks();
        card.classList.add(e.offsetX > card.offsetWidth / 2 ? 'drop-after' : 'drop-before');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!DRAG || DRAG.type !== 'card') return;
        const list2 = docs.filter((x) => x !== DRAG.doc);
        list2.splice(list2.indexOf(d) + (e.offsetX > card.offsetWidth / 2 ? 1 : 0), 0, DRAG.doc);
        reorderDocs(list2);
      });
    }
    grid.append(card);
  });
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, SIDES[side]), h('h1', {}, label.charAt(0).toUpperCase() + label.slice(1))),
      h('button', { class: 'primary', onclick: () => newDoc(entry, side) }, `New ${kindName(entry)}`)),
    canOrder && docs.length > 1 ? h('p', { class: 'muted' }, 'Drag to change the order they appear on the website.') : null,
    docs.length ? grid : h('p', { class: 'muted' }, `No ${label.toLowerCase()} yet.`));
}

async function newDoc(entry, side, parent) {
  const kind = parent ? 'sub-gallery' : kindName(entry);
  const name = await askText(parent ? `New sub-gallery in ${docTitle(parent)}` : `New ${kind}`, 'Name', '', 'Create');
  if (!name) return;
  checkpoint();
  const doc = createDoc(entry, name, side, parent);
  go({ type: 'doc', path: doc.path });
}
function createDoc(entry, name, side, parent) {
  const kind = kindName(entry);
  let slug = slugify(name) || kind.replace(/\s+/g, '-');
  let path = `${entry.path}/${slug}.json`;
  for (let n = 2; S.docs.has(path) || S.snap.files.has(path); n++) path = `${entry.path}/${slug}-${n}.json`;
  const data = defaultsFor(entry.fields);
  data[entry.primary] = name;
  if (entry.side === 'split' && side) data.side = side;
  if (parent) data.parent = docSlug(parent);
  if ('order' in data || entry.fields.some((f) => f.name === 'order')) {
    const sibs = sortedDocs(entry, side).filter((d) => parentOf(d) === (parent || null));
    data.order = Math.max(0, ...sibs.map((d) => (typeof d.data.order === 'number' ? d.data.order : 0))) + 1;
  }
  const doc = { path, entry, data, canon: '', isNew: true, deleted: false };
  S.docs.set(path, doc);
  return doc;
}
function defaultsFor(fields) {
  const o = {};
  for (const f of fields) {
    if (f.default !== undefined && f.default !== null) o[f.name] = f.default;
    else if (f.type === 'object' && f.list) o[f.name] = [];
    else if (f.type === 'boolean') o[f.name] = false;
    else if (f.type === 'number') continue;
    else if (f.type === 'object') o[f.name] = defaultsFor(f.fields || []);
    else o[f.name] = '';
  }
  return o;
}

async function deleteDoc(doc) {
  const kind = kindName(doc.entry);
  const pf = photoListField(doc.entry);
  const n = pf ? (doc.data[pf.name] || []).length : 0;
  const ok = await confirmBox(`Delete the ${kind} “${docTitle(doc)}”?`,
    (n ? `Its ${plural(n, 'photo')} will also be removed from the website, except any used elsewhere. ` : '') +
    (childrenOf(doc).length ? `Its ${plural(childrenOf(doc).length, 'sub-gallery', 'sub-galleries')} will become main galleries. ` : '') + 'You can Undo until you publish.', 'Delete');
  if (!ok) return;
  checkpoint();
  childrenOf(doc).forEach((c) => { c.data.parent = ''; });
  if (doc.isNew) S.docs.delete(doc.path);
  else doc.deleted = true;
  go(doc.entry.type === 'collection' ? { type: 'collection', entry: doc.entry, side: docSide(doc) } : { type: 'home' });
}

const HEADER_FIELDS = new Set(['draft']);
const MORE_FIELDS = new Set(['slug', 'order', 'layout', 'menuTitle']);

function docView(doc) {
  const entry = doc.entry;
  const primary = entry.fields.find((f) => f.name === entry.primary);
  const title = h('input', { class: 'title-input', value: doc.data[entry.primary] || '', placeholder: primary ? cleanLabel(primary.label) : 'Name' });
  title.addEventListener('focus', checkpoint);
  title.addEventListener('input', () => {
    const kids = childrenOf(doc), before = docSlug(doc);
    doc.data[entry.primary] = title.value;
    // Without its own web address, a renamed gallery's address changes, so its sub-galleries follow it.
    if (docSlug(doc) !== before) kids.forEach((k) => { k.data.parent = docSlug(doc); });
    changed();
  });
  const hasDraft = entry.fields.some((f) => f.name === 'draft');
  const status = hasDraft ? h('div', { class: 'segmented' },
    h('button', { class: doc.data.draft ? 'on' : '', onclick: () => setDraft(true) }, 'Draft'),
    h('button', { class: !doc.data.draft ? 'on' : '', onclick: () => setDraft(false) }, 'Published')) : null;
  function setDraft(v) { checkpoint(); doc.data.draft = v; render(); }
  const main = [], more = [];
  const pf = photoListField(entry);
  for (const f of entry.fields) {
    if (f === primary || HEADER_FIELDS.has(f.name) || f === pf || f.hidden) continue;
    (MORE_FIELDS.has(f.name) ? more : main).push(fieldRow(doc.data, f, doc));
  }
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, parentOf(doc)
        ? [`${SIDES[docSide(doc)] || ''} · sub-gallery of `, h('button', { class: 'link', onclick: () => go({ type: 'doc', path: parentOf(doc).path }) }, docTitle(parentOf(doc)))]
        : `${SIDES[docSide(doc)] || ''} · ${kindName(entry)}`), title),
      status,
      h('button', { class: 'danger-quiet', title: `Delete this ${kindName(entry)}`, onclick: () => deleteDoc(doc) }, 'Delete')),
    hasDraft && doc.data.draft ? h('p', { class: 'note' }, `Drafts are hidden from visitors. After publishing you can preview it at ${siteURL()}drafts/`) : null,
    hasParents(entry) && !parentOf(doc) ? subGalleries(doc) : null,
    pf ? (childrenOf(doc).length && !(doc.data[pf.name] || []).length
      ? h('details', { class: 'more' }, h('summary', {}, 'Photos of its own (optional; visitors see the sub-galleries instead while this is empty)'), photoGrid(doc, pf))
      : photoGrid(doc, pf)) : null,
    main.length ? h('div', { class: 'form' }, main) : null,
    more.length ? h('details', { class: 'more' }, h('summary', {}, 'More options'), h('div', { class: 'form' }, more)) : null);
}

function fileView(doc, group) {
  const entry = doc.entry;
  const fields = entry.fields.filter((f) => fieldGroup(entry, f) === group && !f.hidden);
  const lists = fields.filter(isImageList);
  const g = GROUPS[group];
  const title = entry.side !== 'fields' ? cleanLabel(entry.label) : group === 'settings' ? cleanLabel(entry.label) : g.title;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, SIDES[g ? g.side : group] || 'Settings'),
      h('h1', {}, title))),
    group === 'rocknh-print' ? h('p', { class: 'muted' }, 'These are the drop-down sections on every print page.') : null,
    group === 'rocknh-checkout' ? checkoutHelp(doc.data) : null,
    lists.map((f) => h('div', { class: 'block' }, h('h3', {}, cleanLabel(f.label)), photoGrid(doc, f))),
    h('div', { class: 'form' }, fields.filter((f) => !isImageList(f)).map((f) => fieldRow(doc.data, f, doc))));
}

function checkoutHelp(site) {
  const ready = String(site.rockPaypalClientId || '').trim();
  return h('div', { class: ready ? 'tip' : 'note' },
    ready ? h('p', {}, 'PayPal checkout is switched on. Buyers can pay by card or with a PayPal account.')
      : h('p', {}, h('b', {}, 'Checkout is not switched on yet. '), 'Until a PayPal Client ID is filled in, the cart tells visitors online checkout is being set up.'),
    h('ol', { class: 'steps' },
      h('li', {}, h('button', { class: 'link', onclick: () => Native.open('https://developer.paypal.com/dashboard/applications/live') }, 'Open PayPal’s developer dashboard'), ' and sign in with your PayPal business account.'),
      h('li', {}, 'Make sure the switch at the top says ', h('b', {}, 'Live'), ', then click ', h('b', {}, 'Create App'), ' (any name, e.g. “Rock’n H shop”).'),
      h('li', {}, 'Copy the ', h('b', {}, 'Client ID'), ' and paste it below. Never paste the ', h('b', {}, 'Secret'), ' anywhere.')));
}

function accountView() {
  return h('div', { class: 'page' },
    h('h1', {}, 'Account'),
    h('p', {}, 'Connected to ', h('b', {}, `${S.config.owner}/${S.config.repo}`), ` (${S.config.branch}).`),
    h('p', { class: 'muted' }, `Website address: ${siteURL()}`),
    h('div', { class: 'row' },
      h('button', { onclick: renderSetup }, 'Change access key'),
      h('button', { onclick: async () => { await Native.clearCache(); toast('Photo cache cleared.'); } }, 'Clear photo cache'),
      h('button', { onclick: () => Native.open(`https://github.com/${S.config.owner}/${S.config.repo}/actions`) }, 'Publishing history ↗')));
}

// ---------- fields ----------
function fieldRow(obj, f, doc) {
  const label = f.name === 'parent' && doc && obj === doc.data && hasParents(doc.entry) ? 'Place in the menu' : shortLabel(f.label || f.name);
  const input = fieldInput(obj, f, doc);
  if (f.type === 'boolean') return h('label', { class: 'field check' }, input, h('span', {}, label));
  if (f.type === 'object' && f.list) return h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, label), input);
  // Fields holding buttons can't sit in a <label>: a click anywhere in it would press the first button.
  const tag = f.type === 'rich-text' || f.type === 'image' || f.type === 'object' ? 'div' : 'label';
  return h(tag, { class: 'field' + (f.type === 'rich-text' || f.type === 'text' ? ' wide' : '') }, h('span', { class: 'field-label' }, label), input);
}

function fieldInput(obj, f, doc) {
  const set = (v) => { if (v === undefined) delete obj[f.name]; else obj[f.name] = v; changed(); };
  const val = obj[f.name];
  if (f.name === 'parent' && doc && obj === doc.data && hasParents(doc.entry)) return parentPicker(doc);
  switch (f.type) {
    case 'boolean': {
      const el = h('input', { type: 'checkbox', checked: !!val });
      el.addEventListener('change', () => { checkpoint(); set(el.checked); });
      return el;
    }
    case 'number': {
      const el = h('input', { type: 'number', value: val ?? '', step: 'any' });
      el.addEventListener('focus', checkpoint);
      el.addEventListener('input', () => set(el.value === '' ? undefined : Number(el.value)));
      return el;
    }
    case 'select': {
      const opts = ((f.options && f.options.values) || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
      const el = h('select', {}, opts.map((o) => h('option', { value: o.value }, cleanLabel(o.label || o.value))));
      el.value = val ?? f.default ?? '';
      el.addEventListener('change', () => {
        checkpoint();
        set(el.value);
        if (f.name === 'side') render();
      });
      return el;
    }
    case 'image': return imageInput(obj, f, doc);
    case 'rich-text': return richText(obj, f);
    case 'object':
      if (f.list) return isImageList(f) ? photoGrid(doc, f, obj) : itemList(obj, f, doc);
      if (!obj[f.name] || typeof obj[f.name] !== 'object') obj[f.name] = {};
      return h('div', { class: 'form nested' }, (f.fields || []).map((s) => fieldRow(obj[f.name], s, doc)));
    case 'text': {
      const el = h('textarea', { rows: 4, value: val ?? '' });
      el.addEventListener('focus', checkpoint);
      el.addEventListener('input', () => set(el.value));
      return el;
    }
    default: {
      const el = h('input', { type: f.type === 'date' ? 'date' : 'text', value: val ?? '' });
      el.addEventListener('focus', checkpoint);
      el.addEventListener('input', () => {
        // A main gallery's web address is what its sub-galleries point at, so they follow a change.
        const kids = f.name === 'slug' && doc && obj === doc.data ? childrenOf(doc) : [];
        set(el.value);
        kids.forEach((k) => { k.data.parent = docSlug(doc); });
      });
      return el;
    }
  }
}

function parentPicker(doc) {
  if (childrenOf(doc).length) return h('p', { class: 'muted' }, `This is a main gallery with ${plural(childrenOf(doc).length, 'sub-gallery', 'sub-galleries')}.`);
  const mains = sortedDocs(doc.entry).filter((x) => x !== doc && !parentOf(x) && !x.data.parent);
  const el = h('select', {}, h('option', { value: '' }, 'None (a main gallery)'),
    mains.map((m) => h('option', { value: docSlug(m) }, `Under ${docTitle(m)}`)));
  el.value = parentOf(doc) ? docSlug(parentOf(doc)) : '';
  el.addEventListener('change', () => {
    checkpoint();
    doc.data.parent = el.value;
    const sibs = sortedDocs(doc.entry).filter((x) => x !== doc && parentOf(x) === parentOf(doc));
    doc.data.order = Math.max(0, ...sibs.map((x) => (typeof x.data.order === 'number' ? x.data.order : 0))) + 1;
    render();
  });
  return el;
}

// A main gallery's sub-galleries: reorder them, add one, or add whole folders from the Mac.
function subGalleries(doc) {
  const kids = childrenOf(doc);
  const cards = h('div', { class: 'cards small' }, kids.map((k) => {
    const pf = photoListField(k.entry);
    const cover = coverOf(k);
    const card = h('div', { class: 'card', draggable: 'true', onclick: () => go({ type: 'doc', path: k.path }) },
      h('div', { class: 'card-img' }, cover ? h('img', { src: imgSrc(cover), loading: 'lazy', alt: '' }) : h('span', { class: 'muted' }, 'No photo')),
      h('div', { class: 'card-text' }, h('b', {}, docTitle(k)),
        h('span', { class: 'muted' }, [pf ? plural((k.data[pf.name] || []).length, 'photo') : null, k.data.draft ? 'Draft' : null].filter(Boolean).join(' · '))));
    card.addEventListener('dragstart', () => { DRAG = { type: 'card', doc: k }; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { DRAG = null; card.classList.remove('dragging'); clearDropMarks(); });
    card.addEventListener('dragover', (e) => {
      if (!DRAG || DRAG.type !== 'card' || DRAG.doc === k || parentOf(DRAG.doc) !== doc) return;
      e.preventDefault();
      clearDropMarks();
      card.classList.add(e.offsetX > card.offsetWidth / 2 ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!DRAG || DRAG.type !== 'card' || parentOf(DRAG.doc) !== doc) return;
      const list = kids.filter((x) => x !== DRAG.doc);
      list.splice(list.indexOf(k) + (e.offsetX > card.offsetWidth / 2 ? 1 : 0), 0, DRAG.doc);
      reorderDocs(list);
    });
    return card;
  }));
  const drafts = kids.filter((k) => k.data.draft);
  const box = h('div', { class: 'block subs' },
    h('div', { class: 'row' }, h('h3', {}, 'Sub-galleries'),
      h('button', { onclick: () => newDoc(doc.entry, null, doc) }, '+ New sub-gallery'),
      h('button', { onclick: () => chooseFolders().then((groups) => addFolderGalleries(doc, groups)) }, 'Add folders from Mac…'),
      drafts.length ? h('button', { class: 'link', onclick: () => { checkpoint(); drafts.forEach((k) => { k.data.draft = false; }); render(); } }, `Publish all ${drafts.length} drafts`) : null),
    kids.length ? h('p', { class: 'muted small' }, 'Drag to reorder. Drop folders from Finder here to add each as a sub-gallery.') : h('p', { class: 'muted small' }, 'None yet. Drop folders from Finder here, or click Add folders: each folder becomes a sub-gallery with its photos.'),
    kids.length ? cards : null);
  box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); box.classList.add('drop-into'); } });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('drop-into'); });
  box.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('drop-into');
    addFolderGalleries(doc, await droppedFolders(e.dataTransfer));
  });
  return box;
}

// Folders -> Map(folder name -> [image files]). Every folder that holds photos becomes one sub-gallery.
function groupByFolder(pairs) {
  const groups = new Map();
  for (const [rel, file] of pairs) {
    if (!looksLikeImage(file) || basename(rel).startsWith('.')) continue;
    const dir = dirname(rel);
    if (!dir) continue;
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push([basename(rel), file]);
  }
  const byName = (a, b) => a[0].localeCompare(b[0], undefined, { numeric: true });
  return [...groups].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([dir, files]) => ({ name: basename(dir), files: files.sort(byName).map((x) => x[1]) }));
}
function chooseFolders() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, style: 'display:none' });
    input.addEventListener('change', () => { resolve(groupByFolder([...input.files].map((f) => [f.webkitRelativePath || f.name, f]))); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
async function droppedFolders(dt) {
  const pairs = [];
  const readAll = (reader) => new Promise((res) => { const out = []; const next = () => reader.readEntries((ents) => { if (!ents.length) return res(out); out.push(...ents); next(); }, () => res(out)); next(); });
  const fileOf = (entry) => new Promise((res) => entry.file(res, () => res(null)));
  async function walk(entry, prefix) {
    if (entry.isFile) { const f = await fileOf(entry); if (f && prefix) pairs.push([`${prefix}/${f.name}`, f]); }
    else if (entry.isDirectory) for (const c of await readAll(entry.createReader())) await walk(c, prefix ? `${prefix}/${entry.name}` : entry.name);
  }
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  for (const e of entries) await walk(e, '');
  return groupByFolder(pairs);
}
async function addFolderGalleries(parent, groups) {
  if (!groups || !groups.length) return toast('No folders with photos found. Drop folders (not single photos) here.');
  const total = groups.reduce((n, g) => n + g.files.length, 0);
  const ok = await modal(`Add ${plural(groups.length, 'sub-gallery', 'sub-galleries')} to ${docTitle(parent)}?`,
    h('div', {}, h('ul', { class: 'changes' }, groups.slice(0, 12).map((g) => h('li', {}, `${g.name}: ${plural(g.files.length, 'photo')}`)),
      groups.length > 12 ? h('li', {}, `and ${groups.length - 12} more`) : null),
      h('p', { class: 'muted' }, `${plural(total, 'photo')} will be resized and kept ready to publish. New sub-galleries start as drafts.`)),
    [{ label: 'Cancel', value: false }, { label: 'Add', primary: true, value: true }]);
  if (!ok) return;
  checkpoint();
  const titleOf = (n) => n.replace(/[_]+/g, ' ').trim();
  for (const g of groups) {
    const existing = childrenOf(parent).find((k) => docTitle(k).toLowerCase() === titleOf(g.name).toLowerCase());
    const doc = existing || createDoc(parent.entry, titleOf(g.name), null, parent);
    const pf = photoListField(doc.entry);
    const vals = await prepareUploads(g.files, uploadFolder(doc));
    const key = imageKey(pf);
    const list = doc.data[pf.name] || (doc.data[pf.name] = []);
    list.push(...vals.map((v) => ({ ...defaultsFor(pf.fields), [key]: v })));
    if (!doc.data.cover && list[0]) doc.data.cover = list[0][key];
    render();
  }
  toast(`Added ${plural(groups.length, 'sub-gallery', 'sub-galleries')} to ${docTitle(parent)}. Publish when you're ready.`);
}

function imageInput(obj, f, doc) {
  const box = h('div', { class: 'image-field' });
  const draw = () => {
    const v = obj[f.name];
    box.replaceChildren(
      h('div', { class: 'image-preview' }, v ? h('img', { src: imgSrc(v), alt: '' }) : h('span', { class: 'muted' }, 'None')),
      h('div', { class: 'col' },
        h('button', { onclick: async (e) => { e.preventDefault(); const p = await pickPhotos(false); if (p) { checkpoint(); obj[f.name] = p[0]; changed(); draw(); } } }, 'Choose from website…'),
        h('button', { onclick: async (e) => { e.preventDefault(); const files = await chooseFiles(false); const vals = await prepareUploads(files, uploadFolder(doc)); if (vals.length) { checkpoint(); obj[f.name] = vals[0]; changed(); draw(); } } }, 'Upload from Mac…'),
        v ? h('button', { class: 'danger-quiet', onclick: (e) => { e.preventDefault(); checkpoint(); obj[f.name] = ''; changed(); draw(); } }, 'Remove') : null));
  };
  draw();
  return box;
}

function richText(obj, f) {
  const ed = h('div', { class: 'rich', contenteditable: 'true', innerHTML: obj[f.name] || '' });
  const save = () => {
    let html = ed.innerHTML.replace(/<div>/g, '<p>').replace(/<\/div>/g, '</p>').replace(/ style="[^"]*"/g, '');
    if (!ed.textContent.trim() && !ed.querySelector('img')) html = '';
    else if (!/^\s*</.test(html)) html = `<p>${html}</p>`;
    obj[f.name] = html;
    changed();
  };
  ed.addEventListener('focus', () => { checkpoint(); document.execCommand('defaultParagraphSeparator', false, 'p'); });
  ed.addEventListener('input', save);
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  const cmd = (c, v) => (e) => { e.preventDefault(); ed.focus(); document.execCommand(c, false, v); save(); };
  const link = async (e) => {
    e.preventDefault();
    const sel = window.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const url = await askText('Add a link', 'Web address', 'https://');
    if (!url || !range) return;
    ed.focus();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand(range.collapsed ? 'insertHTML' : 'createLink', false, range.collapsed ? `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>` : url);
    save();
  };
  const tools = h('div', { class: 'rich-tools' },
    h('button', { title: 'Bold', onmousedown: cmd('bold') }, h('b', {}, 'B')),
    h('button', { title: 'Italic', onmousedown: cmd('italic') }, h('i', {}, 'I')),
    h('button', { title: 'Heading', onmousedown: cmd('formatBlock', 'h3') }, 'H'),
    h('button', { title: 'Paragraph', onmousedown: cmd('formatBlock', 'p') }, '¶'),
    h('button', { title: 'Bulleted list', onmousedown: cmd('insertUnorderedList') }, '•'),
    h('button', { title: 'Link', onmousedown: link }, 'Link'),
    h('button', { title: 'Remove formatting', onmousedown: cmd('removeFormat') }, 'Clear'));
  return h('div', { class: 'rich-wrap', onclick: (e) => e.target === e.currentTarget && ed.focus() }, tools, ed);
}

// A list of small records, e.g. a price list (material, size, price) or a print's own prices.
const SIMPLE_TYPES = new Set(['string', 'number', 'select', undefined]);
const money = (n) => `${(siteDoc() && siteDoc().data.currencySymbol) || '$'}${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const priceOf = (o) => { const v = parseFloat(String(o && o.price != null ? o.price : '').replace(/[^0-9.]/g, '')); return Number.isFinite(v) ? v : null; };
function lowestPrice(list) {
  const prices = (list || []).map(priceOf).filter((v) => v != null);
  return prices.length ? Math.min(...prices) : null;
}
// Every value already used for this column anywhere, offered as suggestions while typing.
function knownValues(listName, key) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === listName && Array.isArray(x)) x.forEach((o) => { if (o && o[key]) out.add(String(o[key])); });
        else walk(x);
      }
    }
  };
  for (const d of S.docs.values()) if (!d.deleted) walk(d.data);
  return [...out].sort();
}
let datalistId = 0;

function itemList(obj, f, doc) {
  if (!Array.isArray(obj[f.name])) obj[f.name] = [];
  const arr = obj[f.name];
  const sub = f.fields || [];
  const box = h('div', { class: 'item-list' });
  const isPrice = sub.some((x) => x.name === 'price');
  // A print with no prices of its own uses its collection's list of the same name.
  const parentList = obj !== doc.data && Array.isArray(doc.data[f.name]) ? doc.data[f.name] : null;
  const move = (i, to) => { checkpoint(); arr.splice(to, 0, arr.splice(i, 1)[0]); changed(); draw(); };
  const tools = (i) => h('div', { class: 'item-tools' },
    h('button', { title: 'Duplicate', onclick: (e) => { e.preventDefault(); checkpoint(); arr.splice(i + 1, 0, JSON.parse(JSON.stringify(arr[i]))); changed(); draw(); } }, '⧉'),
    h('button', { title: 'Move up', disabled: i === 0, onclick: (e) => { e.preventDefault(); move(i, i - 1); } }, '↑'),
    h('button', { title: 'Move down', disabled: i === arr.length - 1, onclick: (e) => { e.preventDefault(); move(i, i + 1); } }, '↓'),
    h('button', { title: 'Remove', class: 'danger-quiet', onclick: (e) => { e.preventDefault(); checkpoint(); arr.splice(i, 1); changed(); draw(); } }, '✕'));
  const add = h('button', { onclick: (e) => { e.preventDefault(); checkpoint(); arr.push(defaultsFor(sub)); changed(); draw(); } },
    isPrice ? '+ Add a price' : `+ Add ${columnLabel(f.label).toLowerCase().replace(/s$/, '')}`);

  function tableView() {
    const lists = {};
    const head = h('tr', {}, sub.map((x) => h('th', {}, columnLabel(x.label || x.name))), h('th', {}));
    const rows = arr.map((it, i) => h('tr', {}, sub.map((x) => {
      let input;
      if (x.type === 'select') input = fieldInput(it, x, doc);
      else {
        if (x.type !== 'number' && x.name !== 'price' && !lists[x.name]) {
          const id = 'dl' + ++datalistId;
          lists[x.name] = h('datalist', { id }, knownValues(f.name, x.name).map((v) => h('option', { value: v })));
        }
        input = h('input', { type: x.type === 'number' ? 'number' : 'text', value: it[x.name] ?? '', list: lists[x.name] ? lists[x.name].id : null,
          placeholder: (String(x.label || '').match(/e\.g\. ([^)]*)/) || [])[1] || '' });
        input.addEventListener('focus', checkpoint);
        const check = () => input.classList.toggle('bad', x.name === 'price' && input.value.trim() !== '' && priceOf({ price: input.value }) == null);
        input.addEventListener('input', () => {
          if (x.type === 'number') { if (input.value === '') delete it[x.name]; else it[x.name] = Number(input.value); }
          else it[x.name] = input.value;
          check();
          summary.textContent = summaryText();
          changed();
        });
        // "$2,400" is tidied to "2400" when the field is left, as the website expects a plain number.
        input.addEventListener('change', () => {
          if (x.name === 'price' && priceOf({ price: input.value }) != null) { input.value = it[x.name] = String(priceOf({ price: input.value })); changed(); }
          if (isPrice) refreshPriceTags(doc);
        });
        check();
      }
      return h('td', {}, input);
    }), h('td', {}, tools(i))));
    return h('div', {}, h('table', { class: 'grid-table' }, h('thead', {}, head), h('tbody', {}, rows)), Object.values(lists));
  }
  function summaryText() {
    if (!isPrice) return '';
    const low = lowestPrice(arr);
    return low == null ? '' : `Shown on the website as “Prices from ${money(low)}”.`;
  }
  const summary = h('p', { class: 'muted small' });
  function draw() {
    const simple = sub.every((x) => SIMPLE_TYPES.has(x.type));
    const parts = [];
    if (!arr.length && parentList) {
      const low = lowestPrice(parentList);
      parts.push(h('div', { class: 'inherit' },
        h('p', {}, parentList.length
          ? `Uses the collection's price list (${plural(parentList.length, 'price')}${low != null ? `, from ${money(low)}` : ''}).`
          : "The collection has no price list yet, so this print shows an Enquire button."),
        h('div', { class: 'row' },
          parentList.length ? h('button', { onclick: (e) => { e.preventDefault(); checkpoint(); arr.push(...JSON.parse(JSON.stringify(parentList))); changed(); draw(); } }, 'Give this print its own prices') : null,
          h('button', { onclick: (e) => { e.preventDefault(); checkpoint(); arr.push(defaultsFor(sub)); changed(); draw(); } }, 'Start an empty list'))));
    } else if (simple) {
      if (arr.length) parts.push(tableView());
      parts.push(h('div', { class: 'row' }, add,
        parentList && arr.length ? h('button', { class: 'link', onclick: (e) => { e.preventDefault(); checkpoint(); arr.splice(0); changed(); draw(); } }, "Use the collection's price list instead") : null));
    } else {
      parts.push(...arr.map((it, i) => h('div', { class: 'item' }, h('div', { class: 'form compact' }, sub.map((x) => fieldRow(it, x, doc))), tools(i))), add);
    }
    summary.textContent = summaryText();
    box.replaceChildren(...parts, summary);
    if (isPrice) refreshPriceTags(doc);
  }
  draw();
  return box;
}

// ---------- photo grid ----------
let tileSize = 150;
try { tileSize = Number(localStorage.getItem('tileSize')) || 150; } catch {}

function listTargets(exceptDoc, exceptField) {
  const out = [];
  for (const d of S.docs.values()) {
    if (d.deleted || d.entry.type !== 'collection') continue;
    const f = photoListField(d.entry);
    if (f && !(d === exceptDoc && f === exceptField)) out.push({ doc: d, field: f });
  }
  return out.sort((a, b) => (a.doc.entry === b.doc.entry ? 0 : a.doc.entry.side === 'rocknh' ? 1 : -1) || fullTitle(a.doc).localeCompare(fullTitle(b.doc)));
}

// Copy what fits from one kind of photo entry to another (e.g. gallery photo -> print).
function convertItem(item, fromField, toField) {
  const out = defaultsFor(toField.fields);
  out[imageKey(toField)] = item[imageKey(fromField)];
  for (const s of toField.fields) if (s.type !== 'image' && item[s.name] !== undefined && typeof item[s.name] !== 'object') out[s.name] = item[s.name];
  return out;
}

function transferPhotos(drag, toDoc, toField, copy) {
  const arr = drag.arr;
  const items = drag.idx.map((i) => arr[i]);
  if (!items.length) return;
  checkpoint();
  const target = toDoc.data[toField.name] || (toDoc.data[toField.name] = []);
  const have = new Set(target.map((it) => it[imageKey(toField)]));
  let added = 0;
  for (const it of items) {
    if (have.has(it[imageKey(drag.field)])) continue;
    target.push(toField === drag.field ? JSON.parse(JSON.stringify(it)) : convertItem(it, drag.field, toField));
    added++;
  }
  if (!copy) [...drag.idx].sort((a, b) => b - a).forEach((i) => arr.splice(i, 1));
  render();
  const skipped = items.length - added;
  toast(`${copy ? 'Copied' : 'Moved'} ${plural(added, 'photo')} to ${docTitle(toDoc)}${skipped ? ` (${skipped} already there)` : ''}.`, { label: 'Undo', run: undo });
}

function refreshPriceTags(doc) {
  document.querySelectorAll('.photos').forEach((w) => { if (w.doc === doc && w.redraw) w.redraw(); });
}
// On prints: "Sold out" or the lowest price, so the grid shows what visitors will see.
function printTag(it, f, doc) {
  if (!f.fields.some((x) => x.name === 'options' || x.name === 'editionSize')) return null;
  if (Number(it.editionSize) > 0 && Number(it.editionsSold) >= Number(it.editionSize)) return h('span', { class: 'tag price sold' }, 'Sold out');
  const own = Array.isArray(it.options) && it.options.length ? it.options : null;
  const low = lowestPrice(own || doc.data.options);
  return h('span', { class: 'tag price' }, low == null ? 'No price' : `from ${money(low)}`);
}

function photoGrid(doc, f, holder) {
  holder = holder || doc.data;
  if (!Array.isArray(holder[f.name])) holder[f.name] = [];
  const arr = holder[f.name];
  const key = imageKey(f);
  const sel = new Set();
  let anchor = null;
  const wrap = h('div', { class: 'photos', tabindex: '0' });
  const grid = h('div', { class: 'grid' });
  grid.style.setProperty('--tile', tileSize + 'px');
  const bar = h('div', { class: 'photo-bar' });
  const isCollection = doc.entry.type === 'collection';
  const coverField = isCollection && doc.entry.fields.find((x) => x.name === 'cover' && x.type === 'image');

  function drawBar() {
    const n = sel.size;
    const slider = h('input', { type: 'range', min: 80, max: 320, value: tileSize, title: 'Photo size' });
    slider.addEventListener('input', () => { tileSize = Number(slider.value); grid.style.setProperty('--tile', tileSize + 'px'); try { localStorage.setItem('tileSize', tileSize); } catch {} });
    bar.replaceChildren(...[
      h('button', { class: 'primary', onclick: addFromMac }, 'Add photos…'),
      h('button', { onclick: addFromSite }, 'Add from website…'),
      h('span', { class: 'muted count' }, n ? `${n} of ${arr.length} selected` : plural(arr.length, 'photo')),
      n ? [
        h('button', { onclick: () => moveDialog(false) }, 'Move to…'),
        h('button', { onclick: () => moveDialog(true) }, 'Copy to…'),
        h('button', { onclick: () => moveWithin('start') }, 'To start'),
        h('button', { onclick: () => moveWithin('end') }, 'To end'),
        n === 1 && coverField ? h('button', { onclick: makeCover }, 'Make cover') : null,
        h('button', { class: 'danger', onclick: removeSelected }, 'Remove'),
        h('button', { class: 'link', onclick: () => { sel.clear(); drawSel(); } }, 'Deselect'),
      ] : (arr.length ? h('button', { class: 'link', onclick: () => { arr.forEach((_, i) => sel.add(i)); drawSel(); } }, 'Select all') : null),
      h('span', { class: 'spacer' }), slider].flat().filter(Boolean));
  }
  function drawSel() {
    [...grid.children].forEach((t, i) => t.classList.toggle('selected', sel.has(i)));
    drawBar();
  }
  function draw() {
    grid.replaceChildren(...arr.map((it, i) => {
      const v = it[key];
      const t = h('div', { class: 'tile' + (sel.has(i) ? ' selected' : ''), draggable: 'true', title: 'Click to select · double-click for details' },
        h('img', { src: imgSrc(v), loading: 'lazy', alt: '', draggable: 'false' }),
        h('span', { class: 'num' }, i + 1),
        doc.data.cover && doc.data.cover === v && coverField ? h('span', { class: 'tag' }, 'Cover') : null,
        it.featured ? h('span', { class: 'tag star' }, '★') : null,
        printTag(it, f, doc));
      t.addEventListener('click', (e) => clickTile(e, i));
      t.addEventListener('dblclick', () => openDetail(i));
      t.addEventListener('dragstart', (e) => {
        if (!sel.has(i)) { sel.clear(); sel.add(i); drawSel(); }
        DRAG = { type: 'photos', doc, field: f, arr, idx: [...sel].sort((a, b) => a - b) };
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', `${sel.size} photos`);
        wrap.classList.add('dragging');
      });
      t.addEventListener('dragend', () => { DRAG = null; wrap.classList.remove('dragging'); clearDropMarks(); });
      t.addEventListener('dragover', (e) => {
        const files = e.dataTransfer.types.includes('Files');
        if (!files && !(DRAG && DRAG.type === 'photos' && DRAG.arr === arr)) return;
        e.preventDefault();
        e.stopPropagation();
        clearDropMarks();
        t.classList.add(e.offsetX > t.offsetWidth / 2 ? 'drop-after' : 'drop-before');
      });
      t.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const at = i + (e.offsetX > t.offsetWidth / 2 ? 1 : 0);
        clearDropMarks();
        if (e.dataTransfer.files && e.dataTransfer.files.length) return addFiles(e.dataTransfer.files, at);
        if (DRAG && DRAG.type === 'photos' && DRAG.arr === arr) reorder(DRAG.idx, at);
      });
      return t;
    }));
    if (!arr.length) grid.append(h('div', { class: 'empty' }, 'Drag photos here from Finder, or click Add photos.'));
    drawBar();
  }
  function clickTile(e, i) {
    if (e.shiftKey && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!e.metaKey) sel.clear();
      for (let k = a; k <= b; k++) sel.add(k);
    } else if (e.metaKey || e.ctrlKey) {
      sel.has(i) ? sel.delete(i) : sel.add(i);
      anchor = i;
    } else {
      const only = sel.size === 1 && sel.has(i);
      sel.clear();
      if (!only) sel.add(i);
      anchor = i;
    }
    drawSel();
    wrap.focus({ preventScroll: true });
  }
  function reorder(idx, at) {
    checkpoint();
    const items = idx.map((i) => arr[i]);
    const before = idx.filter((i) => i < at).length;
    [...idx].sort((a, b) => b - a).forEach((i) => arr.splice(i, 1));
    at -= before;
    arr.splice(at, 0, ...items);
    sel.clear();
    items.forEach((_, k) => sel.add(at + k));
    changed();
    draw();
  }
  function moveWithin(where) {
    const idx = [...sel].sort((a, b) => a - b);
    reorder(idx, where === 'start' ? 0 : arr.length);
  }
  function removeSelected() {
    if (!sel.size) return;
    checkpoint();
    const n = sel.size;
    [...sel].sort((a, b) => b - a).forEach((i) => arr.splice(i, 1));
    sel.clear();
    changed();
    draw();
    toast(`Removed ${plural(n, 'photo')}.`, { label: 'Undo', run: undo });
  }
  function makeCover() {
    checkpoint();
    doc.data.cover = arr[[...sel][0]][key];
    changed();
    draw();
    toast('Cover photo set.');
  }
  async function addFiles(files, at = arr.length) {
    const vals = await prepareUploads(files, uploadFolder(doc));
    if (!vals.length) return;
    checkpoint();
    arr.splice(at, 0, ...vals.map((v) => ({ ...defaultsFor(f.fields), [key]: v })));
    sel.clear();
    vals.forEach((_, k) => sel.add(at + k));
    changed();
    draw();
  }
  async function addFromMac() { const files = await chooseFiles(true); if (files.length) addFiles(files); }
  async function addFromSite() {
    const vals = await pickPhotos(true, new Set(arr.map((it) => it[key])));
    if (!vals || !vals.length) return;
    checkpoint();
    arr.push(...vals.map((v) => ({ ...defaultsFor(f.fields), [key]: v })));
    changed();
    draw();
  }
  async function moveDialog(copy) {
    const targets = listTargets(doc, f);
    if (!targets.length) return toast('There is nowhere else to put photos yet.');
    const select = h('select', {}, targets.map((t, i) => h('option', { value: i }, `${fullTitle(t.doc)} — ${SIDES[docSide(t.doc)]} ${kindName(t.doc.entry)}`)));
    const r = await modal(`${copy ? 'Copy' : 'Move'} ${plural(sel.size, 'photo')} to…`, h('label', { class: 'field' }, h('span', {}, 'Destination'), select),
      [{ label: 'Cancel', value: null }, { label: copy ? 'Copy' : 'Move', primary: true, value: 'ok' }]);
    if (r !== 'ok') return;
    const t = targets[Number(select.value)];
    transferPhotos({ arr, field: f, idx: [...sel].sort((a, b) => a - b) }, t.doc, t.field, copy);
  }
  function openDetail(i) {
    const it = arr[i];
    const fields = f.fields.filter((s) => s.type !== 'image' && !s.hidden);
    const big = h('img', { src: imgSrc(it[key], true), alt: '' });
    const replace = h('button', { onclick: async () => {
      const files = await chooseFiles(false);
      const vals = await prepareUploads(files, uploadFolder(doc));
      if (!vals.length) return;
      checkpoint();
      it[key] = vals[0];
      big.src = imgSrc(it[key], true);
      changed();
    } }, 'Replace with another photo…');
    const body = h('div', { class: 'detail' },
      h('div', { class: 'detail-col' }, h('div', { class: 'detail-img' }, big), h('div', { class: 'row' }, replace,
        h('span', { class: 'muted small' }, 'Keeps its place and details.'))),
      h('div', { class: 'detail-form' },
        fields.length ? h('div', { class: 'form compact' }, fields.map((s) => fieldRow(it, s, doc))) : h('p', { class: 'muted' }, 'Nothing else to fill in for this photo.'),
        doc.entry.name === 'galleries' ? h('p', { class: 'muted small' }, 'Titles and captions are private notes; visitors don\'t see them while “Show photo titles and captions” is off.') : null));
    modal(`Photo ${i + 1} of ${arr.length}`, body, [
      { label: '‹ Previous', value: 'prev' }, { label: 'Next ›', value: 'next' }, { label: 'Done', primary: true, value: 'done' },
    ], { wide: true }).then((r) => {
      draw();
      if (r === 'prev' && i > 0) openDetail(i - 1);
      if (r === 'next' && i < arr.length - 1) openDetail(i + 1);
    });
  }

  wrap.addEventListener('keydown', (e) => {
    if (e.target !== wrap) return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel.size) { e.preventDefault(); removeSelected(); }
    if (e.key === 'a' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); arr.forEach((_, i) => sel.add(i)); drawSel(); }
  });
  // Dropping files or photos on empty space adds them at the end.
  wrap.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files') || (DRAG && DRAG.type === 'photos' && DRAG.arr === arr)) e.preventDefault();
    autoScroll(e);
  });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropMarks();
    if (e.dataTransfer.files && e.dataTransfer.files.length) return addFiles(e.dataTransfer.files);
    if (DRAG && DRAG.type === 'photos' && DRAG.arr === arr) reorder(DRAG.idx, arr.length);
  });
  draw();
  wrap.doc = doc;
  wrap.redraw = draw;
  wrap.append(bar, grid);
  return wrap;
}

function autoScroll(e) {
  const sc = $('.main-scroll');
  if (!sc) return;
  const r = sc.getBoundingClientRect();
  if (e.clientY < r.top + 70) sc.scrollTop -= 18;
  else if (e.clientY > r.bottom - 70) sc.scrollTop += 18;
}
document.addEventListener('dragover', (e) => { if (DRAG) autoScroll(e); });

// Pick photos already on the website, grouped by folder.
function pickPhotos(multiple, already = new Set()) {
  const paths = allPhotoPaths();
  const folders = [...new Set(paths.map(dirname))];
  const chosen = new Set();
  const grid = h('div', { class: 'grid picker' });
  grid.style.setProperty('--tile', '120px');
  const folderSel = h('select', {}, folders.map((f) => h('option', { value: f }, f.slice(inDir().length + 1) || '(top)')));
  const info = h('span', { class: 'muted' });
  const draw = () => {
    grid.replaceChildren(...paths.filter((p) => dirname(p) === folderSel.value).map((p) => {
      const v = valueOf(p);
      const t = h('div', { class: 'tile' + (chosen.has(v) ? ' selected' : '') + (already.has(v) ? ' already' : '') },
        h('img', { src: imgSrc(v), loading: 'lazy', alt: '' }));
      t.addEventListener('click', () => {
        if (!multiple) chosen.clear();
        chosen.has(v) ? chosen.delete(v) : chosen.add(v);
        draw();
      });
      return t;
    }));
    info.textContent = chosen.size ? `${chosen.size} chosen` : already.size ? 'Faded photos are already here.' : '';
  };
  folderSel.addEventListener('change', draw);
  draw();
  return modal(multiple ? 'Add photos from your website' : 'Choose a photo',
    h('div', {}, h('div', { class: 'row' }, h('label', { class: 'field inline' }, h('span', {}, 'Folder'), folderSel), info), grid),
    [{ label: 'Cancel', value: null }, { label: multiple ? 'Add' : 'Choose', primary: true, value: 'ok' }], { wide: true })
    .then((r) => (r === 'ok' && chosen.size ? [...chosen] : null));
}

// ---------- publishing ----------
function imagesOf(doc, data) {
  const f = photoListField(doc.entry);
  return f ? (data[f.name] || []).map((it) => it[imageKey(f)]) : [];
}
function describeChanges() {
  const lines = [];
  for (const d of S.docs.values()) {
    if (!isDirty(d)) continue;
    const what = `${kindName(d.entry)} “${docTitle(d)}”`;
    if (d.deleted) { lines.push(`Deleted ${what}`); continue; }
    if (d.isNew) { const n = imagesOf(d, d.data).length; lines.push(`New ${what}${n ? ` with ${plural(n, 'photo')}` : ''}`); continue; }
    const before = JSON.parse(d.canon);
    const a = imagesOf(d, before), b = imagesOf(d, d.data);
    const sa = new Set(a), sb = new Set(b);
    const added = b.filter((x) => !sa.has(x)).length, removed = a.filter((x) => !sb.has(x)).length;
    const parts = [];
    if (added) parts.push(`${plural(added, 'photo')} added`);
    if (removed) parts.push(`${plural(removed, 'photo')} removed`);
    const common = a.filter((x) => sb.has(x)), common2 = b.filter((x) => sa.has(x));
    if (common.join() !== common2.join()) parts.push('photos rearranged');
    const f = photoListField(d.entry);
    const strip = (o) => { const c = { ...o }; if (f) delete c[f.name]; return JSON.stringify(c); };
    const listOnly = f && JSON.stringify(before[f.name] || []) !== JSON.stringify(d.data[f.name] || []) && !added && !removed && common.join() === common2.join();
    if (strip(before) !== strip(d.data) || listOnly) parts.push('details edited');
    const name = d.entry.type === 'file' ? cleanLabel(d.entry.label) : what.charAt(0).toUpperCase() + what.slice(1);
    lines.push(`${name}: ${parts.join(', ') || 'edited'}`);
  }
  return lines;
}

function validate() {
  const problems = [];
  for (const d of S.docs.values()) {
    if (d.deleted) continue;
    for (const f of d.entry.fields) if (f.required && !String(d.data[f.name] ?? '').trim()) problems.push(`${kindName(d.entry)} “${docTitle(d)}” needs a ${cleanLabel(f.label).toLowerCase()}.`);
  }
  return problems;
}

async function publishDialog() {
  const lines = describeChanges();
  const refs = currentRefs();
  const newPhotos = [...S.uploads.keys()].filter((p) => refs.has(p));
  const gone = [...S.initialRefs].filter((p) => !refs.has(p));
  const problems = validate();
  if (problems.length) return modal("Can't publish yet", h('ul', {}, problems.map((p) => h('li', {}, p))), [{ label: 'OK', primary: true }]);
  if (!lines.length && !newPhotos.length) return toast('Nothing to publish.');
  const status = h('p', { class: 'muted' });
  const body = h('div', {},
    h('ul', { class: 'changes' }, lines.map((l) => h('li', {}, l)),
      newPhotos.length ? h('li', {}, `Upload ${plural(newPhotos.length, 'new photo')}`) : null,
      gone.length ? h('li', {}, `Delete ${plural(gone.length, 'photo file')} no longer used anywhere`) : null),
    h('p', { class: 'muted' }, 'The website updates about a minute after publishing.'), status);
  let busy = false;
  await modal('Publish to your website', body, [
    { label: 'Cancel', value: null, check: () => !busy },
    { label: 'Publish', primary: true, check: async () => {
      if (busy) return false;
      busy = true;
      document.querySelectorAll('.modal-buttons button').forEach((b) => (b.disabled = true));
      try {
        await publish(lines, (t) => (status.textContent = t));
        return true;
      } catch (e) {
        status.textContent = '';
        status.append(h('span', { class: 'error' }, e.message));
        document.querySelectorAll('.modal-buttons button').forEach((b) => (b.disabled = false));
        busy = false;
        return false;
      }
    } },
  ], { sticky: true });
}

async function publish(lines, say) {
  for (let attempt = 0; attempt < 2; attempt++) {
    say('Checking the website for changes made elsewhere…');
    const head = await S.repo.head();
    let files = S.snap.files, baseTree = S.snap.treeSha;
    if (head !== S.snap.commit) {
      const fresh = await S.repo.snapshot(head);
      const clashes = [...S.docs.values()].filter((d) => isDirty(d) && fresh.files.get(d.path) !== S.snap.files.get(d.path));
      if (clashes.length) {
        throw new Error(`Someone changed ${clashes.map(docTitle).join(', ')} on the website since you opened the app. ` +
          'Choose View > Reload From Website (your unpublished changes will be lost), then make them again.');
      }
      files = fresh.files;
      baseTree = fresh.treeSha;
    }
    const refs = currentRefs();
    const changes = [];
    for (const d of S.docs.values()) {
      if (!isDirty(d)) continue;
      if (d.deleted) { if (files.has(d.path)) changes.push({ path: d.path, delete: true }); }
      else changes.push({ path: d.path, text: serialize(d.data) });
    }
    for (const [p, u] of S.uploads) {
      if (!refs.has(p)) continue;
      changes.push({ path: p, blob: u.blob }, { path: thumbPath(p), blob: u.thumb });
    }
    for (const p of S.initialRefs) {
      if (refs.has(p)) continue;
      if (files.has(p)) changes.push({ path: p, delete: true });
      if (files.has(thumbPath(p))) changes.push({ path: thumbPath(p), delete: true });
    }
    const n = [...S.uploads.keys()].filter((p) => refs.has(p)).length;
    const message = (lines.length === 1 ? lines[0] : `Update website: ${lines.length ? plural(lines.length, 'change') : ''}${n ? `${lines.length ? ', ' : ''}${plural(n, 'new photo')}` : ''}`) +
      (lines.length > 1 ? '\n\n' + lines.map((l) => '- ' + l).join('\n') : '') + '\n\nPublished with Scott Hunt Site Manager.';
    try {
      await S.repo.commit(head, baseTree, changes, message, (i, total) => say(`Uploading photos: ${i} of ${total}…`));
    } catch (e) {
      // Someone published in the moment between our check and our save: start over once.
      if (e.status === 422 && attempt === 0) continue;
      throw e;
    }
    say('Published.');
    await loadAll(true);
    toast('Published. The website updates in about a minute.', { label: 'View site', run: () => Native.open(siteURL()) });
    return;
  }
}

// Keyboard: Cmd+Z outside text fields undoes the last change.
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if (!typing && (e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && S.snap) { e.preventDefault(); undo(); }
});
document.addEventListener('dragover', (e) => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => e.preventDefault());

start();
