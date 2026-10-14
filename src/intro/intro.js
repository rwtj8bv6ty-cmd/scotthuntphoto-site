/*
  Scott Hunt opening animation: the rolling logo coin is flicked into motion, the
  camera tracks it, it bumps the rocking-chair logo coin, which rocks back and
  forth, and the rolling coin rolls back to upright. Silent by design.

  Usage:
    CoinIntro.mount(containerEl, {
      rollingSrc: 'rolling-logo.png',
      rockingSrc: 'rocking-logo.png',
      onDone: () => {},        // called when the animation finishes or is skipped
      ground: false,           // true draws a floor line and specks; false is a plain white stage
      entry: false,            // true: coin rolls in from the left, pan starts at frame centre
      panEase: 0.9,            // with entry: how gently the pan picks up the coin (bigger is gentler)
      links: {                 // optional: after the animation, each coin becomes a link that inverts on hover
        rolling: { href: '/galleries/', label: 'Scott Hunt Photography galleries' },
        rocking: { href: '/shop/', label: "Rock'n H" },
      },
      rollTime: 7.5,           // seconds of rolling before the bump
      turns: 3,                // how far the coin rolls, in turns; it always ends upright
      reflection: true,        // mirror the coins in a glossy white floor
      reflectionStrength: 0.16,
    }).start();

  Everything is drawn on a canvas, so there is no video file to load.
*/
(function () {
  'use strict';

  // ---- Timeline (seconds). World units: 1 = coin radius, y up, ground at 0. ----
  // T_ROLL is the rolling time until the bump; TURNS is the roll distance in
  // turns. The coin's spin is measured back from its resting spot, so it ends
  // upright even for a fractional number of turns. The rocking is the same whatever these are.
  function makeTimeline(T_ROLL, TURNS) {
    const TF = 0.5;             // coin is flicked into motion
    const TC = TF + T_ROLL;     // bump
    const REB = 1.8;            // rolling coin eases back after the bump
    const BACK = 0.7;           // how far the rolling coin backs off
    const XE = 2 * Math.PI * TURNS;      // final resting x of the rolling coin
    const XC = XE + BACK;                // x at the bump
    const VC = 1.0;                      // speed at the bump
    const V0 = (2 * XC) / T_ROLL - VC;   // launch speed
    const DEC = (V0 - VC) / T_ROLL;      // constant deceleration
    const XB = XC + 2;                   // rocking coin's resting x (touching at the bump)
    const ROCK_AMP = 0.38;               // first swing, radians
    const ROCK_PERIOD = 1.3;
    const ROCK_DECAY = 0.45;
    const ROCK_DUR = 3 * ROCK_PERIOD;   // rocking stops exactly upright
    const END = TC + Math.max(REB, ROCK_DUR) + 0.8;

    const GROUND_COLOR = '#e7e4df';
    const SPECK_COLOR = '#ece9e4';

    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const easeOutCubic = (u) => 1 - Math.pow(1 - clamp01(u), 3);
    const easeInCubic = (u) => Math.pow(clamp01(u), 3);

    // With entry, the coin is already rolling at launch speed before TF, so it
    // comes in from off-screen left instead of starting at rest.
    function rollingX(t, entry) {
      if (t <= TF) return entry ? V0 * (t - TF) : 0;
      if (t <= TC) { const u = t - TF; return V0 * u - 0.5 * DEC * u * u; }
      if (t <= TC + REB) return XC - BACK * easeOutCubic((t - TC) / REB);
      return XE;
    }
    function rollingSpeed(t, entry) {
      if (t <= TF) return entry ? V0 : 0;
      if (t <= TC) return V0 - DEC * (t - TF);
      if (t <= TC + REB) { const u = clamp01((t - TC) / REB); return (3 * BACK / REB) * (1 - u) * (1 - u); }
      return 0;
    }
    function rockAngle(t) {
      const u = t - TC;
      if (u <= 0 || u >= ROCK_DUR) return 0;
      const fade = 1 - u / ROCK_DUR;
      return ROCK_AMP * Math.exp(-ROCK_DECAY * u) * fade * Math.sin((2 * Math.PI * u) / ROCK_PERIOD);
    }
    // Camera follows the rolling coin, then settles between the two coins.
    function cameraX(t) {
      const lead = 1.6;
      if (t <= TC) return rollingX(t) + lead;
      const target = (XE + XB) / 2;
      const x0 = XC + lead - target;
      const w = 2.2;
      const u = t - TC;
      return target + (x0 + (VC + w * x0) * u) * Math.exp(-w * u);
    }
    // Entry version: the camera holds still at `hold` while the coin rolls in,
    // then picks it up as it reaches the centre of the frame and keeps it
    // centred. The hand-off is softened over about `k` coin radii so the pan
    // eases in instead of starting with a jolt; a larger `k` is gentler.
    function entryCameraX(t, hold, k) {
      const target = (XE + XB) / 2, w = 2.2;
      const follow = (x) => { const d = x - hold; return hold + (d + Math.sqrt(d * d + k * k)) / 2; };
      if (t <= TC) return follow(rollingX(t, true));
      const d = XC - hold;
      const x0 = follow(XC) - target;
      const v0 = VC * (1 + d / Math.sqrt(d * d + k * k)) / 2;
      const u = t - TC;
      return target + (x0 + (v0 + w * x0) * u) * Math.exp(-w * u);
    }
    return { XB, XE, END, rollingX, rockAngle, cameraX, entryCameraX };
  }

  // Small deterministic hash, used to scatter floor specks so motion reads.
  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // -------------------------------------------------------------- Drawing ----
  function mount(container, opts) {
    const o = Object.assign({ rollingSrc: 'rolling-logo.png', rockingSrc: 'rocking-logo.png', onDone: null, ground: false, entry: false, panEase: 0.9, rollTime: 7.5, turns: 3, reflection: true, reflectionStrength: 0.16 }, opts);
    const { XB, XE, END, rollingX, rockAngle, cameraX, entryCameraX } = makeTimeline(o.rollTime, o.turns);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    container.appendChild(canvas);
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';

    const imgA = new Image(); imgA.src = o.rollingSrc;
    const imgB = new Image(); imgB.src = o.rockingSrc;
    const ready = Promise.all([imgA, imgB].map((im) => im.decode ? im.decode().catch(() => {}) : new Promise((r) => { im.onload = r; })));

    let W = 0, H = 0, s = 1, groundY = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = container.clientWidth; H = container.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingQuality = 'high';
      s = Math.min(H * 0.16, W * 0.095);
      groundY = H * 0.6;
      DPR = dpr;
      sprites.clear();
    }

    // Pre-shrink each logo to its on-screen size in halving steps. Drawing the
    // full-size artwork straight down to coin size every frame makes fine
    // edges shimmer as the coin turns, which reads as jitter.
    let DPR = 1;
    const sprites = new Map();
    function sprite(img) {
      if (!(img.complete && img.naturalWidth)) return null;
      let c = sprites.get(img);
      if (c) return c;
      const target = Math.max(2, Math.round(2 * s * DPR));
      let src = img, w = img.naturalWidth, h = img.naturalHeight;
      while (w / 2 >= target) {
        const step = document.createElement('canvas');
        step.width = Math.round(w / 2); step.height = Math.round(h / 2);
        const sg = step.getContext('2d');
        sg.imageSmoothingQuality = 'high';
        sg.drawImage(src, 0, 0, step.width, step.height);
        src = step; w = step.width; h = step.height;
      }
      c = document.createElement('canvas');
      c.width = target; c.height = target;
      const cg = c.getContext('2d');
      cg.imageSmoothingQuality = 'high';
      cg.drawImage(src, 0, 0, target, target);
      sprites.set(img, c);
      return c;
    }
    resize();
    window.addEventListener('resize', () => { resize(); if (!running) draw(lastT); });

    let camX = 0;
    const sx = (x) => W / 2 + (x - camX) * s;
    const sy = (y) => groundY - y * s;

    function drawGround() {
      g.strokeStyle = GROUND_COLOR; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, groundY + 0.5); g.lineTo(W, groundY + 0.5); g.stroke();
      g.fillStyle = SPECK_COLOR;
      const spacing = 0.45;
      const i0 = Math.floor((camX - W / 2 / s) / spacing) - 1;
      const i1 = Math.ceil((camX + W / 2 / s) / spacing) + 1;
      for (let i = i0; i <= i1; i++) {
        const x = i * spacing + hash(i) * spacing;
        const y = -0.08 - hash(i + 99) * 1.1;
        const r = (0.6 + hash(i + 7) * 1.1) * (1 - y * 0.25);
        g.beginPath(); g.arc(sx(x), sy(y), r, 0, Math.PI * 2); g.fill();
      }
    }

    function drawShadow(x) {
      const cx = sx(x), cy = groundY + 1;
      g.save();
      g.translate(cx, cy); g.scale(1, 0.09);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.95);
      grad.addColorStop(0, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, s * 0.95, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // Colour-inverted copy of a sprite (alpha kept), shown when a coin is a
    // button under the pointer.
    const inverted = new WeakMap();
    function invSprite(img) {
      const sp = sprite(img);
      if (!sp) return null;
      let c = inverted.get(sp);
      if (c) return c;
      c = document.createElement('canvas');
      c.width = sp.width; c.height = sp.height;
      const cg = c.getContext('2d');
      cg.drawImage(sp, 0, 0);
      const d = cg.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = 255 - d.data[i]; d.data[i + 1] = 255 - d.data[i + 1]; d.data[i + 2] = 255 - d.data[i + 2];
      }
      cg.putImageData(d, 0, 0);
      inverted.set(sp, c);
      return c;
    }

    // `inv` (0..1) fades the coin to its inverted colours. A white coin would
    // vanish into the white stage, so a thin black rim fades in with it.
    function drawCoin(img, x, rot, inv, alpha = 1) {
      g.save();
      g.globalAlpha = alpha;
      g.translate(sx(x), sy(1));
      g.rotate(rot);
      const sp = sprite(img);
      if (sp) g.drawImage(sp, -s, -s, s * 2, s * 2);
      if (inv > 0) {
        const isp = invSprite(img);
        g.globalAlpha = alpha * inv;
        if (isp) g.drawImage(isp, -s, -s, s * 2, s * 2);
        const lw = Math.max(1.5, s * 0.025);
        g.strokeStyle = '#000'; g.lineWidth = lw;
        g.beginPath(); g.arc(0, 0, s - lw / 2, 0, Math.PI * 2); g.stroke();
      }
      g.restore();
    }

    // Mirror image in a glossy white floor (like white plexiglass): the coin
    // flipped about the floor line, faint, and fading out with depth.
    function drawReflection(img, x, rot, inv) {
      const sp = sprite(img);
      if (!sp) return;
      g.save();
      g.translate(sx(x), groundY + s);
      g.scale(1, -1);
      g.rotate(rot);
      g.globalAlpha = o.reflectionStrength * (1 - inv);
      g.drawImage(sp, -s, -s, s * 2, s * 2);
      if (inv > 0) {
        const isp = invSprite(img);
        g.globalAlpha = o.reflectionStrength * inv;
        if (isp) g.drawImage(isp, -s, -s, s * 2, s * 2);
      }
      g.restore();
    }
    function fadeReflections() {
      // Fade begins right at the contact line and eases out gradually.
      const depth = s * 1.7;
      const grad = g.createLinearGradient(0, groundY, 0, groundY + depth);
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const a = 0.25 + 0.75 * Math.sin((u * Math.PI) / 2);
        grad.addColorStop(u, `rgba(255,255,255,${a.toFixed(3)})`);
      }
      g.fillStyle = grad;
      g.fillRect(0, groundY, W, depth);
      g.fillStyle = '#ffffff';
      g.fillRect(0, groundY + depth - 1, W, H);  // 1px overlap hides an anti-aliased seam
    }

    // Hold the camera so the coin starts just past the left edge.
    const camAt = (t) => o.entry ? entryCameraX(t, rollingX(0, true) + 1.1 + W / 2 / s, o.panEase) : cameraX(t);

    // Motion blur for the live animation. A sharp white logo spinning on a
    // black coin strobes at 60 frames a second, which reads as jitter, so
    // while playing each frame averages several copies of the rolling coin
    // spread over half the frame interval, like a film camera's shutter.
    // `blurDt` is that frame interval in seconds; 0 draws one sharp copy.
    function drawRollingCoin(t, blurDt, inv) {
      const xa = rollingX(t, o.entry), cam = camX;
      const span = 0.5 * blurDt;
      // How far the logo's edge travels during the shutter, in device pixels.
      const travel = Math.abs(rollingX(t + span / 2, o.entry) - rollingX(t - span / 2, o.entry)) * s * DPR * 2;
      const n = blurDt > 0 ? Math.max(1, Math.min(12, Math.ceil(travel / 1.5))) : 1;
      if (n === 1) { drawCoin(imgA, xa, xa - XE, inv); return; }
      for (let i = 0; i < n; i++) {
        const ti = t + span * ((i + 0.5) / n - 0.5);
        const xi = rollingX(ti, o.entry);
        camX = camAt(ti);
        // Each copy at 1/(i+1) keeps a running average with equal weights.
        drawCoin(imgA, xi, xi - XE, inv, 1 / (i + 1));
      }
      camX = cam;
    }

    let lastT = 0;
    function draw(t, blurDt = 0) {
      lastT = t;
      camX = camAt(t);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      if (o.ground) drawGround();
      const xa = rollingX(t, o.entry);
      const th = rockAngle(t);
      const xb = XB + th;
      if (o.reflection) {
        drawReflection(imgB, xb, th, hover.b);
        drawReflection(imgA, xa, xa - XE, hover.a);
        fadeReflections();
      }
      drawShadow(xb);
      drawShadow(xa);
      drawCoin(imgB, xb, th, hover.b);
      drawRollingCoin(t, blurDt, hover.a);
      if (!running) placeButtons(xa, xb);
    }

    // ---- Buttons: once the animation ends, each coin is a link. ----
    // Real <a> elements sit over the coins so mouse, touch and keyboard all
    // work; hovering or focusing one inverts its coin.
    const hover = { a: 0, b: 0 }, want = { a: 0, b: 0 };
    const buttons = {};
    if (o.links) {
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      for (const [key, link] of [['a', o.links.rolling], ['b', o.links.rocking]]) {
        if (!link) continue;
        const el = document.createElement('a');
        el.href = link.href; el.setAttribute('aria-label', link.label || '');
        el.style.cssText = 'position:absolute;border-radius:50%;display:none;cursor:pointer;outline-offset:6px;';
        const on = () => { want[key] = 1; animateHover(); };
        const off = () => { want[key] = 0; animateHover(); };
        el.addEventListener('mouseenter', on); el.addEventListener('focus', on);
        el.addEventListener('mouseleave', off); el.addEventListener('blur', off);
        container.appendChild(el);
        buttons[key] = el;
      }
    }
    function placeButtons(xa, xb) {
      for (const [key, x] of [['a', xa], ['b', xb]]) {
        const el = buttons[key];
        if (!el) continue;
        el.style.display = done ? 'block' : 'none';
        el.style.left = `${sx(x) - s}px`; el.style.top = `${sy(1) - s}px`;
        el.style.width = el.style.height = `${2 * s}px`;
      }
    }
    let hoverRaf = 0, hoverPrev = 0;
    function animateHover() {
      if (hoverRaf || running) return;
      hoverPrev = performance.now();
      const step = (now) => {
        const k = Math.min(1, Math.max(0, now - hoverPrev) / 160);  // about 0.16 s to fully invert
        hoverPrev = now;
        let moving = false;
        for (const key of ['a', 'b']) {
          const d = want[key] - hover[key];
          hover[key] = Math.abs(d) <= k ? want[key] : hover[key] + Math.sign(d) * k;
          if (hover[key] !== want[key]) moving = true;
        }
        draw(lastT);
        hoverRaf = moving ? requestAnimationFrame(step) : 0;
      };
      hoverRaf = requestAnimationFrame(step);
    }

    let running = false, raf = 0, clock = null, done = false;
    function finish() {
      if (done) return;
      done = true; running = false; cancelAnimationFrame(raf);
      draw(END);
      if (o.onDone) o.onDone();
    }
    // Time comes from the frame timestamp the browser hands requestAnimationFrame,
    // which is evenly spaced with the display. Reading the clock inside the
    // callback instead picks up scheduling noise that shows as jitter.
    let prevNow = 0, frameDt = 1 / 60;
    function tick(now) {
      const t = clock(now);
      if (t >= END) { finish(); return; }
      // Smoothed frame interval (60 Hz, 120 Hz, ...) sets the blur length.
      if (prevNow) frameDt += (Math.min(0.05, (now - prevNow) / 1000) - frameDt) * 0.2;
      prevNow = now;
      draw(Math.max(0, t), frameDt);
      raf = requestAnimationFrame(tick);
    }

    const api = {
      duration: END,
      async start() {
        await ready;
        done = false;
        want.a = want.b = hover.a = hover.b = 0;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) { finish(); return; }
        const p0 = performance.now() + 80;
        clock = (now) => (now - p0) / 1000;
        running = true;
        prevNow = 0;
        placeButtons(0, 0);
        raf = requestAnimationFrame(tick);
      },
      skip: finish,
      async seek(t) { await ready; draw(t); },
      // For video export: draw time t with the live motion blur over a frame of `dt` seconds.
      async seekBlur(t, dt) { await ready; draw(t, dt); },
    };
    ready.then(() => { if (!running) draw(0); });
    return api;
  }

  window.CoinIntro = { mount };
})();
