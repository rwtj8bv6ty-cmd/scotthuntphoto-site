// Mobile menu
document.querySelector('.menu-toggle')?.addEventListener('click', (e) => {
  const open = document.body.classList.toggle('menu-open');
  e.currentTarget.setAttribute('aria-expanded', open);
});

// Home page slideshow: crossfade with a slow zoom
const hero = document.querySelector('.hero');
if (hero) {
  const slides = [...hero.querySelectorAll('.slide')];
  const seconds = Number(hero.dataset.interval) || 6;
  let i = 0;
  if (slides.length > 1) {
    setInterval(() => {
      slides[i].classList.remove('on');
      i = (i + 1) % slides.length;
      slides[i].classList.add('on');
    }, seconds * 1000);
  }
}

// Gallery lightbox with keyboard and swipe
const lb = document.querySelector('.lightbox');
if (lb) {
  const figures = [...document.querySelectorAll('.photo')];
  const photos = figures.map((f) => JSON.parse(f.dataset.photo));
  const lbImg = lb.querySelector('img');
  const lbCap = lb.querySelector('figcaption');
  let at = 0;
  const show = (n) => {
    at = (n + photos.length) % photos.length;
    const p = photos[at];
    lbImg.src = p.src;
    lbImg.alt = p.title;
    lbCap.innerHTML = (p.title ? `<strong>${p.title.replace(/</g, '&lt;')}</strong> ` : '') + (p.caption ? p.caption.replace(/</g, '&lt;') : '') + (p.edition || '');
    lbImg.style.animation = 'none'; lbImg.offsetHeight; lbImg.style.animation = '';
  };
  const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
  figures.forEach((f, n) => f.querySelector('.open').addEventListener('click', () => { show(n); lb.hidden = false; document.body.style.overflow = 'hidden'; }));
  lb.querySelector('.lb-close').addEventListener('click', close);
  lb.querySelector('.lb-prev').addEventListener('click', () => show(at - 1));
  lb.querySelector('.lb-next').addEventListener('click', () => show(at + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
  let x0 = null;
  lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  });
}

// Contact form: send without leaving the page, prefill from "Enquire" links
const form = document.querySelector('form.contact');
if (form) {
  const about = new URLSearchParams(location.search).get('about');
  if (about) form.message.value = `I'm interested in a print of "${about}".\n\n`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('.form-status');
    status.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      form.reset();
      status.textContent = 'Thank you. Your message has been sent.';
    } catch {
      status.textContent = 'Sorry, something went wrong. Please try again or email directly.';
    }
  });
}
