/* ===================================================================
   POST /api/daily/submit — Validates and records a Daily Challenge score.

   Interfaces with daily_leaderboard in Supabase via _db.js.
   =================================================================== */

const db = require("./_db");

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

    // Verify and parse puzzle ID
    const match = /^daily-(\d{8})$/.exec(puzzleId);
    if (!match) {
      return res.status(400).json({ error: "Invalid puzzle ID format" });
    }
    const dateKey = Number(match[1]);

    // Check for duplicate submission
    const existingTime = await db.getExistingSubmission(dateKey, playerId);
    if (existingTime !== null) {
      // Re-fetch rankings for already submitted score
      const lb = await db.getLeaderboard(dateKey, playerId);
      return res.status(409).json({
        error: "Already submitted today",
        rank: lb.playerRank,
        totalPlayers: lb.totalPlayers,
        completionMs: existingTime,
      });
    }

    // Submit score
    const result = await db.submitScore({ playerId, nickname, completionMs, dateKey });

    // Calculate coins earned
    let coinsEarned = 150; // base completion
    const percentile = result.totalPlayers > 0 ? result.rank / result.totalPlayers : 1;
    if (percentile <= 0.10) coinsEarned += 100;
    else if (percentile <= 0.25) coinsEarned += 50;
    else if (percentile <= 0.50) coinsEarned += 25;

    const isNewPB = result.personalBest === completionMs;

    return res.status(200).json({
      rank: result.rank,
      totalPlayers: result.totalPlayers,
      completionMs,
      personalBest: result.personalBest,
      isNewPB,
      coinsEarned,
    });
  } catch (err) {
    console.error("POST /api/daily/submit error:", err);
    if (err.message === "Duplicate submission") {
      return res.status(409).json({ error: "Already submitted today" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};
