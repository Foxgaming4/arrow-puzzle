/* ===================================================================
   api/daily/_store.js — In-memory KV fallback for local dev.

   When Vercel KV environment variables are missing, this provides a
   simple sorted-set + hash store that behaves like a subset of Redis.
   Data lives on `global` so it persists across Vercel serverless
   function invocations within the same process (critical for local dev
   where each API file gets a separate require() context).
   In production with KV configured, this module is never used.
   =================================================================== */

// Check if real KV is available
let realKv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = require("@vercel/kv");
    realKv = mod.kv;
  }
} catch (e) { /* @vercel/kv not installed or env missing */ }

// ---- In-memory store (stored on global so all functions share state) ----
if (!global.__dailyMemStore) {
  global.__dailyMemStore = {
    sortedSets: {},  // key -> [{member, score}]
    hashes: {},      // key -> {field: value}
    strings: {},     // key -> value
  };
}
const db = global.__dailyMemStore;

const memStore = {
  // Sorted set: add member with score
  async zadd(key, { score, member }) {
    if (!db.sortedSets[key]) db.sortedSets[key] = [];
    const arr = db.sortedSets[key];
    const idx = arr.findIndex(e => e.member === member);
    if (idx >= 0) arr[idx].score = score;
    else arr.push({ member, score });
    arr.sort((a, b) => a.score - b.score);
  },

  // Get score of a member
  async zscore(key, member) {
    if (!db.sortedSets[key]) return null;
    const entry = db.sortedSets[key].find(e => e.member === member);
    return entry ? entry.score : null;
  },

  // Get 0-based rank (position) of a member
  async zrank(key, member) {
    if (!db.sortedSets[key]) return null;
    const idx = db.sortedSets[key].findIndex(e => e.member === member);
    return idx >= 0 ? idx : null;
  },

  // Number of members
  async zcard(key) {
    return db.sortedSets[key] ? db.sortedSets[key].length : 0;
  },

  // Range with optional scores — returns [member, score, member, score, ...]
  async zrange(key, start, stop, opts) {
    if (!db.sortedSets[key]) return [];
    const slice = db.sortedSets[key].slice(start, stop + 1);
    if (opts && opts.withScores) {
      const out = [];
      for (const e of slice) { out.push(e.member, e.score); }
      return out;
    }
    return slice.map(e => e.member);
  },

  // Hash set
  async hset(key, obj) {
    if (!db.hashes[key]) db.hashes[key] = {};
    Object.assign(db.hashes[key], obj);
  },

  // Hash multi-get
  async hmget(key, ...fields) {
    if (!db.hashes[key]) return fields.map(() => null);
    return fields.map(f => db.hashes[key][f] || null);
  },

  // String get/set
  async get(key) {
    return db.strings[key] !== undefined ? db.strings[key] : null;
  },
  async set(key, value) {
    db.strings[key] = value;
  },

  // Expiry (no-op in memory — data clears on restart anyway)
  async expire() {},
};

module.exports = { kv: realKv || memStore };
