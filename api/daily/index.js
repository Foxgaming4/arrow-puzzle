/* ===================================================================
   GET /api/daily — Returns today's Daily Challenge puzzle config.

   Supports client-local timezone dateKey (e.g. ?dateKey=YYYYMMDD).
   If absent, defaults to server UTC dateKey.
   =================================================================== */

const db = require("./_db");

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
  // Parse year, month, day from YYYYMMDD to get the correct day of week
  const year = Math.floor(dateKey / 10000);
  const month = Math.floor((dateKey % 10000) / 100) - 1;
  const day = dateKey % 100;
  const dateObj = new Date(year, month, day);
  const dow = isNaN(dateObj.getTime()) ? new Date().getDay() : dateObj.getDay();

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
    const reqKey = req.query.dateKey ? Number(req.query.dateKey) : null;
    const dateKey = (reqKey && !isNaN(reqKey)) ? reqKey : todayKey();
    const config = getDailyConfig(dateKey);
    
    // Get total players for today
    const totalPlayers = await db.getPlayerCount(dateKey);

    return res.status(200).json({
      ...config,
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
