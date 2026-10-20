// Menu toggle (sidebar on the photography side, top bar on the Rock'n H side)
document.querySelector('.menu-toggle')?.addEventListener('click', (e) => {
  const open = document.body.classList.toggle('menu-open');
  e.currentTarget.setAttribute('aria-expanded', open);
});

// Crossfading slideshows: entrance background and photography home feature
function rotate(container, selector, onClass) {
  if (!container) return;
  const items = [...container.querySelectorAll(selector)];
  const seconds = Number(container.dataset.interval) || 6;
  let i = 0;
  if (items.length > 1) {
    setInterval(() => {
      items[i].classList.remove(onClass);
      i = (i + 1) % items.length;
      items[i].classList.add(onClass);
    }, seconds * 1000);
  }
}
rotate(document.querySelector('.hero'), '.slide', 'on');
rotate(document.querySelector('.feature'), '.feature-img', 'on');

// Gallery slideshow: one photo at a time, arrows, keys, swipe, and a thumbnail grid
const ss = document.querySelector('.slideshow');
const dataEl = document.querySelector('.ss-data');
if (ss && dataEl) {
  const photos = JSON.parse(dataEl.textContent);
  const stageImg = ss.querySelector('.stage img');
  const caption = ss.querySelector('.ss-caption');
  const count = ss.querySelector('.ss-count');
  const edition = ss.querySelector('.ss-edition');
  const thumbs = document.querySelector('.thumbs');
  const thumbBtn = ss.querySelector('.ss-thumbs');
  let at = Math.min(Math.max((parseInt(location.hash.slice(1), 10) || 1) - 1, 0), photos.length - 1);

  const preload = (n) => { const p = photos[(n + photos.length) % photos.length]; if (p) new Image().src = p.src; };
  const show = (n) => {
    at = (n + photos.length) % photos.length;
    const p = photos[at];
    stageImg.classList.add('fading');
    const next = new Image();
    next.onload = next.onerror = () => {
      stageImg.src = p.src;
      stageImg.alt = p.alt;
      stageImg.classList.remove('fading');
    };
    next.src = p.src;
    caption.textContent = p.caption;
    count.textContent = `${at + 1} / ${photos.length}`;
    edition.innerHTML = p.edition || '';
    history.replaceState(null, '', `#${at + 1}`);
    preload(at + 1);
    preload(at - 1);
  };
  const setThumbs = (on) => {
    thumbs.hidden = !on;
    ss.hidden = on;
    thumbBtn.textContent = on ? 'show slideshow' : 'show thumbnails';
    document.body.classList.toggle('thumbs-on', on);
    if (on) thumbs.prepend(thumbBtn);
    else ss.querySelector('.ss-controls').append(thumbBtn);
    window.scrollTo(0, 0);
  };

  if (at) show(at); else preload(1);
  ss.querySelectorAll('.prev, .ss-prev').forEach((b) => b.addEventListener('click', () => show(at - 1)));
  ss.querySelectorAll('.next, .ss-next').forEach((b) => b.addEventListener('click', () => show(at + 1)));
  thumbBtn.addEventListener('click', () => setThumbs(thumbs.hidden));
  thumbs.addEventListener('click', (e) => {
    const t = e.target.closest('.thumb');
    if (!t) return;
    setThumbs(false);
    show(Number(t.dataset.index));
  });
  document.addEventListener('keydown', (e) => {
    if (!thumbs.hidden || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
  let x0 = null;
  ss.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  ss.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  });
}

// Forms (contact and newsletter): send without leaving the page; "Enquire" links prefill the message
document.querySelectorAll('form.contact').forEach((form) => {
  const about = new URLSearchParams(location.search).get('about');
  if (about && form.message) form.message.value = `I'm interested in a print of "${about}".\n\n`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('.form-status');
    status.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      form.reset();
      status.textContent = form.classList.contains('newsletter') ? 'Thank you for subscribing.' : 'Thank you. Your message has been sent.';
    } catch {
      status.textContent = 'Sorry, something went wrong. Please try again.';
    }
  });
});

// Print page: choosing a size updates the price and the Buy button
const sizes = document.querySelector('.sizes');
if (sizes) {
  const price = document.querySelector('.product .price');
  const buy = document.querySelector('.buy-now');
  sizes.addEventListener('change', (e) => {
    const opt = e.target;
    price.firstChild.textContent = opt.dataset.price;
    if (!buy) return;
    if (opt.dataset.link) {
      buy.href = opt.dataset.link; buy.target = '_blank'; buy.rel = 'noopener'; buy.textContent = 'Buy now';
    } else {
      buy.href = buy.dataset.enquire; buy.removeAttribute('target'); buy.textContent = 'Enquire';
    }
  });
}

