/* ===================================================================
   GET /api/daily — Returns today's Daily Challenge puzzle config.

   The puzzle is deterministic: the seed is derived from the UTC date
   so every player worldwide gets the exact same board each day.
   =================================================================== */

const { kv } = require("./_store");

function todayKey() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function msUntilMidnightUTC() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime() - now.getTime();
}

// Difficulty rotates by day of week (0=Sun ... 6=Sat)
function getDailyConfig(dateKey) {
  const dow = new Date().getUTCDay();
  const SHAPES = ["full", "diamond", "circle", "heart", "star", "triangle", "hexagon", "apple", "plus"];

  let size, maxLen, turnProb;
  if (dow <= 1) {        // Sun-Mon: Hard
    size = 15; maxLen = 5; turnProb = 0.5;
  } else if (dow <= 3) { // Tue-Wed: Expert
    size = 16; maxLen = 6; turnProb = 0.6;
  } else if (dow <= 5) { // Thu-Fri: Master
    size = 18; maxLen = 6; turnProb = 0.65;
  } else {               // Sat: Extreme
    size = 20; maxLen = 7; turnProb = 0.7;
  }

  const difficulties = ["Hard", "Hard", "Expert", "Expert", "Master", "Master", "Extreme"];
  const shape = SHAPES[dateKey % SHAPES.length];
  const seed = (dateKey * 2654435761) >>> 0;

  return {
    puzzleId: "daily-" + dateKey,
    seed,
    size,
    shape,
    maxLen,
    turnProb,
    hearts: 3,
    hintsEnabled: false,
    difficulty: difficulties[dow],
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const dateKey = todayKey();
    const config = getDailyConfig(dateKey);
    const remainingMs = msUntilMidnightUTC();

    // Get total players for today (if KV is available)
    let totalPlayers = 0;
    try {
      totalPlayers = await kv.zcard("daily:" + dateKey + ":lb") || 0;
    } catch (e) {
      // KV not configured yet — still return the puzzle
    }

    return res.status(200).json({
      ...config,
      remainingMs,
      totalPlayers,
      rewards: {
        completion: 150,
        top50: 25,
        top25: 50,
        top10: 100,
      },
    });
  } catch (err) {
    console.error("GET /api/daily error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
