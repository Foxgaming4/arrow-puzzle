-- Supabase Leaderboard Table Schema
-- Run this in your Supabase SQL Editor to set up the daily challenge database.

CREATE TABLE IF NOT EXISTS daily_leaderboard (
    id BIGSERIAL PRIMARY KEY,
    player_id VARCHAR(255) NOT NULL,
    nickname VARCHAR(16) NOT NULL,
    completion_ms INTEGER NOT NULL,
    date_key INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_player_date UNIQUE (date_key, player_id)
);

-- Index for fast leaderboard retrieval
CREATE INDEX IF NOT EXISTS idx_leaderboard_date_score 
    ON daily_leaderboard (date_key, completion_ms ASC);

-- Index for looking up player history/personal best
CREATE INDEX IF NOT EXISTS idx_leaderboard_player 
    ON daily_leaderboard (player_id);
