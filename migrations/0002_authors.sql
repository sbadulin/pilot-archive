-- Author search: who signed what, on which page. See docs/authors-db.md.

-- One author name found in one material. A byline with two names gives two credits.
CREATE TABLE IF NOT EXISTS credits (
  id TEXT PRIMARY KEY,
  issue_year INTEGER NOT NULL CHECK (issue_year BETWEEN 1996 AND 2007),
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
CREATE INDEX IF NOT EXISTS credits_issue ON credits (issue_year, issue_number, issue_serial, sheet);
CREATE INDEX IF NOT EXISTS credits_name ON credits (name_key);

-- What was recognized, by which model, so reruns skip done sheets and refusals get retried.
CREATE TABLE IF NOT EXISTS recognition_runs (
  issue_year INTEGER NOT NULL,
  issue_number TEXT NOT NULL,
  issue_serial TEXT NOT NULL DEFAULT '',
  sheet INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'refused', 'failed')),
  raw_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (issue_year, issue_number, issue_serial, sheet)
);
