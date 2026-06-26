/* ===================================================================
   script.js — Core game: state, persistence, board generation,
   rendering, input, move resolution, undo, hint, hearts, level flow.

   MODEL: the board is an N×N grid, filled by ARROW PIECES of varying
   length (1–4 cells). Each piece is a straight run of cells with a head
   pointing up/down/left/right. Tapping a piece slides the whole arrow off
   the board in its head direction — but only if every cell ahead of the
   head is empty. Pieces are drawn as free-floating line-art (no boxes).

   Rendering:
     • Guide Mode draws an optional blueprint grid behind the arrows.
     • Each piece is an absolutely-positioned <button> over its cells,
       containing a single SVG line+chevron. 1 viewBox unit == 1 cell, so
       stroke width is consistent across all arrow lengths.
     • Removal/return are GPU-friendly CSS transforms (translate+scale+fade).

   Solvability:
     • Boards are built by reverse construction — each piece is placed so
       its exit path is clear of the pieces that will outlive it. Replaying
       that order backwards always clears the board, so every generated
       board is guaranteed solvable.
   =================================================================== */
(function (AP) {
  "use strict";

  /* ---------- small utilities ---------- */

  // Seedable PRNG (mulberry32) — deterministic puzzle per level.
  function makeRNG(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DIRS = {
    up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 },
  };
  const OPP = { up: "down", down: "up", left: "right", right: "left" };
  const PERP = { up: ["left", "right"], down: ["left", "right"], left: ["up", "down"], right: ["up", "down"] };
  const DIR_NAMES = ["up", "down", "left", "right"];

  function shuf(a, rng) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function unit(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }

  /* ===================================================================
     Persistence — reads / writes go through AP.Player (which uses
     AP.SaveManager under the hood). No direct localStorage access here.
     =================================================================== */
  const Player = AP.Player;

  // Apply current settings to DOM + audio + effects, then persist.
  function applySettings() {
    const s = Player.settings;
    const root = document.documentElement;
    root.dataset.theme = s.dark ? "dark" : "light";
    root.dataset.contrast = s.contrast ? "high" : "normal";
    root.dataset.colorblind = s.colorblind ? "on" : "off";
    root.dataset.guide = s.guide ? "on" : "off";
    AP.audio.setSound(s.sound);
    AP.audio.setMusic(s.music);
    Player.save();
  }
  AP.applySettings = applySettings;

  function resetProgress() {
    Player.reset();
    applySettings();
    AP.ui.renderStats();
  }
  AP.resetProgress = resetProgress;

  /* ===================================================================
     Board generation (variable-length arrows, reverse construction)
     =================================================================== */

  // Random snake length in [2..maxLen], capped by board size.
  function snakeLen(maxLen, N, rng) {
    const hi = Math.min(maxLen, N);
    if (hi <= 2) return Math.max(1, hi);
    return 2 + ((rng() * (hi - 1)) | 0);
  }

  // Fill a region (mask = Set of r*N+c cells) 100% with solvable snakes.
  //
  // Onion-peel construction in removal order: repeatedly take a cell that can
  // currently exit (a clear straight lane to the board edge through cells NOT
  // in the region-yet-to-place), make it a snake head, and grow the body
  // backward through the remaining region. The top-most remaining cell can
  // ALWAYS exit upward, so this never stalls and consumes every cell. Because
  // a head's exit lane is empty of remaining cells, the body can never grow
  // into it — so each snake can cleanly slither out along its own shape, and
  // replaying the peel order backwards clears the board (guaranteed solvable).
  function generate(N, mask, rng, maxLen, turnProb) {
    maxLen = maxLen || 6;
    if (turnProb === undefined) turnProb = 0.66;
    const present = new Set(mask);
    const occ = Array.from({ length: N }, () => Array(N).fill(null));
    const pieces = [];
    let id = 0;

    const exitClear = (r, c, d) => {
      const dv = DIRS[d];
      let rr = r + dv.dr, cc = c + dv.dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
        if (present.has(rr * N + cc)) return false;
        rr += dv.dr; cc += dv.dc;
      }
      return true;
    };

    while (present.size) {
      // every remaining cell that can exit in some direction (always non-empty)
      const heads = [];
      for (const key of present) {
        const r = (key / N) | 0, c = key % N;
        for (let i = 0; i < 4; i++) if (exitClear(r, c, DIR_NAMES[i])) heads.push([r, c, DIR_NAMES[i]]);
      }
      const [hr, hc, d] = heads[(rng() * heads.length) | 0];

      const cells = [[hr, hc]];
      present.delete(hr * N + hc);
      let curr = [hr, hc], prevDir = OPP[d];
      const L = snakeLen(maxLen, N, rng);
      for (let step = 1; step < L; step++) {
        let dirsToTry;
        if (step === 1) dirsToTry = [OPP[d]];                 // first body cell sits behind the head (makes the arrowhead)
        else { const perp = shuf(PERP[prevDir], rng); dirsToTry = rng() < turnProb ? perp.concat(prevDir) : [prevDir].concat(perp); }
        let placed = false;
        for (const nd of dirsToTry) {
          const nv = DIRS[nd], nr = curr[0] + nv.dr, nc = curr[1] + nv.dc, k = nr * N + nc;
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
          if (!present.has(k)) continue; // grow only through cells still in the region
          present.delete(k);
          cells.push([nr, nc]); curr = [nr, nc]; prevDir = nd; placed = true; break;
        }
        if (!placed) break; // boxed in → snake ends here
      }
      for (const [r, c] of cells) occ[r][c] = id;
      pieces.push(finalize({ id, dir: d, len: cells.length, head: [hr, hc], cells }));
      id++;
    }
    return { occ, pieces };
  }

  // Compute bounding box + tail for a piece (cells are head-first).
  function finalize(p) {
    let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
    for (const [r, c] of p.cells) { r0 = Math.min(r0, r); c0 = Math.min(c0, c); r1 = Math.max(r1, r); c1 = Math.max(c1, c); }
    p.r0 = r0; p.c0 = c0; p.r1 = r1; p.c1 = c1;
    p.tail = p.cells[p.cells.length - 1];
    return p;
  }

  /* ===================================================================
     Game instance
     =================================================================== */
  const game = {
    N: 5, level: 1,
    occ: [],                 // occ[r][c] = pieceId | null
    pieces: new Map(),       // id -> piece
    arrowEls: new Map(),     // id -> DOM button
    fxSvg: null,             // board-sized overlay SVG for slither animation
    fxMeasure: null,         // hidden path used for arc-length measuring
    guideSvg: null,          // blueprint grid overlay (below the arrows)
    guideHl: null,           // <g> holding the selection row/column highlight
    mask: null,              // Set of cell keys forming this level's shape
    remaining: 0,            // pieces left
    moves: 0,                // successful removals this level
    hintsLeft: 3,
    hearts: 3,               // lives left this attempt
    maxHearts: 3,
    undoStack: [],
    usedHintThisLevel: false,
    usedUndoThisLevel: false,
    won: false,
    dead: false,             // out of hearts
    startTime: 0,
    accumPlayStart: 0,
    boardEl: null,
    busy: false,
  };

  const EASE_IN = "cubic-bezier(0.45, 0, 0.9, 0.55)";
  const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

  /* ---------- SVG paths for a piece (1 viewBox unit == 1 cell) ---------- */

  // Smooth polyline through cell centres with rounded corners (radius r).
  function roundedPath(pts, r) {
    const f = (n) => n.toFixed(3);
    if (pts.length === 1) return "";
    let d = "M" + f(pts[0].x) + " " + f(pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const v1 = unit(p0.x - p1.x, p0.y - p1.y);
      const v2 = unit(p2.x - p1.x, p2.y - p1.y);
      const a = { x: p1.x + v1.x * r, y: p1.y + v1.y * r };
      const b = { x: p1.x + v2.x * r, y: p1.y + v2.y * r };
      d += " L" + f(a.x) + " " + f(a.y) + " Q" + f(p1.x) + " " + f(p1.y) + " " + f(b.x) + " " + f(b.y);
    }
    const last = pts[pts.length - 1];
    d += " L" + f(last.x) + " " + f(last.y);
    return d;
  }

  // Returns { shaft, head, hit }: a thick bar following the path (the solid
  // arrow body), a filled triangular arrowhead, and a wide transparent "hit"
  // path that follows the snake for accurate tapping even when bounding boxes
  // of neighbouring pieces overlap.
  function buildPaths(p) {
    const ctr = ([r, c]) => ({ x: c - p.c0 + 0.5, y: r - p.r0 + 0.5 });
    const pts = p.cells.slice().reverse().map(ctr); // tail -> head
    const v = DIRS[p.dir], ux = v.dc, uy = v.dr, px = -uy, py = ux;
    const head = pts[pts.length - 1];
    const f = (n) => n.toFixed(3);

    // thick bar (shaft) from tail to head centre
    let shaft;
    if (pts.length === 1) {
      const s = { x: head.x - ux * 0.20, y: head.y - uy * 0.20 };
      shaft = "M" + f(s.x) + " " + f(s.y) + " L" + f(head.x) + " " + f(head.y);
    } else {
      shaft = roundedPath(pts, 0.28);
    }

    // solid triangular arrowhead pointing in the head direction
    const tip = { x: head.x + ux * 0.46, y: head.y + uy * 0.46 };
    const b1 = { x: head.x - ux * 0.06 + px * 0.34, y: head.y - uy * 0.06 + py * 0.34 };
    const b2 = { x: head.x - ux * 0.06 - px * 0.34, y: head.y - uy * 0.06 - py * 0.34 };
    const headD = "M" + f(b1.x) + " " + f(b1.y) + " L" + f(tip.x) + " " + f(tip.y) + " L" + f(b2.x) + " " + f(b2.y) + " Z";

    const hit = pts.length === 1 ? "M" + f(head.x) + " " + f(head.y) + " l 0.01 0" : shaft;
    return { shaft, head: headD, hit };
  }

  function positionArrow(el, p) {
    const cell = 100 / game.N;
    el.style.left = (p.c0 * cell) + "%";
    el.style.top = (p.r0 * cell) + "%";
    el.style.width = ((p.c1 - p.c0 + 1) * cell) + "%";
    el.style.height = ((p.r1 - p.r0 + 1) * cell) + "%";
  }

  function makeArrowEl(p) {
    const cols = p.c1 - p.c0 + 1, rows = p.r1 - p.r0 + 1;
    const { shaft, head, hit } = buildPaths(p);
    const btn = document.createElement("button");
    btn.className = "arrow";
    btn.dataset.id = p.id;
    btn.dataset.skin = Player.cosmetics.arrowSkin;
    btn.setAttribute("aria-label", "Arrow pointing " + p.dir + ", length " + p.len);
    positionArrow(btn, p);
    // colorblind helper letter at the head
    const hcx = (p.head[1] - p.c0 + 0.5) / cols * 100, hcy = (p.head[0] - p.r0 + 0.5) / rows * 100;
    btn.innerHTML =
      '<svg viewBox="0 0 ' + cols + ' ' + rows + '">' +
        '<path class="hit" d="' + hit + '"/>' +
        '<path class="shaft" d="' + shaft + '"/>' +
        '<path class="head" d="' + head + '"/>' +
      '</svg>' +
      '<span class="cb" style="left:' + hcx + '%;top:' + hcy + '%">' + p.dir[0].toUpperCase() + '</span>';
    return btn;
  }

  /* ---------- board build ---------- */
  const SVGNS = "http://www.w3.org/2000/svg";

  function buildBoard(N) {
    const board = game.boardEl;
    board.style.setProperty("--n", N);
    board.innerHTML = "";
    game.arrowEls = new Map();

    // 1) Guide grid (blueprint overlay) — sits BELOW the arrows.
    buildGuide(N);

    // 2) Arrow pieces (solid line-art)
    let i = 0;
    for (const p of game.pieces.values()) {
      const el = makeArrowEl(p);
      el.classList.add("enter");
      el.style.animationDelay = ((i++ % 24) * 14) + "ms";
      setTimeout(((e) => () => e.classList.remove("enter"))(el), 700);
      game.arrowEls.set(p.id, el);
      board.appendChild(el);
    }

    // 3) Board-sized overlay SVG on top: the slither-off animation only.
    //    1 user unit == 1 cell, overflow visible so paths can glide off-board.
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "board-fx");
    svg.setAttribute("viewBox", "0 0 " + N + " " + N);
    const meas = document.createElementNS(SVGNS, "path"); // hidden, for arc-length measuring
    meas.setAttribute("class", "measure");
    svg.appendChild(meas);
    game.fxSvg = svg;
    game.fxMeasure = meas;
    board.appendChild(svg);
  }

  /* ---------- Guide Grid (Blueprint Dots and Lines) ---------- */
  // Built once per board (cached as static DOM) to outline the shape of the puzzle level.
  function buildGuide(N) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "guide");
    svg.setAttribute("viewBox", "0 0 " + N + " " + N);
    svg.setAttribute("aria-hidden", "true");

    const mask = game.mask;
    
    // 1) Grid lines (rect outlines) for each cell in the shape
    const lines = document.createElementNS(SVGNS, "g");
    lines.setAttribute("class", "guide-lines");
    
    // 2) A dot at the centre of each cell that belongs to the shape
    const dots = document.createElementNS(SVGNS, "g");
    dots.setAttribute("class", "guide-dots");
    
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (mask && !mask.has(r * N + c)) continue;
        
        // Add grid box outline
        const rect = document.createElementNS(SVGNS, "rect");
        rect.setAttribute("x", c);
        rect.setAttribute("y", r);
        rect.setAttribute("width", 1);
        rect.setAttribute("height", 1);
        lines.appendChild(rect);
        
        // Add center dot
        const dot = document.createElementNS(SVGNS, "circle");
        dot.setAttribute("cx", c + 0.5); 
        dot.setAttribute("cy", r + 0.5); 
        dot.setAttribute("r", 0.04);
        dots.appendChild(dot);
      }
    }
    
    svg.appendChild(lines);
    svg.appendChild(dots);

    game.guideSvg = svg;
    game.boardEl.appendChild(svg);
  }

  /* ---------- slither animation (path glides along its own shape) ---------- */
  // Builds the full travel track = the path's centreline + a straight
  // extension off the board in the head direction, then slides a window the
  // length of the path along it via stroke-dashoffset. mode 'out' exits the
  // board; mode 'in' (undo) reverses it.
  function slither(p, mode, done) {
    const N = game.N;
    const dv = DIRS[p.dir];
    const bodyPts = p.cells.slice().reverse().map(([r, c]) => ({ x: c + 0.5, y: r + 0.5 })); // tail -> head
    const E = N + p.len + 2;
    const head = bodyPts[bodyPts.length - 1];
    const trackPts = bodyPts.concat([{ x: head.x + dv.dc * E, y: head.y + dv.dr * E }]);
    const bodyD = roundedPath(bodyPts, 0.28);
    const trackD = roundedPath(trackPts, 0.28);

    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("class", "exit");
    path.setAttribute("d", trackD);
    game.fxSvg.appendChild(path);

    game.fxMeasure.setAttribute("d", bodyD || ("M" + head.x + " " + head.y + " l 0.01 0"));
    const Lvis = Math.max(0.2, game.fxMeasure.getTotalLength());
    const total = path.getTotalLength();
    const off = total - Lvis;                  // distance to push the window fully off-board
    const dur = Math.min(460, 250 + p.len * 30);

    path.style.strokeDasharray = Lvis + " " + (total + 10);
    path.style.strokeDashoffset = (mode === "out" ? 0 : -off);
    path.style.opacity = mode === "out" ? "1" : "0";
    void path.getBoundingClientRect();         // commit start state
    if (mode === "out") {
      path.style.transition = "stroke-dashoffset " + dur + "ms " + EASE_IN + ", opacity " + Math.round(dur * 0.5) + "ms linear " + Math.round(dur * 0.5) + "ms";
      path.style.strokeDashoffset = -off;
      path.style.opacity = "0";
    } else {
      path.style.transition = "stroke-dashoffset " + dur + "ms " + EASE_OUT + ", opacity 120ms linear";
      path.style.strokeDashoffset = 0;
      path.style.opacity = "1";
    }
    setTimeout(() => { path.remove(); if (done) done(); }, dur + 40);
  }

  /* ---------- rules ---------- */

  // Can this path slide off right now? It slithers out head-first along its
  // own shape, so the body just retraces the head's vacated track — only the
  // HEAD's straight exit lane needs to be clear of OTHER paths.
  function isRemovable(p) {
    const { dr, dc } = DIRS[p.dir];
    const N = game.N;
    const own = new Set(p.cells.map(([r, c]) => r * N + c));
    let rr = p.head[0] + dr, cc = p.head[1] + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
      if (game.occ[rr][cc] !== null && !own.has(rr * N + cc)) return false;
      rr += dr; cc += dc;
    }
    return true;
  }
  function hasAnyMove() {
    for (const p of game.pieces.values()) if (isRemovable(p)) return true;
    return false;
  }
  function findRemovable() {
    const list = [];
    for (const p of game.pieces.values()) if (isRemovable(p)) list.push(p);
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  }

  /* ---------- tapping ---------- */
  function tap(id) {
    if (game.busy || game.dead) return;
    const p = game.pieces.get(id);
    if (!p) return;
    if (isRemovable(p)) removePiece(p);
    else invalidPiece(p);
  }

  function snapshot(p) { return { id: p.id, dir: p.dir, len: p.len, head: p.head.slice(), cells: p.cells.map((c) => c.slice()) }; }

  // Clear the red "blocked" marking from every arrow (after a correct move).
  function clearWrong() {
    game.boardEl.querySelectorAll(".arrow.wrong").forEach((e) => e.classList.remove("wrong"));
  }

  function removePiece(p) {
    const el = game.arrowEls.get(p.id);
    clearWrong();           // a correct move resets the blocked/red arrows
    AP.audio.play("remove");

    // particle burst at the head's exit point
    const br = game.boardEl.getBoundingClientRect(), cs = br.width / game.N;
    AP.effects.burst(br.left + (p.head[1] + 0.5) * cs, br.top + (p.head[0] + 0.5) * cs, { count: Math.min(16, 6 + p.len * 2) });

    // record undo, then update the model immediately (other paths stay tappable)
    game.undoStack.push(snapshot(p));
    for (const [r, c] of p.cells) game.occ[r][c] = null;
    game.pieces.delete(p.id);
    game.remaining--;
    game.moves++;
    Player.statistics.totalMoves++;
    AP.ui.setRemaining(game.remaining);
    AP.ui.setUndoEnabled(game.undoStack.length > 0);
    
    // Milestone popup trigger
    const pct = (game.initialPiecesCount - game.remaining) / game.initialPiecesCount;
    let milestone = null;
    if (pct >= 1.0) milestone = 100;
    else if (pct >= 0.75) milestone = 75;
    else if (pct >= 0.50) milestone = 50;
    else if (pct >= 0.25) milestone = 25;

    if (milestone && !game.triggeredMilestones.has(milestone)) {
      game.triggeredMilestones.add(milestone);
      AP.ui.showMilestone(milestone);
    }

    saveProgress();         // persist for resume-after-exit

    // hide the static path, slither the line off the board along its own shape
    if (el) el.style.display = "none";
    slither(p, "out", () => {
      if (el) el.remove();
      game.arrowEls.delete(p.id);
      afterMove();
    });
  }

  function invalidPiece(p) {
    const el = game.arrowEls.get(p.id);
    AP.audio.play("invalid");
    if (navigator.vibrate) navigator.vibrate(20);

    // Count the clear cells ahead of the head before the blocking arrow, so the
    // piece travels that whole distance, slams into the blocker, then recoils.
    const N = game.N, { dr, dc } = DIRS[p.dir];
    const own = new Set(p.cells.map(([r, c]) => r * N + c));
    let rr = p.head[0] + dr, cc = p.head[1] + dc, gap = 0, blockerId = null;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
      const id = game.occ[rr][cc];
      if (id !== null && !own.has(rr * N + cc)) { blockerId = id; break; }
      gap++; rr += dr; cc += dc;
    }

    // flash the arrow that's doing the blocking, so the player sees the culprit
    if (blockerId !== null) {
      const bel = game.arrowEls.get(blockerId);
      if (bel) { bel.classList.remove("blocker-blink"); void bel.offsetWidth; bel.classList.add("blocker-blink"); setTimeout(() => bel.classList.remove("blocker-blink"), 520); }
    }

    const cs = game.boardEl.clientWidth / N;
    const lurch = (gap >= 1 ? gap : 0.28) * cs;   // travel the real distance (min nudge when flush)
    const dur = Math.min(640, 300 + gap * 70);    // longer trips take a touch longer
    el.style.setProperty("--nx", (dc * lurch) + "px");
    el.style.setProperty("--ny", (dr * lurch) + "px");
    el.style.animationDuration = dur + "ms";
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    setTimeout(() => { el.classList.remove("bump"); el.style.animationDuration = ""; }, dur + 40);

    // turn red until the next correct move; only the first wrong tap on a
    // given arrow (since the last good move) costs a heart
    if (!el.classList.contains("wrong")) {
      el.classList.add("wrong");
      game.wrongTaps = (game.wrongTaps || 0) + 1;
      Player.recordWrongTap();
      loseHeart();
    }
  }

  function loseHeart() {
    if (game.dead) return;
    game.hearts = Math.max(0, game.hearts - 1);
    AP.ui.setHearts(game.hearts, game.maxHearts);
    if (game.hearts <= 0) { onGameOver(); return; }
    saveProgress();
  }

  function onGameOver() {
    game.dead = true;
    Player.breakStreak();
    clearProgress();        // failed run — start fresh next time
    setTimeout(() => AP.ui.openPopup("popup-gameover"), 380);
  }

  function afterMove() {
    if (game.pieces.size === 0) { onVictory(); return; }
    if (!hasAnyMove()) onNoMoves();
  }

  /* ---------- undo ---------- */
  function undo() {
    if (game.busy || game.dead || !game.undoStack.length) return;
    AP.audio.play("button");
    clearWrong();
    const snap = game.undoStack.pop();
    const p = finalize({ id: snap.id, dir: snap.dir, len: snap.len, head: snap.head.slice(), cells: snap.cells.map((c) => c.slice()) });
    for (const [r, c] of p.cells) game.occ[r][c] = p.id;
    game.pieces.set(p.id, p);
    game.remaining++;
    game.moves = Math.max(0, game.moves - 1);
    if (Player.statistics.totalMoves > 0) Player.statistics.totalMoves--;
    game.usedUndoThisLevel = true;
    game.won = false;
    AP.ui.setRemaining(game.remaining);
    AP.ui.setUndoEnabled(game.undoStack.length > 0);

    // Revert milestones if player undoes past the threshold
    const currentPct = (game.initialPiecesCount - game.remaining) / game.initialPiecesCount;
    if (currentPct < 0.25) game.triggeredMilestones.delete(25);
    if (currentPct < 0.50) game.triggeredMilestones.delete(50);
    if (currentPct < 0.75) game.triggeredMilestones.delete(75);
    if (currentPct < 1.0) game.triggeredMilestones.delete(100);

    // create the static path hidden, slither it back in, then reveal it
    const el = makeArrowEl(p);
    el.classList.remove("enter");
    el.style.display = "none";
    game.arrowEls.set(p.id, el);
    game.boardEl.appendChild(el);
    slither(p, "in", () => { if (game.arrowEls.get(p.id) === el) el.style.display = ""; });
    saveProgress();
  }

  /* ---------- hint ---------- */
  function hint() {
    if (game.busy) return;
    if (game.hintsLeft <= 0) { AP.ui.toast("No hints left"); AP.audio.play("invalid"); return; }
    const p = findRemovable();
    if (!p) { AP.ui.toast("No free moves — try Restart"); return; }
    AP.audio.play("button");
    game.hintsLeft--;
    Player.inventory.hints = game.hintsLeft;
    game.usedHintThisLevel = true;
    Player.recordHintUsed();
    AP.ui.setHintCount(game.hintsLeft);
    saveProgress();
    const el = game.arrowEls.get(p.id);
    el.classList.add("hint");
    const rect = el.getBoundingClientRect();
    AP.effects.sparkle(rect.left + rect.width / 2, rect.top + rect.height / 2);
    setTimeout(() => el.classList.remove("hint"), 1700);
  }

  /* ---------- save / resume ---------- */
  function clonePieceData(s) { return { id: s.id, dir: s.dir, len: s.len, head: s.head.slice(), cells: s.cells.map((c) => c.slice()) }; }
  function occFromPieces(pieces, N) {
    const occ = Array.from({ length: N }, () => Array(N).fill(null));
    for (const p of pieces) for (const [r, c] of p.cells) occ[r][c] = p.id;
    return occ;
  }

  // Persist the current half-finished level so it can be resumed after exit.
  function saveProgress() {
    if (game.won || game.dead) return;
    const pieces = [];
    for (const p of game.pieces.values()) pieces.push(clonePieceData(p));
    Player.session.inProgress = {
      level: game.level,
      pieces,
      undoStack: game.undoStack.map(clonePieceData),
      hearts: game.hearts,
      maxHearts: game.maxHearts,
      hintsLeft: game.hintsLeft,
      moves: game.moves,
      usedHint: game.usedHintThisLevel, usedUndo: game.usedUndoThisLevel,
      wrongTaps: game.wrongTaps,
      elapsed: Date.now() - game.startTime,
    };
    Player.save();
  }
  function clearProgress() { Player.session.inProgress = null; Player.save(); }

  /* ---------- level lifecycle ---------- */
  function loadLevel(level, resume) {
    const cfg = AP.levels.getConfig(level);
    const ip = resume && Player.session.inProgress && Player.session.inProgress.level === level ? Player.session.inProgress : null;

    game.level = level;
    game.N = cfg.size;
    game.maxHearts = cfg.hearts;
    game.won = false;
    game.dead = false;
    game.mask = AP.levels.buildMask(cfg.shape, cfg.size);

    game.triggeredMilestones = new Set();

    if (ip) {
      // resume the half-finished board
      const pieces = ip.pieces.map((s) => finalize(clonePieceData(s)));
      game.pieces = new Map(pieces.map((p) => [p.id, p]));
      game.occ = occFromPieces(pieces, cfg.size);
      game.undoStack = ip.undoStack.map(clonePieceData);
      game.hintsLeft = ip.hintsLeft !== undefined ? ip.hintsLeft : Player.inventory.hints;
      game.hearts = ip.hearts;
      game.maxHearts = ip.maxHearts || cfg.hearts;
      game.moves = ip.moves;
      game.usedHintThisLevel = ip.usedHint;
      game.usedUndoThisLevel = ip.usedUndo;
      game.wrongTaps = ip.wrongTaps || 0;
      game.remaining = pieces.length;
      game.initialPiecesCount = pieces.length + (ip.moves || 0);

      // Seed triggered milestones based on current progress
      const currentPct = (game.initialPiecesCount - game.remaining) / game.initialPiecesCount;
      if (currentPct >= 0.25) game.triggeredMilestones.add(25);
      if (currentPct >= 0.50) game.triggeredMilestones.add(50);
      if (currentPct >= 0.75) game.triggeredMilestones.add(75);
      if (currentPct >= 1.0) game.triggeredMilestones.add(100);

      game.startTime = Date.now() - (ip.elapsed || 0);
    } else {
      // fresh deterministic board
      const { occ, pieces } = generate(cfg.size, game.mask, makeRNG(cfg.seed), cfg.maxLen, cfg.turnProb);
      game.occ = occ;
      game.pieces = new Map(pieces.map((p) => [p.id, p]));
      game.undoStack = [];
      game.hintsLeft = Player.inventory.hints;
      game.hearts = cfg.hearts;

      // consume extra heart if available
      if (Player.inventory && Player.inventory.extraHearts > 0 && game.hearts < 5) {
        Player.inventory.extraHearts--;
        game.hearts++;
        game.maxHearts = game.hearts;
        Player.save();
      }

      game.moves = 0;
      game.usedHintThisLevel = false;
      game.usedUndoThisLevel = false;
      game.wrongTaps = 0;
      game.remaining = pieces.length;
      game.initialPiecesCount = pieces.length;
      game.startTime = Date.now();
    }

    buildBoard(cfg.size);
    AP.ui.setLevelLabel(level);
    AP.ui.setRemaining(game.remaining);
    AP.ui.setHintCount(game.hintsLeft);
    AP.ui.setHearts(game.hearts, game.maxHearts);
    AP.ui.setUndoEnabled(game.undoStack.length > 0);

    // Zoom: reset state and show button only for large boards
    AP.ui.resetZoom();
    AP.ui.setZoomVisible(cfg.size >= 10);

    // Sync guide button active state
    AP.ui.refreshGuideButton();

    saveProgress();
  }

  function startLevel(level) {
    const target = Math.min(level, Player.story.highestUnlocked);
    Player.setCurrentLevel(target);
    AP.ui.closeAllPopups();
    const resume = !!(Player.session.inProgress && Player.session.inProgress.level === target);
    loadLevel(target, resume);
    AP.ui.showScreen("screen-game");
    game.accumPlayStart = Date.now();
  }
  function restart() {
    Player.recordRestart();
    AP.ui.closeAllPopups();
    loadLevel(game.level);
  }
  function next() { startLevel(Math.min(game.level + 1, AP.levels.TOTAL_LEVELS + 50)); }
  function toMenu() { accumulatePlayTime(); AP.ui.closeAllPopups(); AP.ui.showScreen("screen-menu"); }

  function accumulatePlayTime() {
    if (game.accumPlayStart) {
      Player.addPlayTime(Date.now() - game.accumPlayStart);
      game.accumPlayStart = 0;
    }
  }

  /* ---------- win / lose ---------- */
  function calculateLevelRewards(level, timeSec, wrongTaps, usedHint, hearts, isReplay) {
    const cfg = AP.levels.getConfig(level);
    const size = cfg.size;

    // 1. Base / Replay Reward
    let difficulty = "Easy";
    let baseReward = 50;
    let replayBase = 10;

    if (level >= 46) {
      difficulty = "Expert";
      baseReward = 150;
      replayBase = 30;
    } else if (level >= 31) {
      difficulty = "Hard";
      baseReward = 100;
      replayBase = 20;
    } else if (level >= 16) {
      difficulty = "Medium";
      baseReward = 75;
      replayBase = 15;
    }

    const baseAmt = isReplay ? replayBase : baseReward;

    // 2. Speed Bonus
    const targetTime = size * 10;
    const veryFast = size * 6;
    const worldClass = size * 4;

    let speedBonus = 0;
    let speedTier = "";
    if (timeSec < worldClass) {
      speedBonus = 75;
      speedTier = "World Class";
    } else if (timeSec < veryFast) {
      speedBonus = 50;
      speedTier = "Very Fast";
    } else if (timeSec < targetTime) {
      speedBonus = 25;
      speedTier = "Under Target Time";
    }

    // 3. Hearts Bonus
    let heartsBonus = 0;
    if (hearts === 3) heartsBonus = 30;
    else if (hearts === 2) heartsBonus = 15;
    else if (hearts === 1) heartsBonus = 5;

    // 4. Accuracy Bonus
    let accuracyBonus = 0;
    if (wrongTaps === 0) accuracyBonus = 30;
    else if (wrongTaps <= 2) accuracyBonus = 15;

    // 5. Hint Bonus
    const hintBonus = usedHint ? 0 : 25;

    // 6. Perfect Clear
    const isPerfect = !usedHint && wrongTaps === 0 && hearts === 3;
    const perfectBonus = isPerfect ? 50 : 0;

    const total = baseAmt + speedBonus + heartsBonus + accuracyBonus + hintBonus + perfectBonus;

    return {
      difficulty,
      isReplay,
      baseName: isReplay ? "Replay Reward" : `${difficulty} Base`,
      baseAmt,
      speedTier,
      speedBonus,
      heartsBonus,
      accuracyBonus,
      hintBonus,
      perfectBonus,
      isPerfect,
      total
    };
  }
  AP.calculateLevelRewards = calculateLevelRewards;

  function onVictory() {
    if (game.won) return;   // guard against concurrent slither callbacks
    game.won = true;
    const elapsed = Math.round((Date.now() - game.startTime) / 1000);
    const penalty = (game.usedHintThisLevel ? 1 : 0) + (game.usedUndoThisLevel ? 1 : 0);
    const stars = Math.max(1, 3 - penalty);

    const isReplay = !!Player.story.completed[game.level];
    const rewards = calculateLevelRewards(game.level, elapsed, game.wrongTaps, game.usedHintThisLevel, game.hearts, isReplay);

    // Update the Player Profile (auto-saves inside completeLevel)
    Player.completeLevel(game.level, { stars, timeSec: elapsed, moves: game.moves }, rewards);

    accumulatePlayTime();
    game.accumPlayStart = Date.now();
    Player.session.inProgress = null; // level finished — nothing to resume
    Player.save();

    if (rewards.isPerfect) {
      AP.audio.play("perfectClear");
    } else {
      AP.audio.play("victory");
    }

    AP.ui.startCelebration({ time: elapsed, moves: game.moves, stars, rewards });

    // smooth outro: a wave of dots blinks across the cleared shape, then the
    // confetti + completion card.
    playOutro(() => {
      if (!AP.ui.isCelebrating()) return; // already skipped
      AP.effects.confetti();
      AP.ui.showVictory({ time: elapsed, moves: game.moves, stars, rewards });
    });
  }

  // Radial blink wave over the just-cleared shape, then run `done`.
  function playOutro(done) {
    const N = game.N, mask = game.mask;
    if (!game.fxSvg) { setTimeout(done, 160); return; }
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "outro");
    const cx = N / 2, cy = N / 2;
    let maxDelay = 0;
    const cells = mask ? [...mask] : Array.from({ length: N * N }, (_, i) => i);
    for (const key of cells) {
      const r = (key / N) | 0, c = key % N;
      const delay = Math.hypot(c + 0.5 - cx, r + 0.5 - cy) * 60; // ripple out from centre
      if (delay > maxDelay) maxDelay = delay;
      const dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("cx", c + 0.5); dot.setAttribute("cy", r + 0.5); dot.setAttribute("r", 0.17);
      dot.setAttribute("class", "outro-dot");
      dot.style.animationDelay = delay.toFixed(0) + "ms";
      g.appendChild(dot);
    }
    game.fxSvg.appendChild(g);
    const outroTimer = setTimeout(() => {
      game.outroTimer = null;
      if (g.parentNode) g.remove();
      done();
    }, maxDelay + 560);
    game.outroTimer = outroTimer;
  }

  function cancelOutro() {
    if (game.outroTimer) {
      clearTimeout(game.outroTimer);
      game.outroTimer = null;
    }
    const outroG = game.boardEl.querySelector(".outro");
    if (outroG) outroG.remove();
  }
  AP.game_internal = { cancelOutro };

  function onNoMoves() { AP.audio.play("popup"); AP.ui.openPopup("popup-nomoves", false); }

  /* ---------- input ---------- */
  function bindBoardInput() {
    const board = game.boardEl;
    board.addEventListener("click", (e) => {
      const el = e.target.closest(".arrow");
      if (!el) return;
      AP.audio.play("tap");
      tap(+el.dataset.id);
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    game.boardEl = document.getElementById("board");
    AP.effects.init(document.getElementById("fx-canvas"));
    AP.ui.init();
    AP.ui.syncSettingsInputs();
    applySettings();
    bindBoardInput();

    const unlock = () => { AP.audio.unlock(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const onHide = () => { accumulatePlayTime(); if (document.getElementById("screen-game").classList.contains("active")) saveProgress(); };
    document.addEventListener("visibilitychange", () => { if (document.hidden) onHide(); else if (document.getElementById("screen-game").classList.contains("active")) game.accumPlayStart = Date.now(); });
    window.addEventListener("pagehide", onHide);

    // Intro Screen -> Splash Screen -> Main Menu sequence
    setTimeout(() => {
      AP.ui.showScreen("screen-splash");
    }, 1400);

    setTimeout(() => {
      AP.ui.showScreen("screen-menu");
    }, 2800);
  }

  AP.game = {
    startLevel, restart, next, toMenu, hint, tap,
    get remaining() { return game.remaining; },
    get pieces() { return game.pieces; }
  };
  AP.makeRNG = makeRNG;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.AP = window.AP || {});
