const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase if env vars are present
let supabase = null;
if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  supabase = createClient(process.env.SUPABASE_URL, key);
}

// Fallback in-memory store for local dev
if (!global.__dailyMemStore) {
  global.__dailyMemStore = {
    // Array of { playerId, nickname, completionMs, dateKey, createdAt }
    scores: []
  };
}
const memDb = global.__dailyMemStore;

const db = {
  // Check if player has already submitted for this dateKey
  async getExistingSubmission(dateKey, playerId) {
    if (supabase) {
      const { data, error } = await supabase
        .from("daily_leaderboard")
        .select("completion_ms")
        .eq("date_key", dateKey)
        .eq("player_id", playerId)
        .maybeSingle();
      if (error) throw error;
      return data ? data.completion_ms : null;
    } else {
      const found = memDb.scores.find(s => s.dateKey === dateKey && s.playerId === playerId);
      return found ? found.completionMs : null;
    }
  },

  // Save new score, returning results
  async submitScore({ playerId, nickname, completionMs, dateKey }) {
    if (supabase) {
      // 1. Insert score
      const { error } = await supabase
        .from("daily_leaderboard")
        .insert({
          player_id: playerId,
          nickname: nickname.substring(0, 16),
          completion_ms: completionMs,
          date_key: dateKey
        });
      if (error) {
        // If duplicate key violation
        if (error.code === "23505") {
          throw new Error("Duplicate submission");
        }
        throw error;
      }

      // 2. Get rank (number of players with smaller completionMs on this dateKey)
      const { count: rankCount, error: rankErr } = await supabase
        .from("daily_leaderboard")
        .select("id", { count: "exact", head: true })
        .eq("date_key", dateKey)
        .lt("completion_ms", completionMs);
      if (rankErr) throw rankErr;
      const rank = (rankCount || 0) + 1;

      // 3. Get total players today
      const { count: total, error: totalErr } = await supabase
        .from("daily_leaderboard")
        .select("id", { count: "exact", head: true })
        .eq("date_key", dateKey);
      if (totalErr) throw totalErr;

      // 4. Get personal best
      const { data: pbData, error: pbErr } = await supabase
        .from("daily_leaderboard")
        .select("completion_ms")
        .eq("player_id", playerId)
        .order("completion_ms", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (pbErr) throw pbErr;
      const personalBest = pbData ? pbData.completion_ms : completionMs;

      return {
        rank,
        totalPlayers: total || 1,
        personalBest
      };
    } else {
      // In-memory implementation
      const exists = memDb.scores.some(s => s.dateKey === dateKey && s.playerId === playerId);
      if (exists) throw new Error("Duplicate submission");

      const entry = {
        playerId,
        nickname: nickname.substring(0, 16),
        completionMs,
        dateKey,
        createdAt: new Date().toISOString()
      };
      memDb.scores.push(entry);

      const dayScores = memDb.scores.filter(s => s.dateKey === dateKey).sort((a, b) => a.completionMs - b.completionMs);
      const rank = dayScores.findIndex(s => s.playerId === playerId) + 1;
      const total = dayScores.length;

      const playerScores = memDb.scores.filter(s => s.playerId === playerId);
      const personalBest = Math.min(...playerScores.map(s => s.completionMs));

      return {
        rank,
        totalPlayers: total,
        personalBest
      };
    }
  },

  // Get leaderboard top 100 + player rank
  async getLeaderboard(dateKey, playerId) {
    if (supabase) {
      // 1. Get top 100 entries
      const { data: entries, error: entriesErr } = await supabase
        .from("daily_leaderboard")
        .select("nickname, completion_ms, created_at")
        .eq("date_key", dateKey)
        .order("completion_ms", { ascending: true })
        .limit(100);
      if (entriesErr) throw entriesErr;

      // Map structure to return
      const leaderboardEntries = (entries || []).map((e, idx) => ({
        nickname: e.nickname,
        completionMs: e.completion_ms,
        rank: idx + 1
      }));

      // 2. Get specific player's score & rank
      let playerRank = null;
      let playerScore = null;
      if (playerId) {
        const { data: pScore, error: scoreErr } = await supabase
          .from("daily_leaderboard")
          .select("completion_ms")
          .eq("date_key", dateKey)
          .eq("player_id", playerId)
          .maybeSingle();
        if (scoreErr) throw scoreErr;

        if (pScore) {
          playerScore = pScore.completion_ms;
          const { count: rankCount, error: rankErr } = await supabase
            .from("daily_leaderboard")
            .select("id", { count: "exact", head: true })
            .eq("date_key", dateKey)
            .lt("completion_ms", playerScore);
          if (rankErr) throw rankErr;
          playerRank = (rankCount || 0) + 1;
        }
      }

      // 3. Get total players
      const { count: total, error: totalErr } = await supabase
        .from("daily_leaderboard")
        .select("id", { count: "exact", head: true })
        .eq("date_key", dateKey);
      if (totalErr) throw totalErr;

      return {
        entries: leaderboardEntries,
        playerRank,
        playerScore,
        totalPlayers: total || 0
      };
    } else {
      // In-memory implementation
      const dayScores = memDb.scores
        .filter(s => s.dateKey === dateKey)
        .sort((a, b) => a.completionMs - b.completionMs);

      const entries = dayScores.slice(0, 100).map((s, idx) => ({
        nickname: s.nickname,
        completionMs: s.completionMs,
        rank: idx + 1
      }));

      const playerIdx = dayScores.findIndex(s => s.playerId === playerId);
      const playerRank = playerIdx >= 0 ? playerIdx + 1 : null;
      const playerScore = playerIdx >= 0 ? dayScores[playerIdx].completionMs : null;

      return {
        entries,
        playerRank,
        playerScore,
        totalPlayers: dayScores.length
      };
    }
  },

  // Get total player count for today
  async getPlayerCount(dateKey) {
    if (supabase) {
      const { count, error } = await supabase
        .from("daily_leaderboard")
        .select("id", { count: "exact", head: true })
        .eq("date_key", dateKey);
      if (error) return 0;
      return count || 0;
    } else {
      return memDb.scores.filter(s => s.dateKey === dateKey).length;
    }
  }
};

module.exports = db;
