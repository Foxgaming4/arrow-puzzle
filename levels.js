/* ===================================================================
   levels.js — Level progression + object-shape masks.

   Every level is a fully-packed object made of arrows. Difficulty ramps:
     • the grid (and therefore the arrow count) grows each level, and
     • snakes get shorter at higher levels, so the number of separate
       arrows keeps rising even after the grid size caps out.

   Each level also gets a UNIQUE silhouette, cycling through the shape
   library (box, diamond, circle, heart, star, triangle, hexagon, apple,
   plus). Add a predicate to SHAPES + a name to SHAPE_CYCLE to extend.
   =================================================================== */
(function (AP) {
  "use strict";

  const HINTS_PER_LEVEL = 3;
  const HEARTS = 3;
  const TOTAL_LEVELS = 60;

  // Order tuned so the simplest silhouettes appear on the smallest early grids.
  const SHAPE_CYCLE = ["full", "diamond", "circle", "heart", "star", "triangle", "hexagon", "apple", "plus"];

  // Predicate per shape: true when cell (r,c) of an N×N grid is inside it.
  // x,y are normalised to [-1, 1].
  const SHAPES = {
    full: () => true,
    diamond: (r, c, N) => { const x = ((c + 0.5) / N) * 2 - 1, y = ((r + 0.5) / N) * 2 - 1; return Math.abs(x) + Math.abs(y) <= 1.04; },
    circle: (r, c, N) => { const x = ((c + 0.5) / N) * 2 - 1, y = ((r + 0.5) / N) * 2 - 1; return x * x + y * y <= 1.0; },
    heart: (r, c, N) => {
      const x = (((c + 0.5) / N) * 2 - 1) * 1.35;
      const y = (1 - ((r + 0.5) / N) * 2) * 1.35 + 0.25;
      return Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y <= 0;
    },
    star: (r, c, N) => {
      const x = ((c + 0.5) / N) * 2 - 1, y = ((r + 0.5) / N) * 2 - 1;
      const rho = Math.hypot(x, y);
      if (rho > 1.02) return false;
      const m = (2 * Math.PI) / 5;
      let aa = (((Math.atan2(y, x) - Math.PI / 2) % m) + m) % m;
      const t = Math.abs(aa - m / 2) / (m / 2);
      return rho <= 1.0 * (1 - t) + 0.40 * t;
    },
    triangle: (r, c, N) => { const x = ((c + 0.5) / N) * 2 - 1, yy = (r + 0.5) / N; return Math.abs(x) <= yy * 1.05 && yy >= 0.12; },
    hexagon: (r, c, N) => { const x = ((c + 0.5) / N) * 2 - 1, y = ((r + 0.5) / N) * 2 - 1; return Math.abs(x) <= 0.92 && Math.abs(x) * 0.5 + Math.abs(y) * 0.866 <= 0.9; },
    apple: (r, c, N) => {
      const x = ((c + 0.5) / N) * 2 - 1, y = ((r + 0.5) / N) * 2 - 1;
      const body = (x * x) / (0.93 * 0.93) + ((y - 0.10) * (y - 0.10)) / (0.90 * 0.90) <= 1;
      const dimple = y < -0.45 && Math.abs(x) < 0.17;
      const stem = Math.abs(x - 0.06) < 0.085 && y < -0.4 && y > -0.92;
      return (body && !dimple) || stem;
    },
    plus: (r, c, N) => { const x = ((c + 0.5) / N) * 2 - 1, y = ((r + 0.5) / N) * 2 - 1; return Math.abs(x) <= 0.34 || Math.abs(y) <= 0.34; },
  };

  // Set of cell keys (r*N+c) for a shape; falls back to full if too small.
  function buildMask(shape, N) {
    const fn = SHAPES[shape] || SHAPES.full;
    const set = new Set();
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (fn(r, c, N)) set.add(r * N + c);
    if (set.size < 8) for (let i = 0; i < N * N; i++) set.add(i);
    return set;
  }

  /**
   * Config for a level (1-based).
   * @returns {{level,size,shape,seed,hints,hearts,maxLen,turnProb}}
   */
  function getConfig(level) {
    level = Math.max(1, Math.floor(level));
    
    let size;
    let turnProb;
    let maxLen;
    
    if (level <= 10) {
      // Early Levels (1-10)
      size = level <= 5 ? 4 : 5;
      maxLen = 2;       // Short paths
      turnProb = 0.0;   // No winding, all straight
    } else if (level <= 30) {
      // Medium Levels (11-30)
      size = level <= 20 ? 6 : 7;
      maxLen = level <= 20 ? 3 : 4;
      turnProb = 0.25;  // Occasional turns
    } else if (level <= 60) {
      // Advanced Levels (31-60)
      size = level <= 45 ? 8 : 9;
      maxLen = 5;       // Winding paths
      turnProb = 0.6;   // High turns
    } else {
      // Expert Levels (61+)
      size = 10;        // Capped at 10 to fit well on mobile/desktop
      maxLen = 6;
      turnProb = 0.8;   // Intertwined paths
    }

    const shape = SHAPE_CYCLE[(level - 1) % SHAPE_CYCLE.length];
    const seed = (level * 2654435761) >>> 0;
    return { level, size, shape, seed, hints: HINTS_PER_LEVEL, hearts: HEARTS, maxLen, turnProb };
  }

  AP.levels = { getConfig, buildMask, TOTAL_LEVELS, HINTS_PER_LEVEL, HEARTS, SHAPES };
})(window.AP = window.AP || {});
