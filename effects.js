/* ===================================================================
   effects.js — Canvas particle system (confetti, sparkles, bursts).

   • Single full-screen canvas overlay.
   • Object pool: particles are reused, never garbage-collected mid-game.
   • The RAF loop runs only while particles are alive, then sleeps,
     so an idle board costs nothing.

   Public API:
     AP.effects.init(canvas)
     AP.effects.burst(x, y, opts)      – small pop at a removed tile
     AP.effects.sparkle(x, y)          – tiny twinkle
     AP.effects.confetti()             – full-screen celebration
   =================================================================== */
(function (AP) {
  "use strict";

  const POOL_SIZE = 420;
  const COLORS = ["#4F8EF7", "#5B97FF", "#FFC24B", "#34D399", "#F0707E", "#A78BFA"];

  let canvas, ctx;
  let dpr = 1;
  let W = 0, H = 0;
  let running = false;

  // Pre-allocated particle pool. Each particle is a flat object reused forever.
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, size: 4, rot: 0, vr: 0, color: "#fff", shape: 0, drag: 1 });
  }

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize, { passive: true });
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }



  // Grab a free particle from the pool (or recycle the first if exhausted).
  function obtain() {
    for (let i = 0; i < POOL_SIZE; i++) if (!pool[i].active) return pool[i];
    return pool[0];
  }

  function ensureLoop() {
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  /* ---------- spawners ---------- */

  // Small dust/spark burst at a tile that was just removed.
  function burst(x, y, opts = {}) {
    const n = opts.count || 8;
    const color = opts.color || COLORS[0];
    for (let i = 0; i < n; i++) {
      const p = obtain();
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 3.5;
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s - 1;
      p.g = 0.12; p.drag = 0.96;
      p.life = 0; p.max = 28 + Math.random() * 16;
      p.size = 2 + Math.random() * 3;
      p.rot = 0; p.vr = 0;
      p.color = color; p.shape = 0; // circle
    }
    ensureLoop();
  }

  // A couple of quick twinkles.
  function sparkle(x, y) {
    for (let i = 0; i < 4; i++) {
      const p = obtain();
      p.active = true;
      p.x = x + (Math.random() - 0.5) * 16;
      p.y = y + (Math.random() - 0.5) * 16;
      p.vx = (Math.random() - 0.5) * 1.2; p.vy = (Math.random() - 0.5) * 1.2;
      p.g = 0; p.drag = 0.98;
      p.life = 0; p.max = 22 + Math.random() * 10;
      p.size = 2 + Math.random() * 2.5;
      p.rot = Math.random() * Math.PI; p.vr = 0.2;
      p.color = "#FFC24B"; p.shape = 2; // star
    }
    ensureLoop();
  }

  // Full-screen confetti rain from the top.
  function confetti() {
    const n = 160;
    for (let i = 0; i < n; i++) {
      const p = obtain();
      p.active = true;
      p.x = Math.random() * W;
      p.y = -20 - Math.random() * H * 0.4;
      p.vx = (Math.random() - 0.5) * 4;
      p.vy = 2 + Math.random() * 4;
      p.g = 0.06 + Math.random() * 0.05; p.drag = 1;
      p.life = 0; p.max = 120 + Math.random() * 80;
      p.size = 5 + Math.random() * 6;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 0.3;
      p.color = COLORS[(Math.random() * COLORS.length) | 0];
      p.shape = 1; // rect
    }
    ensureLoop();
  }

  /* ---------- main loop ---------- */
  function tick() {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = pool[i];
      if (!p.active) continue;
      p.life++;
      if (p.life >= p.max || p.y > H + 40) { p.active = false; continue; }
      alive++;
      // integrate
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      const fade = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, fade * 1.6));
      ctx.fillStyle = p.color;
      if (p.shape === 1) {
        // rotating rectangle (confetti)
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      } else if (p.shape === 2) {
        // 4-point star (sparkle)
        drawStar(p.x, p.y, p.size, p.rot);
      } else {
        // circle (dust)
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (alive > 0) { requestAnimationFrame(tick); }
    else { running = false; ctx.clearRect(0, 0, W, H); }
  }

  function drawStar(x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.4;
      const a = (Math.PI / 4) * i;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  AP.effects = { init, burst, sparkle, confetti };
})(window.AP = window.AP || {});
