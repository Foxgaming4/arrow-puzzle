/* ===================================================================
   save-manager.js — The ONE and ONLY gateway to Local Storage.

   No other file in the project may call localStorage.setItem() or
   localStorage.getItem() directly. Everything funnels through here:

     AP.SaveManager.save(obj)     – persist the full save blob (JSON)
     AP.SaveManager.load()        – read + parse the save blob (or null)
     AP.SaveManager.clear()       – delete the save blob
     AP.SaveManager.loadLegacy()  – read the pre-1.1 ("arrowflow:v1") blob
     AP.SaveManager.clearLegacy() – delete the pre-1.1 blob
     AP.SaveManager.SAVE_VERSION  – current schema version (integer)

   This module is intentionally "dumb" about the profile schema. It knows
   nothing about story/stats/settings — it only does safe JSON I/O and
   shields the rest of the game from storage errors:

     • Every read is wrapped: a corrupted/unparsable value returns null
       instead of throwing, so the caller can rebuild a fresh profile.
     • Every write is wrapped: a full or unavailable storage (private mode,
       quota) fails silently and returns false, never crashing gameplay.

   Schema knowledge (defaults, field repair, version migration) lives in
   player.js, which sits one layer above this.
   =================================================================== */
(function (AP) {
  "use strict";

  // Bump SAVE_VERSION whenever the on-disk profile shape changes, then add a
  // matching migration step in player.js so older saves upgrade in place.
  const SAVE_VERSION = 2;

  const KEY = "arrowflow:profile"; // v1.1+ unified Player Profile blob
  const LEGACY_KEY = "arrowflow:v1"; // v1.0 split state (settings/progress/stats)

  // Guard against environments where localStorage is missing or blocked
  // entirely (e.g. some embedded webviews / privacy modes throw on access).
  function store() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  /** Persist the full save blob. Returns true on success, false otherwise. */
  function save(obj) {
    const s = store();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      // Quota exceeded / serialization failure — never surface to the player.
      return false;
    }
  }

  /** Read + parse the save blob. Returns the parsed object, or null when
   *  missing OR corrupted (so the caller rebuilds rather than crashes). */
  function load() {
    return readKey(KEY);
  }

  /** Delete the current save blob. */
  function clear() {
    const s = store();
    if (!s) return;
    try { s.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  /** Read the legacy (pre-1.1) blob for one-time migration. */
  function loadLegacy() {
    return readKey(LEGACY_KEY);
  }

  /** Delete the legacy blob once it has been migrated. */
  function clearLegacy() {
    const s = store();
    if (!s) return;
    try { s.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
  }

  // Shared safe read: returns parsed object, or null on missing/corrupt/error.
  function readKey(key) {
    const s = store();
    if (!s) return null;
    let raw = null;
    try { raw = s.getItem(key); } catch (e) { return null; }
    if (raw == null || raw === "") return null;
    try {
      const parsed = JSON.parse(raw);
      // Only objects are valid save blobs; anything else is treated as corrupt.
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      // Corrupted JSON — swallow it; the caller will create a fresh profile.
      return null;
    }
  }

  AP.SaveManager = { SAVE_VERSION, save, load, clear, loadLegacy, clearLegacy };
})(window.AP = window.AP || {});
