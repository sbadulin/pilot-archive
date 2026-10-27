-- The 2025 special issue (number 00, serial 0000) falls outside 1996–2007. SQLite cannot
-- alter a CHECK, so both tables with a year CHECK are rebuilt with the bound raised to 2025.
-- Everything else (columns, defaults, other CHECKs, UNIQUE, indexes) is as in 0001 and 0002.

CREATE TABLE issue_submissions_new (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year BETWEEN 1996 AND 2025),
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
INSERT INTO issue_submissions_new (id, year, number, serial, date, date_label, filename, pages, storage_key, status, submitted_by, rejection_reason, created_at, updated_at, published_at)
  SELECT id, year, number, serial, date, date_label, filename, pages, storage_key, status, submitted_by, rejection_reason, created_at, updated_at, published_at
  FROM issue_submissions;
DROP TABLE issue_submissions;
ALTER TABLE issue_submissions_new RENAME TO issue_submissions;
CREATE UNIQUE INDEX IF NOT EXISTS issue_submissions_identity
  ON issue_submissions (year, number, serial);
CREATE INDEX IF NOT EXISTS issue_submissions_status
  ON issue_submissions (status, created_at DESC);

CREATE TABLE credits_new (
  id TEXT PRIMARY KEY,
  issue_year INTEGER NOT NULL CHECK (issue_year BETWEEN 1996 AND 2025),
  issue_number TEXT NOT NULL,
  issue_serial TEXT NOT NULL DEFAULT '',
  sheet INTEGER NOT NULL CHECK (sheet >= 1),
  -- Printed page number used in reader links (#issue-YYYY-NN-SSSS-pN).
  printed_page INTEGER NOT NULL CHECK (printed_page >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('article', 'letter', 'pager', 'photo', 'drawing', 'other')),
  title TEXT,
  byline TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Normalized name used for search and grouping (see normalizeName in docs/authors-db.md).
  name_key TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('auto', 'confirmed', 'hidden')) DEFAULT 'auto',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO credits_new (id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at)
  SELECT id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at
  FROM credits;
DROP TABLE credits;
ALTER TABLE credits_new RENAME TO credits;
CREATE INDEX IF NOT EXISTS credits_issue ON credits (issue_year, issue_number, issue_serial, sheet);
CREATE INDEX IF NOT EXISTS credits_name ON credits (name_key);
