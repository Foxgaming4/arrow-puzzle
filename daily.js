/* ===================================================================
   daily.js — Daily Challenge orchestrator.

   Manages player identity, puzzle fetching, countdown, gameplay rules,
   score submission, leaderboard display, and reward claiming.

   All daily state is stored separately from Story Mode in localStorage
   under the key "arrowflow:daily".

   Public API:
     AP.daily.init()                – boot (called from script.js)
     AP.daily.openDaily()           – navigate to the daily screen
     AP.daily.play()                – start the daily puzzle (countdown → game)
     AP.daily.onVictory(elapsedMs)  – called by script.js when daily puzzle cleared
     AP.daily.onGameOver()          – called by script.js on daily game-over
     AP.daily.openLeaderboard()     – fetch + display leaderboard
     AP.daily.hasNickname()         – true if player has set a nickname
     AP.daily.saveNickname(name)    – validate + persist nickname
   =================================================================== */
(function (AP) {
  "use strict";

  const STORAGE_KEY = "arrowflow:daily";
  const API_BASE = "/api/daily";

  // --------------- profanity blocklist (small embedded list) ---------------
  const BLOCKED = [
    "fuck","shit","ass","bitch","damn","dick","cunt","piss","cock","bastard",
    "slut","whore","nigger","nigga","fag","faggot","retard","penis","vagina",
    "anus","porn","sex","boob","tits","wank","dildo","pussy"
  ];
  function containsProfanity(str) {
    const lower = str.toLowerCase().replace(/[_0-9]/g, "");
    return BLOCKED.some(w => lower.includes(w));
  }

  // ----------------------- state management -----------------------
  let state = {
    playerId: null,
    nickname: null,
    history: {},    // { "daily-20260626": { completionMs, rank, coinsEarned, ... } }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") state = { ...state, ...parsed };
      }
    } catch (e) { /* corrupt — use defaults */ }

    // Ensure playerId exists
    if (!state.playerId) {
      state.playerId = generateId();
      saveState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* quota / private mode */ }
  }

  function generateId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "dp_";
    for (let i = 0; i < 16; i++) id += chars[(Math.random() * chars.length) | 0];
    return id;
  }

  // ----------------------- daily config cache -----------------------
  let dailyConfig = null;     // latest fetched config from API
  let countdownInterval = null;

  async function fetchDailyConfig() {
    try {
      const resp = await fetch(API_BASE);
      if (!resp.ok) throw new Error("API " + resp.status);
      dailyConfig = await resp.json();
      return dailyConfig;
    } catch (e) {
      console.warn("Daily API unavailable, using local fallback:", e.message);
      // Fallback: generate config client-side so the feature works without backend
      dailyConfig = generateLocalConfig();
      return dailyConfig;
    }
  }

  // Client-side fallback when API is unreachable (local dev / no KV)
  function generateLocalConfig() {
    const d = new Date();
    const dateKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const dow = d.getUTCDay();
    const SHAPES = ["full","diamond","circle","heart","star","triangle","hexagon","apple","plus"];
    const difficulties = ["Hard","Hard","Expert","Expert","Master","Master","Extreme"];

    let size, maxLen, turnProb;
    if (dow <= 1)      { size = 15; maxLen = 5; turnProb = 0.5; }
    else if (dow <= 3) { size = 16; maxLen = 6; turnProb = 0.6; }
    else if (dow <= 5) { size = 18; maxLen = 6; turnProb = 0.65; }
    else               { size = 20; maxLen = 7; turnProb = 0.7; }

    const tomorrow = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    return {
      puzzleId: "daily-" + dateKey,
      seed: (dateKey * 2654435761) >>> 0,
      size, shape: SHAPES[dateKey % SHAPES.length],
      maxLen, turnProb,
      hearts: 3, hintsEnabled: false,
      difficulty: difficulties[dow],
      remainingMs: tomorrow.getTime() - Date.now(),
      totalPlayers: 0,
      rewards: { completion: 150, top50: 25, top25: 50, top10: 100 },
    };
  }

  function todayPuzzleId() {
    const d = new Date();
    const dateKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    return "daily-" + dateKey;
  }

  function hasPlayedToday() {
    return !!(state.history && state.history[todayPuzzleId()]);
  }

  function todayResult() {
    return state.history ? state.history[todayPuzzleId()] : null;
  }

  // ----------------------- nickname -----------------------
  function hasNickname() {
    return !!(state.nickname && state.nickname.length >= 3);
  }

  function validateNickname(name) {
    if (!name || typeof name !== "string") return "Nickname is required";
    name = name.trim();
    if (name.length < 3) return "At least 3 characters";
    if (name.length > 16) return "Maximum 16 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(name)) return "Letters, numbers, and underscores only";
    if (containsProfanity(name)) return "That nickname is not allowed";
    return null; // valid
  }

  function saveNickname(name) {
    const error = validateNickname(name);
    if (error) return { ok: false, error };
    state.nickname = name.trim();
    saveState();
    return { ok: true };
  }

  // ----------------------- daily screen -----------------------
  async function openDaily() {
    // Check nickname first
    if (!hasNickname()) {
      AP.ui.openPopup("popup-nickname", true);
      return;
    }

    AP.ui.showScreen("screen-daily");
    renderDailyScreen(null); // show skeleton

    const config = await fetchDailyConfig();
    renderDailyScreen(config);
    startCountdown(config);
  }

  function renderDailyScreen(config) {
    const dateEl = document.getElementById("daily-date");
    const diffEl = document.getElementById("daily-difficulty");
    const countEl = document.getElementById("daily-countdown-clock");
    const playersEl = document.getElementById("daily-players");
    const playBtn = document.getElementById("btn-daily-play");
    const resultArea = document.getElementById("daily-result-area");
    const rewardPreview = document.getElementById("daily-reward-preview");

    // Date header
    const today = new Date();
    if (dateEl) dateEl.textContent = today.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

    if (!config) {
      if (diffEl) diffEl.textContent = "Loading...";
      if (countEl) countEl.textContent = "--:--:--";
      if (playBtn) { playBtn.disabled = true; playBtn.textContent = "Loading..."; }
      return;
    }

    if (diffEl) {
      diffEl.textContent = config.difficulty;
      diffEl.className = "daily-diff-badge diff-" + config.difficulty.toLowerCase();
    }

    if (playersEl) playersEl.textContent = config.totalPlayers + " players today";

    // Reward preview
    if (rewardPreview) {
      rewardPreview.innerHTML =
        '<div class="reward-tier"><span>Complete</span><b>+150</b></div>' +
        '<div class="reward-tier"><span>Top 50%</span><b>+25</b></div>' +
        '<div class="reward-tier"><span>Top 25%</span><b>+50</b></div>' +
        '<div class="reward-tier"><span>Top 10%</span><b>+100</b></div>';
    }

    // Already played today?
    const result = todayResult();
    if (result) {
      if (playBtn) { playBtn.disabled = true; playBtn.innerHTML = '<span>Completed ✓</span>'; }
      if (resultArea) {
        resultArea.style.display = "";
        const timeStr = fmtPreciseTime(result.completionMs);
        resultArea.innerHTML =
          '<div class="daily-result-card">' +
            '<div class="result-stat"><span>Your Time</span><b>' + timeStr + '</b></div>' +
            '<div class="result-stat"><span>Rank</span><b>#' + (result.rank || "—") + '</b></div>' +
            '<div class="result-stat"><span>Coins Earned</span><b>+' + (result.coinsEarned || 150) + '</b></div>' +
          '</div>';
      }
    } else {
      if (playBtn) { playBtn.disabled = false; playBtn.innerHTML = '<svg viewBox="0 0 100 100" class="ico"><use href="#icon-play"/></svg><span>Play</span>'; }
      if (resultArea) resultArea.style.display = "none";
    }
  }

  function startCountdown(config) {
    if (countdownInterval) clearInterval(countdownInterval);
    let remaining = config ? config.remainingMs : 0;
    const el = document.getElementById("daily-countdown-clock");
    if (!el) return;

    function tick() {
      remaining -= 1000;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        el.textContent = "New puzzle available!";
        // Auto-refresh after 2s
        setTimeout(() => openDaily(), 2000);
        return;
      }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      el.textContent =
        String(h).padStart(2, "0") + ":" +
        String(m).padStart(2, "0") + ":" +
        String(s).padStart(2, "0");
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // ----------------------- gameplay -----------------------
  let dailyStartTime = 0;
  let dailyTimerRAF = null;

  async function play() {
    if (hasPlayedToday()) {
      AP.ui.toast("Already completed today's challenge");
      return;
    }

    // Fetch config if we haven't
    if (!dailyConfig) await fetchDailyConfig();
    if (!dailyConfig) {
      AP.ui.toast("Could not load daily puzzle");
      return;
    }

    // Show countdown overlay
    await showGameCountdown();

    // Start the daily game
    AP.game.loadDailyLevel(dailyConfig);
    AP.ui.showScreen("screen-game");

    // Configure daily HUD
    const hintBtn = document.getElementById("btn-hint");
    if (hintBtn) hintBtn.style.display = "none";
    const badge = document.getElementById("daily-badge");
    if (badge) badge.style.display = "";

    // Start precision timer
    dailyStartTime = performance.now();
    updatePrecisionTimer();
  }

  function showGameCountdown() {
    return new Promise(resolve => {
      const overlay = document.getElementById("daily-countdown-overlay");
      const numEl = document.getElementById("countdown-number");
      if (!overlay || !numEl) { resolve(); return; }

      overlay.classList.add("active");
      let count = 3;

      function tick() {
        if (count <= 0) {
          overlay.classList.remove("active");
          resolve();
          return;
        }
        numEl.textContent = count;
        numEl.classList.remove("pop");
        void numEl.offsetWidth;
        numEl.classList.add("pop");
        AP.audio.play("button");
        if (AP.haptic) AP.haptic("medium");
        count--;
        setTimeout(tick, 900);
      }
      tick();
    });
  }

  function updatePrecisionTimer() {
    const el = document.getElementById("game-timer");
    if (!el) return;

    function frame() {
      if (!AP.game.isDailyMode || !AP.game.isDailyMode()) {
        return; // stopped
      }
      const elapsed = performance.now() - dailyStartTime;
      el.textContent = fmtPreciseTime(elapsed);
      dailyTimerRAF = requestAnimationFrame(frame);
    }
    dailyTimerRAF = requestAnimationFrame(frame);
  }

  function stopPrecisionTimer() {
    if (dailyTimerRAF) {
      cancelAnimationFrame(dailyTimerRAF);
      dailyTimerRAF = null;
    }
  }

  function fmtPreciseTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    const cs = String(Math.floor((ms % 1000) / 10)).padStart(2, "0");
    return mm + ":" + ss + "." + cs;
  }

  // ----------------------- victory -----------------------
  async function onVictory(elapsedMs) {
    stopPrecisionTimer();

    // Save locally first
    const result = {
      completionMs: Math.round(elapsedMs),
      puzzleId: dailyConfig ? dailyConfig.puzzleId : todayPuzzleId(),
      submittedAt: Date.now(),
      rank: null,
      coinsEarned: 150,
    };
    state.history[result.puzzleId] = result;
    saveState();

    // Show daily victory popup with loading state
    showDailyVictory(result, true);

    // Submit to server
    try {
      const resp = await fetch(API_BASE + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: state.playerId,
          nickname: state.nickname,
          completionMs: result.completionMs,
          puzzleId: result.puzzleId,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        result.rank = data.rank;
        result.totalPlayers = data.totalPlayers;
        result.personalBest = data.personalBest;
        result.isNewPB = data.isNewPB;
        result.coinsEarned = data.coinsEarned;
        state.history[result.puzzleId] = result;
        saveState();

        // Grant coins
        AP.Player.resources.coins += data.coinsEarned;
        AP.Player.save();
      } else if (resp.status === 409) {
        // Already submitted — use existing data
        const data = await resp.json();
        result.rank = data.rank;
        result.totalPlayers = data.totalPlayers;
      }
    } catch (e) {
      console.warn("Score submit failed:", e.message);
      // Still grant base coins locally
      AP.Player.resources.coins += 150;
      AP.Player.save();
    }

    // Update victory popup with final data
    showDailyVictory(result, false);
  }

  function showDailyVictory(result, loading) {
    AP.audio.play("victory");

    const popup = document.getElementById("popup-daily-victory");
    if (!popup) return;

    const timeEl = document.getElementById("dv-time");
    const rankEl = document.getElementById("dv-rank");
    const coinsEl = document.getElementById("dv-coins");
    const pbEl = document.getElementById("dv-pb");
    const loadingEl = document.getElementById("dv-loading");

    if (timeEl) timeEl.textContent = fmtPreciseTime(result.completionMs);

    if (loading) {
      if (rankEl) rankEl.textContent = "...";
      if (coinsEl) coinsEl.textContent = "...";
      if (pbEl) pbEl.style.display = "none";
      if (loadingEl) loadingEl.style.display = "";
    } else {
      if (rankEl) rankEl.textContent = result.rank ? "#" + result.rank : "—";
      if (coinsEl) coinsEl.textContent = "+" + (result.coinsEarned || 150);
      if (loadingEl) loadingEl.style.display = "none";
      if (pbEl && result.isNewPB) {
        pbEl.style.display = "";
        pbEl.textContent = "🏆 New Personal Best!";
      }
    }

    AP.ui.openPopup("popup-daily-victory", false);
  }

  // ----------------------- game over -----------------------
  function onGameOver() {
    stopPrecisionTimer();
    // In daily mode, game over means they failed — no submission
    // Reset daily HUD
    const hintBtn = document.getElementById("btn-hint");
    if (hintBtn) hintBtn.style.display = "";
    const badge = document.getElementById("daily-badge");
    if (badge) badge.style.display = "none";
  }

  // ----------------------- leaderboard -----------------------
  async function openLeaderboard() {
    const popup = document.getElementById("popup-leaderboard");
    if (!popup) return;

    // Show loading state
    const listEl = document.getElementById("lb-list");
    const playerRow = document.getElementById("lb-player-row");
    if (listEl) listEl.innerHTML = '<div class="lb-loading"><div class="spinner"></div><span>Loading leaderboard...</span></div>';
    if (playerRow) playerRow.style.display = "none";

    AP.ui.openPopup("popup-leaderboard", true);

    try {
      const resp = await fetch(API_BASE + "/leaderboard?playerId=" + encodeURIComponent(state.playerId));
      if (!resp.ok) throw new Error("API " + resp.status);
      const data = await resp.json();
      renderLeaderboard(data);
    } catch (e) {
      console.warn("Leaderboard fetch failed:", e.message);
      if (listEl) listEl.innerHTML = '<div class="lb-empty">Leaderboard unavailable. Complete the daily challenge to see rankings!</div>';
    }
  }

  function renderLeaderboard(data) {
    const listEl = document.getElementById("lb-list");
    const playerRow = document.getElementById("lb-player-row");
    if (!listEl) return;

    if (!data.entries || data.entries.length === 0) {
      listEl.innerHTML = '<div class="lb-empty">No entries yet. Be the first to complete today\'s challenge!</div>';
      return;
    }

    let html = '<div class="lb-header"><span class="lb-rank-col">#</span><span class="lb-name-col">Player</span><span class="lb-time-col">Time</span></div>';

    data.entries.forEach(entry => {
      const isMe = data.playerRank === entry.rank;
      const medalClass = entry.rank === 1 ? " lb-gold" : entry.rank === 2 ? " lb-silver" : entry.rank === 3 ? " lb-bronze" : "";
      const meClass = isMe ? " lb-me" : "";
      const medal = entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : entry.rank;

      html += '<div class="lb-row' + medalClass + meClass + '">' +
        '<span class="lb-rank-col">' + medal + '</span>' +
        '<span class="lb-name-col">' + escHtml(entry.nickname) + '</span>' +
        '<span class="lb-time-col">' + fmtPreciseTime(entry.completionMs) + '</span>' +
      '</div>';
    });

    listEl.innerHTML = html;

    // Show player rank if outside top 100
    if (playerRow && data.playerRank && data.playerRank > 100) {
      playerRow.style.display = "";
      playerRow.innerHTML =
        '<span class="lb-rank-col">' + data.playerRank + '</span>' +
        '<span class="lb-name-col">' + escHtml(state.nickname || "You") + '</span>' +
        '<span class="lb-time-col">' + (data.playerScore ? fmtPreciseTime(data.playerScore) : "—") + '</span>';
    } else if (playerRow) {
      playerRow.style.display = "none";
    }
  }

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ----------------------- cleanup -----------------------
  function exitDaily() {
    stopPrecisionTimer();
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    // Restore normal HUD
    const hintBtn = document.getElementById("btn-hint");
    if (hintBtn) hintBtn.style.display = "";
    const badge = document.getElementById("daily-badge");
    if (badge) badge.style.display = "none";
  }

  // ----------------------- init -----------------------
  function init() {
    loadState();
  }

  AP.daily = {
    init,
    openDaily,
    play,
    onVictory,
    onGameOver,
    openLeaderboard,
    exitDaily,
    hasNickname,
    validateNickname,
    saveNickname,
    hasPlayedToday,
    todayResult,
    fmtPreciseTime,
    get playerId() { return state.playerId; },
    get nickname() { return state.nickname; },
  };
})(window.AP = window.AP || {});
