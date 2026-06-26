/* ===================================================================
   GET /api/daily/leaderboard — Returns top 100 + requesting player rank.

   Interfaces with daily_leaderboard in Supabase via _db.js.
   =================================================================== */

const db = require("./_db");

function todayKey() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const playerId = req.query.playerId || "";
    const reqKey = req.query.dateKey ? Number(req.query.dateKey) : null;
    const dateKey = (reqKey && !isNaN(reqKey)) ? reqKey : todayKey();

    const lb = await db.getLeaderboard(dateKey, playerId);

    return res.status(200).json({
      entries: lb.entries,
      playerRank: lb.playerRank,
      playerScore: lb.playerScore,
      totalPlayers: lb.totalPlayers,
    });
  } catch (err) {
    console.error("GET /api/daily/leaderboard error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
