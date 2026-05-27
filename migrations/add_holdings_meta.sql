-- Adds the reference fields the monthly brief needs to pre-compute the index
-- breakdown card and inject accurate per-holding facts into the DeepSeek prompt.
--
-- index_group: 'FTSE100' | 'FTSE250' | 'AIM' | 'Other'  (defaults to 'Other' so
--              unseeded holdings still aggregate cleanly into the index cards)
-- revenue_mix: 'Global' | 'Domestic' | 'Mixed' | NULL    (NULL = let the model
--              describe it from its own knowledge)

ALTER TABLE holdings ADD COLUMN IF NOT EXISTS index_group TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS revenue_mix TEXT;

-- Seed current portfolio. Safe to re-run.
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Global'   WHERE ticker IN ('BA.L',   'BA');
UPDATE holdings SET index_group = 'FTSE250', revenue_mix = 'Domestic' WHERE ticker IN ('BREE.L', 'BREE');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Global'   WHERE ticker IN ('CLBS.L', 'CLBS');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Global'   WHERE ticker IN ('CWR.L',  'CWR');
UPDATE holdings SET index_group = 'FTSE250', revenue_mix = 'Global'   WHERE ticker IN ('CHG.L',  'CHG');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Mixed'    WHERE ticker IN ('CHRT.L', 'CHRT');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Global'   WHERE ticker IN ('GGP.L',  'GGP');
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Global'   WHERE ticker IN ('IAG.L',  'IAG');
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Domestic' WHERE ticker IN ('LLOY.L', 'LLOY');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Domestic' WHERE ticker IN ('MACF.L', 'MACF');
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Global'   WHERE ticker IN ('MRO.L',  'MRO');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Global'   WHERE ticker IN ('MAST.L', 'MAST');
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Global'   WHERE ticker IN ('REL.L',  'REL');
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Global'   WHERE ticker IN ('RR.L',   'RR');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Mixed'    WHERE ticker IN ('WIL.L',  'WIL');
UPDATE holdings SET index_group = 'FTSE100', revenue_mix = 'Global'   WHERE ticker IN ('WISE.L', 'WISE');
UPDATE holdings SET index_group = 'AIM',     revenue_mix = 'Global'   WHERE ticker IN ('AET.L',  'AET');
