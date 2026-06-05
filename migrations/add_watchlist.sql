-- Shared, club-wide watchlist of candidate UK shares (separate from holdings).
-- One row per watched stock; everyone using the site adds to / removes from it.
--
-- target_buy is the only per-row value users edit (a price alert threshold in
-- pounds). Everything else on the Watchlist page (price, day move, trend, 52-week
-- range, risk score, news) is derived live and never stored.

CREATE TABLE IF NOT EXISTS watchlist (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker        TEXT NOT NULL UNIQUE,        -- stored with .L suffix, e.g. 'REL.L'
  name          TEXT NOT NULL,
  nominated_by  TEXT,                        -- club member who put the stock forward
  target_buy    NUMERIC,                     -- nullable; price alert threshold (£)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For databases where the table already exists (created by an earlier version
-- of this migration), add the column. Safe to re-run.
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS nominated_by TEXT;

-- Access is gated by the shared site password at the app layer (same as the
-- other tables this dashboard reads/writes with the anon key), so row-level
-- security is left off. Without this the anon key can't insert (error 42501).
ALTER TABLE watchlist DISABLE ROW LEVEL SECURITY;

-- Seed with the stocks from the reference design. Safe to re-run.
INSERT INTO watchlist (ticker, name) VALUES
  ('REL.L',  'RELX PLC'),
  ('SRT.L',  'SRT Marine Systems plc'),
  ('BBY.L',  'Balfour Beatty plc'),
  ('BOKU.L', 'Boku, Inc.'),
  ('FNX.L',  'Fonix Mobile PLC')
ON CONFLICT (ticker) DO NOTHING;
