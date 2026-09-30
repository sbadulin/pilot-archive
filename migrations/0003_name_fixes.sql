-- Curator corrections of recognized names. They survive re-recognition: every import
-- applies them to the fresh credits. See docs/authors-db.md.
CREATE TABLE IF NOT EXISTS name_fixes (
  -- Name exactly as recognized.
  wrong TEXT PRIMARY KEY,
  "right" TEXT NOT NULL,
  right_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Gemini read «Васисуалий» without its second «с» in two issues; the scans are correct.
INSERT OR IGNORE INTO name_fixes (wrong, "right", right_key, created_by, created_at)
VALUES ('Васиуалий ЛОПАТА', 'Васисуалий ЛОПАТА', 'васисуалий лопата', 'import', '2026-09-30T00:00:00.000Z');
