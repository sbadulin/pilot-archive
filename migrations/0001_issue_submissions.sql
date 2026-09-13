CREATE TABLE IF NOT EXISTS issue_submissions (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year BETWEEN 1996 AND 2007),
  number TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  date_label TEXT NOT NULL,
  filename TEXT NOT NULL,
  pages INTEGER NOT NULL CHECK (pages BETWEEN 1 AND 100),
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected')) DEFAULT 'draft',
  submitted_by TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS issue_submissions_identity
  ON issue_submissions (year, number, serial);
CREATE INDEX IF NOT EXISTS issue_submissions_status
  ON issue_submissions (status, created_at DESC);
