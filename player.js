/* ===================================================================
   player.js — The unified Player Profile (the single source of truth).

   Every piece of player progress lives inside ONE serializable object so
   that future systems (Coins, Shop, Daily Challenge, Google Login, Cloud
   Save, Leaderboards, Cosmetics, Achievements) can read/write/upload it
   without touching the game logic.

   Shape of the save blob (all plain JSON — no DOM nodes, dates, Maps, Sets,
   so it can be POSTed to a cloud DB verbatim):

     {
       saveVersion: 1,
       profile: {
         story:       { highestUnlocked, current, completed, perfect,
                        stars, bestTime, bestMoves },
         statistics:  { levelsCompleted, totalPlayMs, totalMoves, wrongTaps,
                        hintsUsed, restarts, perfectClears, currentStreak,
                        longestStreak, bestTime, clearCount, totalClearSec },
         resources:   { coins, gems, keys },
         inventory:   { hints, extraHearts, undo, boosters },
         cosmetics:   { arrowSkin, boardTheme, background, particleStyle,
                        unlocked: { arrowSkin, boardTheme, background,
                                    particleStyle } },
         settings:    { sound, music, guide, dark, contrast,
                        reducedMotion, colorblind }
       },
       session:       { inProgress }   // device-local resume snapshot
     }

   Persistence rules:
     • Reads/writes go ONLY through AP.SaveManager (player never touches
       localStorage directly).
     • Loading is corruption-proof: any missing / malformed / partial field
       is rebuilt from defaults via normalize(), so the game never crashes
       on bad data and old saves are never wiped.
     • saveVersion drives forward migration (MIGRATIONS map). Player progress
       is upgraded in place, never deleted.

   Convenience: AP.Player exposes live shortcuts (`.story`, `.statistics`,
   `.settings`, `.resources`, `.inventory`, `.cosmetics`, `.session`) plus
   semantic mutators that update + auto-save in one call.
   =================================================================== */
