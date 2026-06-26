/* ===================================================================
   GET /api/daily/leaderboard — Returns top 100 + requesting player rank.
   =================================================================== */

const { kv } = require("@vercel/kv");

function todayKey() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function msUntilMidnightUTC() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime() - now.getTime();
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const playerId = req.query.playerId || "";
    const dateKey = todayKey();
    const lbKey = "daily:" + dateKey + ":lb";
    const dataKey = "daily:" + dateKey + ":data";

    let entries = [];
    let playerRank = null;
    let playerScore = null;
    let totalPlayers = 0;

    try {
      // Get top 100 player IDs with scores
      const top100Raw = await kv.zrange(lbKey, 0, 99, { withScores: true });

      // top100Raw is [member, score, member, score, ...]
      const playerIds = [];
      for (let i = 0; i < top100Raw.length; i += 2) {
        playerIds.push(top100Raw[i]);
        entries.push({
          playerId: top100Raw[i],
          completionMs: Number(top100Raw[i + 1]),
          rank: (i / 2) + 1,
          nickname: "Player",
        });
      }

      // Fetch nicknames in bulk
      if (playerIds.length > 0) {
        const metaRaw = await kv.hmget(dataKey, ...playerIds);
        for (let i = 0; i < entries.length; i++) {
          const meta = metaRaw[i];
          if (meta) {
            try {
              const parsed = typeof meta === "string" ? JSON.parse(meta) : meta;
              entries[i].nickname = parsed.nickname || "Player";
            } catch (e) {
              // keep default nickname
            }
          }
        }
      }

      // Get requesting player's rank
      if (playerId) {
        const rank = await kv.zrank(lbKey, playerId);
        if (rank !== null && rank !== undefined) {
          playerRank = rank + 1;
          playerScore = await kv.zscore(lbKey, playerId);
        }
      }

      totalPlayers = await kv.zcard(lbKey) || 0;
    } catch (kvErr) {
      console.warn("KV storage is not available, serving local/empty leaderboard:", kvErr.message);
    }

    return res.status(200).json({
      entries: entries.map(({ playerId: _pid, ...rest }) => rest), // strip internal IDs
      playerRank,
      playerScore: playerScore ? Number(playerScore) : null,
      totalPlayers,
      remainingMs: msUntilMidnightUTC(),
    });
  } catch (err) {
    console.error("GET /api/daily/leaderboard error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
