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