// ===== Rock'n H shop: cart saved in this browser =====
const CART_KEY = 'rocknhCart';
const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
const writeCart = (items) => { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {} updateCount(); };
function updateCount() {
  const n = readCart().reduce((a, i) => a + (i.qty || 0), 0);
  document.querySelectorAll('.cart-count').forEach((el) => { el.textContent = n ? `(${n})` : ''; });
}
updateCount();
const fmt = (n, symbol = '$') => `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Print page: pick material, then size; the price follows the choice.
const buyForm = document.querySelector('.buy-form');
const printData = document.querySelector('.print-data');
if (buyForm && printData) {
  const print = JSON.parse(printData.textContent);
  const sizeList = buyForm.querySelector('.size-list');
  const button = buyForm.querySelector('.add-to-cart');
  const material = () => buyForm.querySelector('input[name=material]:checked')?.value ?? print.options[0].material;
  const chosen = () => {
    const id = Number(buyForm.querySelector('input[name=option]:checked')?.value);
    return print.options.find((o) => o.id === id);
  };
  const renderSizes = () => {
    const m = material();
    const keep = chosen()?.size;
    const opts = print.options.filter((o) => o.material === m);
    sizeList.innerHTML = opts
      .map((o, i) => `<label class="size"><input type="radio" name="option" value="${o.id}"${(keep ? o.size === keep : i === 0) ? ' checked' : ''}><span>${o.size || 'Standard'}</span></label>`)
      .join('');
    if (!sizeList.querySelector(':checked')) sizeList.querySelector('input')?.click();
    renderPrice();
  };
  // Materials shipped on request (e.g. acrylic) can't be bought online: show the price and a quote link instead.
  const quote = buyForm.querySelector('.ship-request');
  const renderPrice = () => {
    const o = chosen();
    const ask = Boolean(o && o.onRequest);
    button.hidden = ask;
    buyForm.querySelector('.qty').hidden = ask;
    if (quote) quote.hidden = !ask;
    button.textContent = o ? `Add to cart · ${fmt(o.price)}` : 'Add to cart';
    const note = buyForm.querySelector('.edition-note');
    if (note) note.textContent = o && o.edition ? `Limited edition of ${o.edition}${o.sold ? ` · ${o.edition - o.sold} remaining` : ''}` : '';
    if (ask && quote) quote.querySelector('a').textContent = `Request a shipping quote · print ${fmt(o.price)}`;
  };
  buyForm.addEventListener('change', (e) => { if (e.target.name === 'material') renderSizes(); else renderPrice(); });
  buyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const o = chosen();
    if (!o || o.onRequest) return;
    const qty = Math.min(o.edition ? o.edition - o.sold : 10, 10, Math.max(1, parseInt(buyForm.qty.value, 10) || 1));
    const key = `${print.slug}|${o.material}|${o.size}`;
    const items = readCart();
    const found = items.find((i) => i.key === key);
    if (found) found.qty = Math.min(10, found.qty + qty);
    else items.push({ key, slug: print.slug, material: o.material, size: o.size, qty });
    writeCart(items);
    buyForm.querySelector('.added').innerHTML = `Added to your cart. <a href="${document.querySelector('.nav-cart a').getAttribute('href')}">View cart</a>`;
  });
  renderSizes();
}

// Cart page: prices come from the site's own catalog, then PayPal takes payment.
const cartEl = document.querySelector('.cart');
if (cartEl) {
  const catalog = JSON.parse(document.querySelector('.cart-catalog').textContent);
  const cfg = JSON.parse(document.querySelector('.cart-config').textContent);
  const money = (n) => fmt(n, cfg.symbol);
  // Drop anything no longer sold, and re-price everything from the catalog.
  const lines = () =>
    readCart()
      .map((i) => {
        const p = catalog[i.slug];
        const o = p && p.options.find((x) => x.material === i.material && x.size === i.size);
        return o ? { ...i, title: p.title, image: p.image, url: p.url, price: o.price } : null;
      })
      .filter(Boolean);
  // Shipping: with a rate table, the price depends on the size and the region of the state it ships to.
  // Prints ship together, so an order pays once, at the rate of its most expensive (largest) print.
  const SHIP_KEY = 'rockn-h-ship-state';
  const byRegion = cfg.zones.length > 0;
  const shipSelect = cartEl.querySelector('.ship-to select');
  let shipState = '';
  try { shipState = localStorage.getItem(SHIP_KEY) || ''; } catch {}
  if (byRegion && shipSelect) {
    shipSelect.closest('.ship-to').hidden = false;
    shipSelect.value = shipState;
    shipSelect.addEventListener('change', () => {
      shipState = shipSelect.value;
      try { localStorage.setItem(SHIP_KEY, shipState); } catch {}
      render();
    });
  }
  const zoneOf = (state) => state && (cfg.zones.find((z) => z.states.includes(state)) || cfg.zones.find((z) => !z.states.length));
  // Sizes match on their first two numbers, so "7x19", "7 × 19 in" and "7 × 19 in (11 × 22 overall)" are the same size.
  const sizeKey = (v) => { const n = String(v || '').match(/\d+(?:\.\d+)?/g); return n && n.length >= 2 ? `${n[0]}x${n[1]}` : String(v || '').trim().toLowerCase(); };
  const rateFor = (size, zone) => cfg.rates.find((r) => r.zone.toLowerCase() === zone.name.toLowerCase() && sizeKey(r.size) === sizeKey(size));
  // Sales tax for the chosen state, worked out in cents so PayPal's totals add up exactly.
  const taxFor = (state) => (cfg.tax || []).find((x) => x.state === state);
  const withTax = (t) => {
    const rule = t.ready && taxFor(shipState);
    const cents = (n) => Math.round(n * 100);
    const tax = rule ? Math.round(((cents(t.sub) + (rule.shipping ? cents(t.ship) : 0)) * rule.rate) / 100) / 100 : 0;
    return { ...t, tax, rate: rule ? rule.rate : 0, total: (cents(t.sub) + cents(t.ship) + Math.round(tax * 100)) / 100 };
  };
  const totals = (ls) => withTax(baseTotals(ls));
  const baseTotals = (ls) => {
    const sub = ls.reduce((a, l) => a + l.price * l.qty, 0);
    if (!byRegion) {
      const ship = ls.length ? cfg.shipping : 0;
      return { sub, ship, total: sub + ship, ready: true };
    }
    const zone = zoneOf(shipState);
    if (!zone) return { sub, ship: 0, total: sub, ready: false, need: 'state' };
    let ship = 0;
    for (const l of ls) {
      const r = rateFor(l.size, zone);
      if (!r) return { sub, ship: 0, total: sub, ready: false, need: 'rate', zone };
      ship = Math.max(ship, r.price);
    }
    return { sub, ship, total: sub + ship, ready: true, zone };
  };
  const payBox = cartEl.querySelector('#paypal-buttons');
  const render = () => {
    const ls = lines();
    writeCart(ls.map(({ key, slug, material, size, qty }) => ({ key, slug, material, size, qty })));
    const box = cartEl.querySelector('.cart-items');
    const summary = cartEl.querySelector('.cart-summary');
    if (!ls.length) {
      box.innerHTML = `<p class="note">Your cart is empty. <a href="${cfg.shop}">Browse the prints</a>.</p>`;
      summary.hidden = true;
      return;
    }
    box.innerHTML = ls
      .map((l) => `<div class="cart-line" data-key="${l.key.replace(/"/g, '&quot;')}">
        <a href="${l.url}"><img src="${l.image}" alt=""></a>
        <div><a href="${l.url}" class="cl-title">${l.title}</a><p class="cl-opt">${[l.material, l.size].filter(Boolean).join(' · ')}</p>
        <label class="qty">Qty <input type="number" min="0" max="10" value="${l.qty}"></label> <button class="cl-remove">Remove</button></div>
        <span class="cl-price">${money(l.price * l.qty)}</span></div>`)
      .join('');
    const t = totals(ls);
    cartEl.querySelector('.subtotal').textContent = money(t.sub);
    cartEl.querySelector('.shipping').textContent =
      t.need === 'state' ? 'Choose a state' : t.need === 'rate' ? 'Quoted on request' : t.ship ? money(t.ship) : byRegion ? 'Free' : 'Included';
    const taxRow = cartEl.querySelector('.tax-row');
    if (taxRow) { taxRow.hidden = !t.tax; taxRow.querySelector('span').textContent = `Sales tax (${t.rate}%)`; taxRow.querySelector('.tax').textContent = money(t.tax); }
    cartEl.querySelector('.grand').textContent = money(t.total);
    cartEl.querySelector('.ship-missing').hidden = t.need !== 'rate';
    if (payBox) payBox.hidden = !t.ready;
    summary.hidden = false;
  };
  cartEl.addEventListener('change', (e) => {
    const line = e.target.closest('.cart-line');
    if (!line) return;
    const qty = Math.min(10, Math.max(0, parseInt(e.target.value, 10) || 0));
    writeCart(readCart().map((i) => (i.key === line.dataset.key ? { ...i, qty } : i)).filter((i) => i.qty > 0));
    render();
  });
  cartEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('cl-remove')) return;
    const key = e.target.closest('.cart-line').dataset.key;
    writeCart(readCart().filter((i) => i.key !== key));
    render();
  });
  render();

  if (!cfg.clientId) {
    cartEl.querySelector('.checkout-off').hidden = false;
  } else {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=${encodeURIComponent(cfg.currency)}&components=buttons&enable-funding=card`;
    s.onload = () => {
      window.paypal.Buttons({
        style: { layout: 'vertical', color: 'black', shape: 'rect', label: 'checkout' },
        onClick: (data, actions) => (totals(lines()).ready ? actions.resolve() : actions.reject()),
        createOrder: (data, actions) => {
          const ls = lines();
          const t = totals(ls);
          const v = (n) => n.toFixed(2);
          return actions.order.create({
            purchase_units: [{
              description: `${cfg.store} prints`,
              amount: {
                currency_code: cfg.currency, value: v(t.total),
                breakdown: { item_total: { currency_code: cfg.currency, value: v(t.sub) }, shipping: { currency_code: cfg.currency, value: v(t.ship) }, tax_total: { currency_code: cfg.currency, value: v(t.tax) } },
              },
              items: ls.map((l) => ({
                name: l.title.slice(0, 120), description: [l.material, l.size].filter(Boolean).join(' · ').slice(0, 120),
                quantity: String(l.qty), unit_amount: { currency_code: cfg.currency, value: v(l.price) }, category: 'PHYSICAL_GOODS',
              })),
            }],
          });
        },
        // Before taking payment, make sure PayPal's shipping address is in the U.S. and in the region that was priced.
        onApprove: (data, actions) => (byRegion ? actions.order.get() : Promise.resolve(null)).then((order) => {
          const addr = order && order.purchase_units && order.purchase_units[0].shipping && order.purchase_units[0].shipping.address;
          if (addr) {
            const t = totals(lines());
            const there = addr.country_code === 'US' && zoneOf(String(addr.admin_area_1 || '').toUpperCase());
            const st = String(addr.admin_area_1 || '').toUpperCase();
            const taxDiffers = (taxFor(st) || {}).rate !== (taxFor(shipState) || {}).rate;
            if (!there || there.name !== t.zone.name || taxDiffers) {
              const off = cartEl.querySelector('.checkout-off');
              off.hidden = false;
              off.textContent = addr.country_code !== 'US'
                ? 'Sorry, we can only ship within the United States online. Please send us a message for an international quote. You have not been charged.'
                : `Your PayPal shipping address is in ${addr.admin_area_1}. Please choose that state above and check out again. You have not been charged.`;
              return null;
            }
          }
          return actions.order.capture();
        }).then((captured) => {
          if (!captured) return;
          writeCart([]);
          cartEl.querySelector('.cart-items').innerHTML = '';
          cartEl.querySelector('.cart-summary').hidden = true;
          cartEl.querySelector('.cart-done').hidden = false;
        }),
        onError: () => {
          cartEl.querySelector('.checkout-off').hidden = false;
          cartEl.querySelector('.checkout-off').textContent = 'Sorry, the payment did not go through. Please try again, or send us a message.';
        },
      }).render('#paypal-buttons');
    };
    s.onerror = () => { cartEl.querySelector('.checkout-off').hidden = false; };
    document.head.appendChild(s);
  }
}

// Rock'n H print page: click the photo to see it full page; click again, the X, or Esc to go back.
(() => {
  const photo = document.querySelector('.product-img img.zoom');
  if (!photo) return;
  const full = document.createElement('div');
  full.className = 'rk-full';
  full.innerHTML = '<button class="full-close" type="button" aria-label="Close">\u00d7</button><img alt="">';
  const big = full.querySelector('img');
  big.alt = photo.alt;
  document.body.appendChild(full);
  const open = () => {
    big.src = photo.currentSrc || photo.src;
    document.documentElement.classList.add('full-lock');
    full.classList.add('open');
  };
  const close = () => {
    full.classList.remove('open');
    document.documentElement.classList.remove('full-lock');
  };
  photo.addEventListener('click', open);
  photo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  full.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();

// Photography menu: clicking a gallery that has sub-menus (e.g. Anthologies) folds them open or closed.
document.querySelectorAll('.nav-parent > a').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (a.hasAttribute('data-page')) return; // parent with its own statement page: open it (its sub-menu shows there)
    e.preventDefault();
    const open = a.parentElement.classList.toggle('open');
    a.setAttribute('aria-expanded', String(open));
  });
});
