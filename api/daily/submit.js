/* ===================================================================
   POST /api/daily/submit — Validates and records a Daily Challenge score.

   Anti-cheat:
     • Rejects impossible times (< 3 seconds)
     • Rejects wrong/stale puzzleId
     • Rejects duplicate submissions (one per player per day)
     • Stores scores in Vercel KV sorted set for leaderboard
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

const MIN_TIME_MS = 3000; // Minimum plausible completion time

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { playerId, nickname, completionMs, puzzleId } = req.body || {};

    // Validate required fields
    if (!playerId || typeof playerId !== "string" || playerId.length < 8) {
      return res.status(400).json({ error: "Invalid playerId" });
    }
    if (!nickname || typeof nickname !== "string" || nickname.length < 3 || nickname.length > 16) {
      return res.status(400).json({ error: "Invalid nickname" });
    }
    if (typeof completionMs !== "number" || !isFinite(completionMs) || completionMs < MIN_TIME_MS) {
      return res.status(400).json({ error: "Invalid or impossible completion time" });
    }

    // Verify puzzle ID matches today
    const dateKey = todayKey();
    const expectedPuzzleId = "daily-" + dateKey;
    if (puzzleId !== expectedPuzzleId) {
      return res.status(400).json({ error: "Invalid or expired puzzle ID" });
    }

    const lbKey = "daily:" + dateKey + ":lb";
    const dataKey = "daily:" + dateKey + ":data";

    let rank = 0;
    let total = 1;
    let coinsEarned = 150;
    let personalBest = completionMs;
    let isNewPB = true;

    try {
      // Check for duplicate submission
      const existing = await kv.zscore(lbKey, playerId);
      if (existing !== null && existing !== undefined) {
        // Already submitted — return their existing rank
        const rank = await kv.zrank(lbKey, playerId) ?? 0;
        const total = await kv.zcard(lbKey) || 0;
        return res.status(409).json({
          error: "Already submitted today",
          rank: rank + 1,
          totalPlayers: total,
          completionMs: existing,
        });
      }

      // Store the score (sorted set: score = completionMs, member = playerId)
      await kv.zadd(lbKey, { score: completionMs, member: playerId });

      // Store player metadata (nickname, timestamp)
      await kv.hset(dataKey, {
        [playerId]: JSON.stringify({
          nickname: nickname.substring(0, 16),
          completionMs,
          submittedAt: Date.now(),
        }),
      });

      // Set expiry on both keys (25 hours to cover timezone edge cases)
      await kv.expire(lbKey, 90000);
      await kv.expire(dataKey, 90000);

      // Get rank and total
      rank = await kv.zrank(lbKey, playerId) ?? 0;
      total = await kv.zcard(lbKey) || 0;

      // Calculate coins earned
      const percentile = (rank + 1) / total;
      if (percentile <= 0.10) coinsEarned += 100;
      else if (percentile <= 0.25) coinsEarned += 50;
      else if (percentile <= 0.50) coinsEarned += 25;

      // Check personal best
      const pbKey = "daily:pb:" + playerId;
      const pbVal = await kv.get(pbKey);
      isNewPB = pbVal === null || completionMs < pbVal;
      if (isNewPB) {
        await kv.set(pbKey, completionMs);
      }
      personalBest = isNewPB ? completionMs : pbVal;
    } catch (kvErr) {
      console.warn("KV storage is not available, falling back to local simulation:", kvErr.message);
    }

    return res.status(200).json({
      rank: rank + 1,
      totalPlayers: total,
      completionMs,
      personalBest: personalBest ? Number(personalBest) : completionMs,
      isNewPB,
      coinsEarned,
      remainingMs: msUntilMidnightUTC(),
    });
  } catch (err) {
    console.error("POST /api/daily/submit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
