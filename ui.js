/* ===================================================================
   ui.js — Screen routing, popups, settings panel, level-select grid,
   top/bottom bar updates, and small UI helpers (toast).

   This module owns DOM presentation only. Gameplay decisions live in
   script.js (AP.game) and shared state in AP.Player. UI calls into those
   at *runtime*, so script-load order doesn't matter.
   =================================================================== */
(function (AP) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {}; // cached element references
  const Player = AP.Player;

  let toastTimer = null;
  let milestoneTimer = null;
  let victoryTimers = [];
  let victoryRafId = null;
  let isCelebrating = false;
  let skipHintTimer = null;
  let victoryParams = null;

  function clearVictoryAnimations() {
    victoryTimers.forEach(clearTimeout);
    victoryTimers = [];
    if (victoryRafId) {
      cancelAnimationFrame(victoryRafId);
      victoryRafId = null;
    }
  }

  function startCelebration(params) {
    isCelebrating = true;
    victoryParams = params;
    
    // Reset skip hint display state
    const hint = $("victory-skip-hint");
    if (hint) {
      hint.classList.remove("show");
      clearTimeout(skipHintTimer);
      skipHintTimer = setTimeout(() => {
        if (isCelebrating) hint.classList.add("show");
      }, 500);
    }
  }

  function isCelebratingActive() {
    return isCelebrating;
  }

  function skipVictory() {
    if (!isCelebrating) return;
    isCelebrating = false;

    // Hide skip hint
    const hint = $("victory-skip-hint");
    if (hint) {
      hint.classList.remove("show");
      clearTimeout(skipHintTimer);
    }

    // Cancel outro timer in game if running
    if (AP.game_internal && AP.game_internal.cancelOutro) {
      AP.game_internal.cancelOutro();
    }

    // Clear all scheduled victory timers
    clearVictoryAnimations();

    // Render Victory popup instantly to its final state
    if (victoryParams) {
      const { time, moves, stars, rewards } = victoryParams;
      
      // Instantly open popup without sound
      openPopup("popup-victory", false);
      
      // Instantly show time/moves
      el["victory-time"].textContent = fmtTime(time);
      el["victory-moves"].textContent = moves;

      // Instantly light up stars
      const spans = el["victory-stars"].querySelectorAll("span");
      spans.forEach((sp, i) => {
        if (i < stars) sp.classList.add("lit");
        else sp.classList.remove("lit");
      });

      // Instantly show breakdown rows
      const breakdown = el["victory-reward-breakdown"];
      breakdown.innerHTML = "";
      
      const rows = [];
      rows.push({ name: rewards.baseName, amt: rewards.baseAmt });
      if (rewards.speedBonus > 0) {
        rows.push({ name: `${rewards.speedTier} Speed`, amt: "+" + rewards.speedBonus });
      }
      if (rewards.heartsBonus > 0) {
        rows.push({ name: "Hearts Bonus", amt: "+" + rewards.heartsBonus });
      }
      if (rewards.accuracyBonus > 0) {
        rows.push({ name: "Accuracy Bonus", amt: "+" + rewards.accuracyBonus });
      }
      if (rewards.hintBonus > 0) {
        rows.push({ name: "No Hint Bonus", amt: "+" + rewards.hintBonus });
      }
      if (rewards.perfectBonus > 0) {
        rows.push({ name: "Perfect Clear Bonus", amt: "+" + rewards.perfectBonus });
      }
      
      rows.forEach((r) => {
        const div = document.createElement("div");
        div.className = "reward-row";
        div.innerHTML = `<span>${r.name}</span><b>${r.amt}</b>`;
        breakdown.appendChild(div);
      });

      // Instantly show perfect badge if applicable
      if (rewards.isPerfect) {
        el["victory-perfect-badge"].style.display = "inline-flex";
      } else {
        el["victory-perfect-badge"].style.display = "none";
      }

      // Instantly set total earned amount
      el["victory-total-amount"].textContent = rewards.total;

      // Clean up flying coins
      document.querySelectorAll(".flying-coin").forEach(c => c.remove());

      // Instantly update all coin pill displays to final balance
      ["menu-coin-amount", "levels-coin-amount", "victory-coin-amount", "shop-coin-amount"].forEach(id => {
        if (el[id]) el[id].textContent = Player.resources.coins;
      });
    }
  }

  function cache() {
    [
      "screen-splash", "screen-menu", "screen-levels", "screen-game", "screen-shop", "screen-intro", "screen-daily",
      "board", "board-wrap", "remaining-count", "game-level-label", "hint-count", "hearts",
      "btn-sound", "btn-menu-sound", "btn-guide", "btn-zoom", "levels-grid", "toast",
      // settings inputs
      "set-sound", "set-music", "set-guide", "set-dark", "set-contrast", "set-colorblind",
      // victory
      "victory-time", "victory-moves", "victory-stars",
      "victory-coin-amount", "victory-reward-breakdown", "victory-total-amount", "victory-perfect-badge", "victory-reward-total",
      // menu & levels & shop coins
      "menu-coin-amount", "levels-coin-amount", "shop-coin-amount",
      // stats (12 fields + 6 economy fields)
      "stat-levels", "stat-current", "stat-perfect",
      "stat-best", "stat-avg", "stat-moves", "stat-wrong",
      "stat-hints", "stat-restarts", "stat-playtime",
      "stat-streak", "stat-longest",
      "stat-coins", "stat-lifetime-coins", "stat-highest-reward", "stat-average-reward", "stat-fast-finishes", "stat-no-hint-clears",
      // shop elements
      "tab-items", "tab-skins", "shop-grid", "popup-insufficient", "insufficient-current", "insufficient-required", "btn-insufficient-close",
    ].forEach((id) => (el[id] = $(id)));
  }

  /* ---------- screen routing ---------- */
  const SCREENS = ["screen-splash", "screen-menu", "screen-levels", "screen-game", "screen-shop", "screen-intro", "screen-daily"];
  function showScreen(id) {
    SCREENS.forEach((s) => el[s] && el[s].classList.toggle("active", s === id));
    if (id === "screen-menu" || id === "screen-levels" || id === "screen-shop") {
      updateCoinDisplays(true);
    }
  }

  /* ---------- popups ---------- */
  function openPopup(id, sound = true) {
    const node = $(id);
    if (!node) return;
    node.classList.add("open");
    node.setAttribute("aria-hidden", "false");
    if (sound) AP.audio.play("popup");

    // Pause timer if game screen is active
    if (document.getElementById("screen-game") && document.getElementById("screen-game").classList.contains("active")) {
      if (AP.game && AP.game.pauseTimer) AP.game.pauseTimer();
    }
  }
  function closePopup(id) {
    const node = $(id);
    if (!node) return;
    node.classList.remove("open");
    node.setAttribute("aria-hidden", "true");

    // Resume timer if game screen is active and no more popups are open
    if (document.getElementById("screen-game") && document.getElementById("screen-game").classList.contains("active")) {
      const openPopups = document.querySelectorAll(".popup-overlay.open");
      if (openPopups.length === 0) {
        if (AP.game && AP.game.resumeTimer) AP.game.resumeTimer();
      }
    }
  }
  function closeAllPopups() {
    document.querySelectorAll(".popup-overlay.open").forEach((n) => {
      n.classList.remove("open"); n.setAttribute("aria-hidden", "true");
    });

    // Resume timer if game screen is active (since all popups are now closed)
    if (document.getElementById("screen-game") && document.getElementById("screen-game").classList.contains("active")) {
      if (AP.game && AP.game.resumeTimer) AP.game.resumeTimer();
    }
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    const t = el["toast"];
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
  }

  /* ---------- milestone popup ---------- */
  function showMilestone(percent) {
    const popup = $("milestone-popup");
    if (!popup) return;
    popup.textContent = percent + "% Complete";
    popup.classList.add("show");
    AP.audio.play("milestone");
    clearTimeout(milestoneTimer);
    milestoneTimer = setTimeout(() => {
      popup.classList.remove("show");
    }, 1000);
  }

  /* ---------- top / bottom bar updaters ---------- */
  function setRemaining(n) { if (el["remaining-count"]) el["remaining-count"].textContent = n; }
  function setLevelLabel(n) { if (el["game-level-label"]) el["game-level-label"].textContent = "Level " + n; }
  function setHintCount(n) { if (el["hint-count"]) el["hint-count"].textContent = n; }
  function setUndoEnabled(on) { if (el["btn-undo"]) el["btn-undo"].disabled = !on; }

  // Render the hearts row: `lives` filled out of `total`.
  function setHearts(lives, total) {
    const box = el["hearts"];
    if (!box) return;
    let html = "";
    for (let i = 0; i < total; i++) {
      html += '<span class="heart' + (i < lives ? "" : " lost") + '"><svg viewBox="0 0 100 100"><use href="#icon-heart"/></svg></span>';
    }
    box.innerHTML = html;
    // pop the heart that was just lost
    if (lives < total) {
      const justLost = box.children[lives];
      if (justLost) { justLost.classList.add("pop"); setTimeout(() => justLost && justLost.classList.remove("pop"), 400); }
    }
  }

  function refreshSoundIcons() {
    const on = AP.audio.isSoundOn();
    const href = on ? "#icon-sound-on" : "#icon-sound-off";
    [el["btn-sound"], el["btn-menu-sound"]].forEach((b) => {
      const use = b && b.querySelector("use");
      if (use) use.setAttribute("href", href);
    });
  }

  /* ---------- settings panel <-> state ---------- */
  function syncSettingsInputs() {
    const s = Player.settings;
    el["set-sound"].checked = s.sound;
    el["set-music"].checked = s.music;
    el["set-guide"].checked = s.guide;
    el["set-dark"].checked = s.dark;
    el["set-contrast"].checked = s.contrast;
    el["set-colorblind"].checked = s.colorblind;
    refreshSoundIcons();
    refreshGuideButton();
  }

  function refreshGuideButton() {
    const btn = el["btn-guide"];
    if (btn) btn.classList.toggle("active", !!Player.settings.guide);
  }

  function toggleGuide() {
    Player.settings.guide = !Player.settings.guide;
    AP.applySettings();
    refreshGuideButton();
    AP.audio.play("button");
    toast(Player.settings.guide ? "Guide on" : "Guide off");
  }

  function toggleZoom() {
    const wrap = el["board-wrap"];
    if (!wrap) return;
    const isZoomed = wrap.classList.toggle("zoomed");
    const btn = el["btn-zoom"];
    if (btn) btn.classList.toggle("active", isZoomed);
    AP.audio.play("button");
    toast(isZoomed ? "Zoomed in" : "Zoomed out");
  }

  function setZoomVisible(visible) {
    const btn = el["btn-zoom"];
    if (btn) btn.style.display = visible ? "" : "none";
  }

  function resetZoom() {
    const wrap = el["board-wrap"];
    if (wrap) wrap.classList.remove("zoomed");
    const btn = el["btn-zoom"];
    if (btn) btn.classList.remove("active");
  }

  /* ---------- coins ---------- */
  function updateCoinDisplays(instant) {
    const coins = Player.resources.coins;
    if (instant) {
      ["menu-coin-amount", "levels-coin-amount", "victory-coin-amount", "shop-coin-amount"].forEach(id => {
        if (el[id]) el[id].textContent = coins;
      });
    }
  }

  function animateCoinCount(start, end) {
    const duration = 800; // ms
    const startTime = performance.now();
    const elements = ["menu-coin-amount", "levels-coin-amount", "victory-coin-amount", "shop-coin-amount"].map(id => el[id]).filter(Boolean);
    
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = progress * (2 - progress);
      const value = Math.floor(start + (end - start) * ease);
      
      elements.forEach(el => {
        el.textContent = value;
      });
      
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        elements.forEach(el => {
          el.textContent = end;
        });
      }
    }
    requestAnimationFrame(tick);
  }

  /* ---------- stats ---------- */
  function fmtTime(sec) {
    if (!sec && sec !== 0) return "—";
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }
  function renderStats() {
    const st = Player.statistics;
    const story = Player.story;
    el["stat-levels"].textContent = st.levelsCompleted;
    el["stat-current"].textContent = story.current;
    el["stat-perfect"].textContent = Player.perfectLevelCount();
    el["stat-best"].textContent = st.bestTime ? fmtTime(st.bestTime) : "—";
    el["stat-avg"].textContent = Player.averageClearSec() ? fmtTime(Player.averageClearSec()) : "—";
    el["stat-moves"].textContent = st.totalMoves;
    el["stat-wrong"].textContent = st.wrongTaps;
    el["stat-hints"].textContent = st.hintsUsed;
    el["stat-restarts"].textContent = st.restarts;
    const mins = Math.floor((st.totalPlayMs || 0) / 60000);
    el["stat-playtime"].textContent = mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h " + (mins % 60) + "m";
    el["stat-streak"].textContent = st.currentStreak;
    el["stat-longest"].textContent = st.longestStreak;
    // Economy
    el["stat-coins"].textContent = Player.resources.coins;
    el["stat-lifetime-coins"].textContent = st.lifetimeCoinsEarned || 0;
    el["stat-highest-reward"].textContent = st.highestSingleReward || 0;
    el["stat-average-reward"].textContent = st.averageCoinsPerLevel || 0;
    el["stat-fast-finishes"].textContent = st.fastFinishes || 0;
    el["stat-no-hint-clears"].textContent = st.noHintClears || 0;
  }

  /* ---------- victory popup ---------- */
  /* ---------- victory popup ---------- */
  function showVictory({ time, moves, stars, rewards }) {
    victoryParams = { time, moves, stars, rewards };
    isCelebrating = true;
    clearVictoryAnimations();

    el["victory-time"].textContent = fmtTime(time);
    el["victory-moves"].textContent = moves;
    
    // Set stars
    const spans = el["victory-stars"].querySelectorAll("span");
    spans.forEach((sp, i) => {
      sp.classList.remove("lit");
      const tid = setTimeout(() => { if (i < stars) sp.classList.add("lit"); }, 200 + i * 180);
      victoryTimers.push(tid);
    });

    // Clear and hide elements initially
    const breakdown = el["victory-reward-breakdown"];
    breakdown.innerHTML = "";
    el["victory-total-amount"].textContent = "0";
    el["victory-perfect-badge"].style.display = "none";
    
    // Set initial coin pill values to BEFORE this completion
    const startCoins = Player.resources.coins - rewards.total;
    ["menu-coin-amount", "levels-coin-amount", "victory-coin-amount"].forEach(id => {
      if (el[id]) el[id].textContent = startCoins;
    });

    // Open victory popup
    openPopup("popup-victory", false);

    // List of rows to animate
    const rows = [];
    rows.push({ name: rewards.baseName, amt: rewards.baseAmt });
    if (rewards.speedBonus > 0) {
      rows.push({ name: `${rewards.speedTier} Speed`, amt: "+" + rewards.speedBonus });
    }
    if (rewards.heartsBonus > 0) {
      rows.push({ name: "Hearts Bonus", amt: "+" + rewards.heartsBonus });
    }
    if (rewards.accuracyBonus > 0) {
      rows.push({ name: "Accuracy Bonus", amt: "+" + rewards.accuracyBonus });
    }
    if (rewards.hintBonus > 0) {
      rows.push({ name: "No Hint Bonus", amt: "+" + rewards.hintBonus });
    }
    if (rewards.perfectBonus > 0) {
      rows.push({ name: "Perfect Clear Bonus", amt: "+" + rewards.perfectBonus });
    }

    let delay = 500;
    
    // 1. If perfect, show Perfect Clear badge first
    if (rewards.isPerfect) {
      const tid = setTimeout(() => {
        el["victory-perfect-badge"].style.display = "inline-flex";
        AP.audio.play("perfectClear");
      }, delay);
      victoryTimers.push(tid);
      delay += 800;
    }

    // 2. Animate breakdown rows one by one
    rows.forEach((r) => {
      const tid = setTimeout(() => {
        const div = document.createElement("div");
        div.className = "reward-row";
        div.innerHTML = `<span>${r.name}</span><b>${r.amt}</b>`;
        breakdown.appendChild(div);
        AP.audio.play("coin");
      }, delay);
      victoryTimers.push(tid);
      delay += 350;
    });

    // 3. Animate total earned row
    const tidTotal = setTimeout(() => {
      animateNumber(el["victory-total-amount"], 0, rewards.total, 500, () => {
        AP.audio.play("countup");
      }, () => {
        triggerFlyingCoins(rewards.total);
      });
    }, delay);
    victoryTimers.push(tidTotal);
  }

  function animateNumber(element, start, end, duration, onTick, onComplete) {
    if (!element) return;
    const startTime = performance.now();
    let lastTickVal = start;
    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const current = Math.floor(start + (end - start) * progress);
      element.textContent = current;
      if (current !== lastTickVal && onTick) {
        onTick(current);
        lastTickVal = current;
      }
      if (progress < 1) {
        victoryRafId = requestAnimationFrame(update);
      } else {
        element.textContent = end;
        if (onComplete) onComplete();
      }
    }
    victoryRafId = requestAnimationFrame(update);
  }

  function triggerFlyingCoins(coinCount) {
    const numCoins = Math.min(12, Math.max(6, Math.floor(coinCount / 10)));
    const startCoins = Player.resources.coins - coinCount;
    const targetCoins = Player.resources.coins;
    
    const startRect = el["victory-reward-total"].getBoundingClientRect();
    const endRect = el["victory-coin-amount"].getBoundingClientRect();
    
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;
    const endX = endRect.left + endRect.width / 2;
    const endY = endRect.top + endRect.height / 2;
    
    let coinsArrived = 0;

    for (let i = 0; i < numCoins; i++) {
      const tid1 = setTimeout(() => {
        const coin = document.createElement("div");
        coin.className = "flying-coin";
        coin.innerHTML = `<svg viewBox="0 0 100 100" class="ico coin-icon"><use href="#icon-coin"/></svg>`;
        document.body.appendChild(coin);
        
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 40;
        const spreadX = Math.cos(angle) * dist;
        const spreadY = Math.sin(angle) * dist;
        
        coin.style.left = (startX - 11) + "px";
        coin.style.top = (startY - 11) + "px";
        coin.style.opacity = "0";
        coin.style.transform = "scale(0.5)";
        
        requestAnimationFrame(() => {
          coin.style.opacity = "1";
          coin.style.transform = `translate(${spreadX}px, ${spreadY}px) scale(1.1)`;
          
          const tid2 = setTimeout(() => {
            coin.style.transition = "transform 0.7s cubic-bezier(0.5, 0, 0.25, 1), opacity 0.6s ease-in";
            const targetX = endX - startX - spreadX;
            const targetY = endY - startY - spreadY;
            coin.style.transform = `translate(${spreadX + targetX}px, ${spreadY + targetY}px) scale(0.85)`;
            coin.style.opacity = "0.7";
            
            const tid3 = setTimeout(() => {
              coin.remove();
              coinsArrived++;
              
              const currentVal = Math.floor(startCoins + (targetCoins - startCoins) * (coinsArrived / numCoins));
              ["menu-coin-amount", "levels-coin-amount", "victory-coin-amount", "shop-coin-amount"].forEach(id => {
                if (el[id]) el[id].textContent = currentVal;
              });
              
              AP.audio.play("countup");
              const pill = el["victory-coin-amount"].closest(".coin-pill");
              if (pill) {
                pill.style.transform = "scale(1.18)";
                setTimeout(() => pill.style.transform = "", 100);
              }
              
              if (coinsArrived === numCoins) {
                const tid4 = setTimeout(() => {
                  AP.audio.play("victoryLarge");
                  ["menu-coin-amount", "levels-coin-amount", "victory-coin-amount", "shop-coin-amount"].forEach(id => {
                    if (el[id]) el[id].textContent = targetCoins;
                  });
                  if (pill) {
                    pill.style.transform = "scale(1.25)";
                    setTimeout(() => pill.style.transform = "", 180);
                  }
                  // Celebration complete
                  isCelebrating = false;
                  const hint = $("victory-skip-hint");
                  if (hint) hint.classList.remove("show");
                }, 80);
                victoryTimers.push(tid4);
              }
            }, 680);
            victoryTimers.push(tid3);
          }, 180);
          victoryTimers.push(tid2);
        });
      }, i * 60);
      victoryTimers.push(tid1);
    }
  }

  /* ---------- level select ---------- */
  function buildLevels() {
    const grid = el["levels-grid"];
    grid.innerHTML = "";
    const total = AP.levels.TOTAL_LEVELS;
    const story = Player.story;
    for (let n = 1; n <= total; n++) {
      const cell = document.createElement("button");
      cell.className = "level-cell";
      cell.setAttribute("role", "listitem");
      const locked = n > story.highestUnlocked;
      if (locked) {
        cell.classList.add("locked");
        cell.innerHTML = '<svg viewBox="0 0 100 100" class="ico"><use href="#icon-lock"/></svg>';
        cell.setAttribute("aria-label", "Level " + n + " locked");
      } else {
        const done = !!story.completed[n];
        if (done) cell.classList.add("done");
        if (n === story.current) cell.classList.add("current");
        const s = story.stars[n] || 0;
        const stars = s ? "★".repeat(s) : "";
        cell.innerHTML = '<span>' + n + '</span><span class="mini-stars">' + stars + '</span>';
        cell.setAttribute("aria-label", "Play level " + n);
        cell.addEventListener("click", () => { AP.audio.play("button"); AP.game.startLevel(n); });
      }
      grid.appendChild(cell);
    }
  }

  /* ---------- shop management ---------- */
  let activeShopTab = "items";

  function switchShopTab(tab) {
    if (activeShopTab === tab) return;
    activeShopTab = tab;
    el["tab-items"].classList.toggle("active", tab === "items");
    el["tab-items"].setAttribute("aria-selected", tab === "items" ? "true" : "false");
    el["tab-skins"].classList.toggle("active", tab === "skins");
    el["tab-skins"].setAttribute("aria-selected", tab === "skins" ? "true" : "false");
    renderShop();
  }

  function renderShop() {
    updateCoinDisplays(true);
    const grid = el["shop-grid"];
    grid.innerHTML = "";

    if (activeShopTab === "items") {
      const items = [
        {
          id: "extraHearts",
          name: "Extra Heart",
          desc: "Start the next level with 1 extra heart (max 5 starting hearts).",
          price: 150,
          max: 5,
          iconClass: "heart-item",
          iconHref: "#icon-heart"
        },
        {
          id: "hints",
          name: "Hint",
          desc: "Spot a free move during a level. Added to your hint balance.",
          price: 100,
          max: 20,
          iconClass: "hint-item",
          iconHref: "#icon-bulb"
        }
      ];

      items.forEach(item => {
        const count = Player.inventory[item.id] || 0;
        const card = document.createElement("div");
        card.className = "product-card";
        card.setAttribute("role", "listitem");
        
        card.innerHTML = `
          <div class="inventory-badge">${count}/${item.max}</div>
          <div class="item-preview ${item.iconClass}">
            <svg viewBox="0 0 100 100" class="ico"><use href="${item.iconHref}"/></svg>
          </div>
          <h3>${item.name}</h3>
          <p>${item.desc}</p>
          <div class="price-tag">
            <span>${item.price}</span>
            <svg viewBox="0 0 100 100" class="ico coin-icon"><use href="#icon-coin"/></svg>
          </div>
          <button class="btn btn-primary full buy-btn">${count >= item.max ? "Maxed Out" : "Buy"}</button>
        `;

        const buyBtn = card.querySelector(".buy-btn");
        if (count >= item.max) {
          buyBtn.disabled = true;
          buyBtn.classList.remove("btn-primary");
          buyBtn.classList.add("btn-soft");
        } else {
          buyBtn.addEventListener("click", () => purchaseItem(item));
        }

        grid.appendChild(card);
      });

    } else {
      const skins = [
        { id: "default", name: "Default", desc: "Classic theme-responsive arrow style.", price: 0, color: "var(--tile-arrow)" },
        { id: "ruby-red", name: "Ruby Red", desc: "A vibrant crimson skin.", price: 300, color: "#E05B6A" },
        { id: "emerald-green", name: "Emerald Green", desc: "A striking green skin.", price: 400, color: "#10B981" },
        { id: "midnight-black", name: "Midnight Black", desc: "A deep navy-slate skin.", price: 500, color: "#1E293B", darkColor: "#94A3B8" },
        { id: "royal-gold", name: "Royal Gold", desc: "A premium golden skin.", price: 600, color: "#F59E0B" }
      ];

      skins.forEach(skin => {
        const isUnlocked = Player.cosmetics.unlocked.arrowSkin.includes(skin.id);
        const isEquipped = Player.cosmetics.arrowSkin === skin.id;
        const card = document.createElement("div");
        card.className = "product-card";
        card.setAttribute("role", "listitem");

        let dotColor = skin.color;
        if (document.documentElement.getAttribute("data-theme") === "dark" && skin.darkColor) {
          dotColor = skin.darkColor;
        }

        let actionBtnText = "Buy";
        let actionBtnClass = "btn-primary";
        
        if (isEquipped) {
          actionBtnText = "Equipped";
          actionBtnClass = "btn-soft";
        } else if (isUnlocked) {
          actionBtnText = "Equip";
          actionBtnClass = "btn-primary";
        }

        card.innerHTML = `
          <div class="skin-preview">
            <div class="skin-preview-dot skin-${skin.id}" style="background: ${dotColor}">
              <svg viewBox="0 0 100 100" class="ico"><use href="#icon-arrow"/></svg>
            </div>
          </div>
          <h3>${skin.name}</h3>
          <p>${skin.desc}</p>
          ${isUnlocked ? '<div class="price-tag"><span>Owned</span></div>' : `
            <div class="price-tag">
              <span>${skin.price}</span>
              <svg viewBox="0 0 100 100" class="ico coin-icon"><use href="#icon-coin"/></svg>
            </div>
          `}
          <button class="btn ${actionBtnClass} full action-btn">${actionBtnText}</button>
        `;

        const btn = card.querySelector(".action-btn");
        if (isEquipped) {
          btn.disabled = true;
        } else {
          btn.addEventListener("click", () => {
            if (isUnlocked) {
              equipSkin(skin.id);
            } else {
              purchaseSkin(skin);
            }
          });
        }

        grid.appendChild(card);
      });
    }
  }

  function purchaseItem(item) {
    const coins = Player.resources.coins;
    if (coins < item.price) {
      showInsufficientCoins(item.price);
      return;
    }

    const currentCount = Player.inventory[item.id] || 0;
    if (currentCount >= item.max) {
      toast("Inventory limit reached!");
      return;
    }

    Player.resources.coins -= item.price;
    Player.inventory[item.id] = currentCount + 1;
    Player.save();
    
    AP.audio.play("coin");
    toast(`Purchased ${item.name}!`);
    
    animateCoinCount(coins, Player.resources.coins);
    renderShop();
    
    if (item.id === "hints" && el["hint-count"]) {
      setHintCount(Player.inventory.hints);
    }
  }

  function purchaseSkin(skin) {
    const coins = Player.resources.coins;
    if (coins < skin.price) {
      showInsufficientCoins(skin.price);
      return;
    }

    Player.resources.coins -= skin.price;
    Player.cosmetics.unlocked.arrowSkin.push(skin.id);
    Player.save();

    AP.audio.play("coin");
    toast(`Unlocked ${skin.name} skin!`);
    
    animateCoinCount(coins, Player.resources.coins);
    renderShop();
  }

  function equipSkin(skinId) {
    Player.cosmetics.arrowSkin = skinId;
    Player.save();

    AP.audio.play("button");
    toast("Skin equipped!");
    renderShop();
  }

  function showInsufficientCoins(requiredCoins) {
    AP.audio.play("invalid");
    $("insufficient-current").textContent = Player.resources.coins;
    $("insufficient-required").textContent = requiredCoins;
    openPopup("popup-insufficient", false);
  }

  /* ---------- event wiring ---------- */
  function bindEvents() {
    // Menu
    $("btn-play").addEventListener("click", () => { AP.audio.play("button"); AP.game.startLevel(Player.story.current); });
    $("btn-daily").addEventListener("click", () => { AP.audio.play("button"); AP.daily.openDaily(); });
    $("btn-levels").addEventListener("click", () => { AP.audio.play("button"); buildLevels(); showScreen("screen-levels"); });
    $("btn-shop").addEventListener("click", () => { AP.audio.play("button"); renderShop(); showScreen("screen-shop"); });
    $("btn-stats").addEventListener("click", () => { AP.audio.play("button"); renderStats(); openPopup("popup-stats"); });
    $("btn-menu-settings").addEventListener("click", () => { AP.audio.play("button"); syncSettingsInputs(); openPopup("popup-settings"); });
    $("btn-menu-sound").addEventListener("click", toggleSoundQuick);

    // Level select
    $("btn-levels-back").addEventListener("click", () => { AP.audio.play("button"); showScreen("screen-menu"); });

    // Shop select
    $("btn-shop-back").addEventListener("click", () => { AP.audio.play("button"); showScreen("screen-menu"); });
    $("tab-items").addEventListener("click", () => { AP.audio.play("button"); switchShopTab("items"); });
    $("tab-skins").addEventListener("click", () => { AP.audio.play("button"); switchShopTab("skins"); });
    $("btn-insufficient-close").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-insufficient"); });

    // Daily Challenge
    $("btn-daily-back").addEventListener("click", () => { AP.audio.play("button"); AP.daily.exitDaily(); showScreen("screen-menu"); });
    $("btn-daily-play").addEventListener("click", () => { AP.audio.play("button"); AP.daily.play(); });
    $("btn-daily-leaderboard").addEventListener("click", () => { AP.audio.play("button"); AP.daily.openLeaderboard(); });

    // Nickname Popup
    $("btn-nickname-save").addEventListener("click", () => {
      AP.audio.play("button");
      const input = $("nickname-input");
      const err = $("nickname-error");
      const res = AP.daily.saveNickname(input.value);
      if (res.ok) {
        closePopup("popup-nickname");
        AP.daily.openDaily();
      } else {
        err.textContent = res.error;
        input.classList.add("error");
      }
    });
    $("nickname-input").addEventListener("input", () => {
      $("nickname-input").classList.remove("error");
      $("nickname-error").textContent = "";
    });
    $("btn-nickname-close").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-nickname"); });

    // Daily Victory Popup
    $("btn-dv-leaderboard").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-daily-victory"); AP.daily.openLeaderboard(); });
    $("btn-dv-menu").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-daily-victory"); AP.daily.exitDaily(); showScreen("screen-menu"); });

    // Leaderboard
    $("btn-lb-close").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-leaderboard"); });

    // Game top bar
    $("btn-back").addEventListener("click", () => { AP.audio.play("button"); AP.game.toMenu(); });
    $("btn-settings").addEventListener("click", () => { AP.audio.play("button"); syncSettingsInputs(); openPopup("popup-settings"); });
    $("btn-sound").addEventListener("click", toggleSoundQuick);

    // Game bottom bar
    $("btn-restart").addEventListener("click", () => { AP.audio.play("button"); AP.game.restart(); });
    $("btn-guide").addEventListener("click", toggleGuide);
    $("btn-zoom").addEventListener("click", toggleZoom);
    $("btn-hint").addEventListener("click", () => AP.game.hint());

    // Settings toggles
    el["set-sound"].addEventListener("change", (e) => { Player.settings.sound = e.target.checked; AP.applySettings(); refreshSoundIcons(); AP.audio.play("button"); });
    el["set-music"].addEventListener("change", (e) => { Player.settings.music = e.target.checked; AP.applySettings(); });
    el["set-guide"].addEventListener("change", (e) => { Player.settings.guide = e.target.checked; AP.applySettings(); refreshGuideButton(); });
    el["set-dark"].addEventListener("change", (e) => { Player.settings.dark = e.target.checked; AP.applySettings(); });
    el["set-contrast"].addEventListener("change", (e) => { Player.settings.contrast = e.target.checked; AP.applySettings(); });
    el["set-colorblind"].addEventListener("change", (e) => { Player.settings.colorblind = e.target.checked; AP.applySettings(); });

    $("btn-settings-close").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-settings"); });
    $("btn-howto").addEventListener("click", () => { closePopup("popup-settings"); openPopup("popup-howto"); });
    $("btn-howto-close").addEventListener("click", () => closePopup("popup-howto"));
    $("btn-howto-ok").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-howto"); });
    $("btn-stats-close").addEventListener("click", () => closePopup("popup-stats"));
    $("btn-reset-progress").addEventListener("click", () => {
      AP.audio.play("button");
      closePopup("popup-settings");
      openPopup("popup-reset");
    });

    // Reset confirmation popup
    $("btn-reset-confirm").addEventListener("click", () => {
      AP.audio.play("button");
      closePopup("popup-reset");
      AP.resetProgress();
      syncSettingsInputs();
      updateCoinDisplays(true);
      if (activeShopTab) {
        renderShop();
      }
      toast("Progress reset");
    });
    $("btn-reset-cancel").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-reset"); });

    // Victory
    $("btn-next-level").addEventListener("click", () => { isCelebrating = false; const hint = $("victory-skip-hint"); if (hint) hint.classList.remove("show"); clearVictoryAnimations(); AP.audio.play("button"); closePopup("popup-victory"); AP.game.next(); });
    $("btn-victory-replay").addEventListener("click", () => { isCelebrating = false; const hint = $("victory-skip-hint"); if (hint) hint.classList.remove("show"); clearVictoryAnimations(); AP.audio.play("button"); closePopup("popup-victory"); AP.game.restart(); });
    $("btn-victory-menu").addEventListener("click", () => { isCelebrating = false; const hint = $("victory-skip-hint"); if (hint) hint.classList.remove("show"); clearVictoryAnimations(); AP.audio.play("button"); closePopup("popup-victory"); AP.game.toMenu(); });

    // Skip victory celebration when tapping anywhere
    window.addEventListener("pointerdown", (e) => {
      if (isCelebrating) {
        if (e.target.closest("#btn-next-level") || e.target.closest("#btn-victory-replay") || e.target.closest("#btn-victory-menu")) {
          return;
        }
        skipVictory();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (isCelebrating && (e.key === " " || e.key === "Enter")) {
        skipVictory();
      }
    });

    // No-moves
    $("btn-nomoves-restart").addEventListener("click", () => { closePopup("popup-nomoves"); AP.game.restart(); });

    // Out of hearts
    $("btn-gameover-retry").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-gameover"); AP.game.restart(); });
    $("btn-gameover-menu").addEventListener("click", () => { AP.audio.play("button"); closePopup("popup-gameover"); AP.game.toMenu(); });

    // Click backdrop to dismiss non-blocking popups (settings/stats/howto/insufficient/nickname/leaderboard)
    ["popup-settings", "popup-stats", "popup-howto", "popup-reset", "popup-insufficient", "popup-nickname", "popup-leaderboard"].forEach((id) => {
      $(id).addEventListener("click", (e) => { if (e.target.id === id) closePopup(id); });
    });
  }

  function toggleSoundQuick() {
    Player.settings.sound = !Player.settings.sound;
    AP.applySettings();
    refreshSoundIcons();
    AP.audio.play("button");
    toast(Player.settings.sound ? "Sound on" : "Sound off");
  }

  function init() {
    cache();
    bindEvents();
  }

  AP.ui = {
    init, showScreen, openPopup, closePopup, closeAllPopups, toast, showMilestone,
    setRemaining, setLevelLabel, setHintCount, setUndoEnabled, setHearts,
    refreshSoundIcons, syncSettingsInputs, renderStats, buildLevels,
    showVictory, renderShop, startCelebration, isCelebrating: isCelebratingActive,
    setZoomVisible, resetZoom, refreshGuideButton,
  };
})(window.AP = window.AP || {});