(function (AP) {
  "use strict";

  const SM = AP.SaveManager;
  const SAVE_VERSION = SM.SAVE_VERSION;

  /* ---------- environment-derived setting defaults ---------- */
  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  /* ---------- fresh defaults (a brand-new player) ---------- */
  // Built fresh on every call so nothing shares object references.
  function defaultData() {
    return {
      saveVersion: SAVE_VERSION,
      profile: {
        story: {
          highestUnlocked: 1,  // highest level the player may enter
          current: 1,          // level the "Play" button resumes
          completed: {},       // { [level]: true }  — ever cleared
          perfect: {},         // { [level]: true }  — cleared with 3 stars
          stars: {},           // { [level]: 1 | 2 | 3 } — best rating
          bestTime: {},        // { [level]: seconds } — best completion time
          bestMoves: {},       // { [level]: count }   — best move count
          rewardsClaimed: {},  // { [level]: "first" | "replay" }
        },
        statistics: {
          levelsCompleted: 0,  // distinct levels first-cleared
          totalPlayMs: 0,      // cumulative time on the game screen
          totalMoves: 0,       // successful arrow removals
          wrongTaps: 0,        // blocked taps
          hintsUsed: 0,
          restarts: 0,
          perfectClears: 0,    // perfect clears count
          currentStreak: 0,    // consecutive wins without a game-over
          longestStreak: 0,
          bestTime: 0,         // fastest single clear, seconds (0 = none)
          clearCount: 0,       // total victories (for average time)
          totalClearSec: 0,    // sum of clear times (for average time)
          lifetimeCoinsEarned: 0,
          highestSingleReward: 0,
          averageCoinsPerLevel: 0,
          fastFinishes: 0,
          noHintClears: 0,
          coinsSpent: 0,
          coinsEarnedThisSession: 0,
        },
        // Future currencies — structure exists now, values stay zero.
        resources: { coins: 0, gems: 0, keys: 0 },
        // Future consumables — structure exists now, values stay zero.
        inventory: { hints: 3, extraHearts: 0, undo: 0, boosters: 0 },
        // Only the Default cosmetic is owned/equipped to begin with.
        cosmetics: {
          arrowSkin: "default",
          boardTheme: "default",
          background: "default",
          particleStyle: "default",
          unlocked: {
            arrowSkin: ["default"],
            boardTheme: ["default"],
            background: ["default"],
            particleStyle: ["default"],
          },
        },
        settings: {
          sound: true,
          music: false,
          guide: false,
          dark: prefersDark(),
          contrast: false,
          colorblind: false,
        },
      },
      session: {
        inProgress: null, // half-finished level snapshot (device-local resume)
      },
    };
  }

  /* ---------- tiny typed coercers (corruption recovery primitives) ---------- */
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function int(v, d) { return typeof v === "number" && isFinite(v) ? Math.floor(v) : d; }
  function bool(v, d) { return typeof v === "boolean" ? v : d; }
  function str(v, d) { return typeof v === "string" ? v : d; }
  function plainMap(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function strArr(v, d) {
    if (!Array.isArray(v)) return d.slice();
    const out = v.filter((x) => typeof x === "string");
    return out.length ? out : d.slice();
  }
  function withDefault(list, def) { return list.indexOf(def) === -1 ? [def].concat(list) : list; }

  // Coerce every key of `defs` from `src`, returning a clean object.
  function normNums(src, defs) {
    src = src && typeof src === "object" ? src : {};
    const out = {};
    for (const k in defs) out[k] = num(src[k], defs[k]);
    return out;
  }

  /* ---------- normalize: rebuild a valid profile from anything ---------- */
  // Accepts the raw parsed blob (or null) and returns a guaranteed-valid,
  // fully-populated save object. Missing/garbage fields fall back to defaults.
  function normalize(raw) {
    const out = defaultData();
    if (!raw || typeof raw !== "object") return out;

    // Run version migrations first (operate on the raw blob).
    raw = migrate(raw);

    const p = raw.profile && typeof raw.profile === "object" ? raw.profile : {};
    const def = out.profile;

    // Story
    const story = p.story && typeof p.story === "object" ? p.story : {};
    out.profile.story = {
      highestUnlocked: Math.max(1, int(story.highestUnlocked, 1)),
      current: Math.max(1, int(story.current, 1)),
      completed: plainMap(story.completed),
      perfect: plainMap(story.perfect),
      stars: plainMap(story.stars),
      bestTime: plainMap(story.bestTime),
      bestMoves: plainMap(story.bestMoves),
      rewardsClaimed: plainMap(story.rewardsClaimed),
    };

    // Statistics / Resources / Inventory — flat numeric maps
    out.profile.statistics = normNums(p.statistics, def.statistics);
    out.profile.resources = normNums(p.resources, def.resources);
    out.profile.inventory = normNums(p.inventory, def.inventory);

    // Cosmetics
    const cos = p.cosmetics && typeof p.cosmetics === "object" ? p.cosmetics : {};
    const u = cos.unlocked && typeof cos.unlocked === "object" ? cos.unlocked : {};
    out.profile.cosmetics = {
      arrowSkin: str(cos.arrowSkin, "default"),
      boardTheme: str(cos.boardTheme, "default"),
      background: str(cos.background, "default"),
      particleStyle: str(cos.particleStyle, "default"),
      unlocked: {
        arrowSkin: withDefault(strArr(u.arrowSkin, ["default"]), "default"),
        boardTheme: withDefault(strArr(u.boardTheme, ["default"]), "default"),
        background: withDefault(strArr(u.background, ["default"]), "default"),
        particleStyle: withDefault(strArr(u.particleStyle, ["default"]), "default"),
      },
    };

    // Settings
    const s = p.settings && typeof p.settings === "object" ? p.settings : {};
    const ds = def.settings;
    out.profile.settings = {
      sound: bool(s.sound, ds.sound),
      music: bool(s.music, ds.music),
      guide: bool(s.guide, ds.guide),
      dark: bool(s.dark, ds.dark),
      contrast: bool(s.contrast, ds.contrast),
      colorblind: bool(s.colorblind, ds.colorblind),
    };

    // Session (resume snapshot) — validate just enough that loadLevel won't choke.
    out.session.inProgress = normInProgress(raw.session);
    out.saveVersion = SAVE_VERSION;
    return out;
  }

  // A resume snapshot is only kept if it is structurally sane; otherwise the
  // player simply starts the level fresh (never a crash on corrupt resume data).
  function normInProgress(session) {
    const ip = session && typeof session === "object" ? session.inProgress : null;
    if (!ip || typeof ip !== "object") return null;
    if (typeof ip.level !== "number" || !Array.isArray(ip.pieces)) return null;
    return ip;
  }

  /* ---------- version migration ---------- */
  // Each entry upgrades a blob FROM version N to N+1. Add steps here as the
  // schema evolves; saves walk up the chain so progress is never lost.
  const MIGRATIONS = {
    1: function (raw) {
      if (raw.profile) {
        if (!raw.profile.resources) raw.profile.resources = {};
        if (raw.profile.resources.coins === undefined) raw.profile.resources.coins = 0;

        if (!raw.profile.statistics) raw.profile.statistics = {};
        raw.profile.statistics.lifetimeCoinsEarned = 0;
        raw.profile.statistics.highestSingleReward = 0;
        raw.profile.statistics.averageCoinsPerLevel = 0;
        raw.profile.statistics.fastFinishes = 0;
        raw.profile.statistics.noHintClears = 0;
        raw.profile.statistics.coinsSpent = 0;
        raw.profile.statistics.coinsEarnedThisSession = 0;

        if (!raw.profile.story) raw.profile.story = {};
        if (!raw.profile.story.rewardsClaimed) raw.profile.story.rewardsClaimed = {};
      }
      return raw;
    },
  };

  function migrate(raw) {
    let v = int(raw.saveVersion, 0);
    while (v < SAVE_VERSION && MIGRATIONS[v]) {
      raw = MIGRATIONS[v](raw) || raw;
      v++;
      raw.saveVersion = v;
    }
    return raw;
  }

  /* ---------- one-time migration from the v1.0 split state ---------- */
  // Old shape: { settings, progress:{unlocked,current,stars}, stats:{...},
  //              inProgress, gridV }. Convert it into the new save blob so a
  //              returning player keeps every star, stat and setting.
  function fromLegacy(legacy) {
    const out = defaultData();
    const prof = out.profile;

    const ls = legacy.settings && typeof legacy.settings === "object" ? legacy.settings : {};
    const ds = prof.settings;
    prof.settings = {
      sound: bool(ls.sound, ds.sound),
      music: bool(ls.music, ds.music),
      dark: bool(ls.dark, ds.dark),
      contrast: bool(ls.contrast, ds.contrast),
      colorblind: bool(ls.colorblind, ds.colorblind),
    };

    const lp = legacy.progress && typeof legacy.progress === "object" ? legacy.progress : {};
    const stars = plainMap(lp.stars);
    prof.story.highestUnlocked = Math.max(1, int(lp.unlocked, 1));
    prof.story.current = Math.max(1, int(lp.current, 1));
    prof.story.stars = {};
    // Derive completed / perfect from the old per-level star map.
    for (const k in stars) {
      const v = int(stars[k], 0);
      if (v <= 0) continue;
      prof.story.stars[k] = v;
      prof.story.completed[k] = true;
      if (v >= 3) prof.story.perfect[k] = true;
    }

    const lst = legacy.stats && typeof legacy.stats === "object" ? legacy.stats : {};
    prof.statistics.levelsCompleted = num(lst.levelsCompleted, 0);
    prof.statistics.totalMoves = num(lst.totalMoves, 0);
    prof.statistics.hintsUsed = num(lst.hintsUsed, 0);
    prof.statistics.bestTime = num(lst.bestTime, 0);
    prof.statistics.totalPlayMs = num(lst.totalPlayMs, 0);

    out.session.inProgress = legacy.inProgress && typeof legacy.inProgress === "object"
      ? legacy.inProgress : null;

    return out;
  }

  /* =================================================================
     Player public object
     ================================================================= */
  const Player = {
    data: null,
    // live shortcuts (assigned in bind())
    profile: null, story: null, statistics: null,
    resources: null, inventory: null, cosmetics: null,
    settings: null, session: null,

    /** Load (or build) the profile. Safe to call once at boot. */
    init() {
      let raw = SM.load();
      let cameFromLegacy = false;

      if (!raw) {
        const legacy = SM.loadLegacy();
        if (legacy) { raw = fromLegacy(legacy); cameFromLegacy = true; }
      }

      this.data = normalize(raw);
      bind(this);

      // Reset coins earned this session at boot
      if (this.statistics) {
        this.statistics.coinsEarnedThisSession = 0;
      }

      // Persist immediately so any repair / migration / legacy import is durable,
      // and a fresh player gets a save row right away.
      SM.save(this.data);
      if (cameFromLegacy) SM.clearLegacy();
      return this.data;
    },

    /** Persist the whole profile. Every mutator funnels through here. */
    save() {
      return SM.save(this.data);
    },

    /** Wipe everything and create a brand-new profile (Reset Progress). */
    reset() {
      SM.clear();
      this.data = defaultData();
      bind(this);
      SM.save(this.data);
      return this.data;
    },

    /* ---------- semantic mutators (update + auto-save) ---------- */

    // Record a completed level: stars, time and move bests, streaks, totals.
    // Returns { firstClear } so callers can react to a brand-new clear.
    completeLevel(level, info, rewards) {
      const stars = Math.max(0, int(info.stars, 0));
      const timeSec = Math.max(0, num(info.timeSec, 0));
      const moves = Math.max(0, int(info.moves, 0));
      const st = this.story, stat = this.statistics;

      const prevStars = int(st.stars[level], 0);
      const firstClear = !st.completed[level];

      st.completed[level] = true;
      st.stars[level] = Math.max(prevStars, stars);
      if (stars >= 3) st.perfect[level] = true;
      st.highestUnlocked = Math.max(st.highestUnlocked, level + 1);
      st.current = level + 1;
      if (!st.bestTime[level] || timeSec < st.bestTime[level]) st.bestTime[level] = timeSec;
      if (!st.bestMoves[level] || moves < st.bestMoves[level]) st.bestMoves[level] = moves;

      if (firstClear) stat.levelsCompleted++;

      // Coin rewards and economy statistics updates
      if (rewards) {
        const coinsEarned = int(rewards.total, 0);
        this.resources.coins += coinsEarned;
        stat.lifetimeCoinsEarned += coinsEarned;
        stat.coinsEarnedThisSession += coinsEarned;
        
        if (coinsEarned > stat.highestSingleReward) {
          stat.highestSingleReward = coinsEarned;
        }
        if (rewards.speedBonus > 0) stat.fastFinishes++;
        if (rewards.hintBonus > 0) stat.noHintClears++;
        if (rewards.isPerfect) stat.perfectClears++; // Use Perfect Clear condition for perfectClears count
        
        // Save claimed type to track first-clear rewards vs replay
        if (!st.rewardsClaimed) st.rewardsClaimed = {};
        if (!st.rewardsClaimed[level]) {
          st.rewardsClaimed[level] = rewards.isReplay ? "replay" : "first";
        }
      } else {
        if (stars >= 3) stat.perfectClears++;
      }

      if (!stat.bestTime || timeSec < stat.bestTime) stat.bestTime = timeSec;
      stat.clearCount++;
      stat.totalClearSec += timeSec;
      stat.currentStreak++;
      if (stat.currentStreak > stat.longestStreak) stat.longestStreak = stat.currentStreak;

      // Recalculate average coins per level
      if (stat.levelsCompleted > 0) {
        stat.averageCoinsPerLevel = Math.round(stat.lifetimeCoinsEarned / stat.levelsCompleted);
      }

      this.save();
      return { firstClear: firstClear };
    },

    // Move the "Play" cursor without clearing a level (e.g. picking a level).
    setCurrentLevel(level) {
      this.story.current = Math.max(1, int(level, 1));
      this.save();
    },

    // A run ended in a game-over — the win streak resets.
    breakStreak() {
      this.statistics.currentStreak = 0;
      this.save();
    },

    recordWrongTap() { this.statistics.wrongTaps++; this.save(); },
    recordHintUsed() { this.statistics.hintsUsed++; this.save(); },
    recordRestart() { this.statistics.restarts++; this.save(); },
    addPlayTime(ms) { this.statistics.totalPlayMs += Math.max(0, num(ms, 0)); this.save(); },

    /* ---------- derived read helpers (no storage writes) ---------- */
    perfectLevelCount() { return Object.keys(this.story.perfect).length; },
    averageClearSec() {
      const s = this.statistics;
      return s.clearCount > 0 ? Math.round(s.totalClearSec / s.clearCount) : 0;
    },
  };

  // Point the convenience shortcuts at the current data object.
  function bind(self) {
    self.profile = self.data.profile;
    self.story = self.data.profile.story;
    self.statistics = self.data.profile.statistics;
    self.resources = self.data.profile.resources;
    self.inventory = self.data.profile.inventory;
    self.cosmetics = self.data.profile.cosmetics;
    self.settings = self.data.profile.settings;
    self.session = self.data.session;
  }

  AP.Player = Player;
  // Load synchronously at script-eval time so AP.Player.* is ready before the
  // game boots (save-manager.js is included before this file).
  Player.init();
})(window.AP = window.AP || {});
