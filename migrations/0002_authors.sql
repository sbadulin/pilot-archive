-- Authors index: who wrote what, on which page. See docs/authors-db.md.

-- A person or collective as shown on the site. Pseudonyms of one person share one author.
CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  note TEXT,
  -- Set when a curator merges this author into another; old links keep resolving.
  merged_into TEXT REFERENCES authors(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every spelling an author signed with: real name, initials, pseudonyms, OCR variants.
CREATE TABLE IF NOT EXISTS author_aliases (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES authors(id),
  alias TEXT NOT NULL,
  -- Normalized form used for matching (see normalizeAlias in docs/authors-db.md).
  alias_key TEXT NOT NULL,
  -- Common first names ("Лена", "Настя") are never auto-linked to one person.
  ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (author_id, alias_key)
);
CREATE INDEX IF NOT EXISTS author_aliases_key ON author_aliases (alias_key);

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
  -- NULL until linked: pager/letter names stay searchable without creating an author.
  alias_id TEXT REFERENCES author_aliases(id),
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('auto', 'confirmed', 'hidden')) DEFAULT 'auto',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credits_issue ON credits (issue_year, issue_number, issue_serial, sheet);
CREATE INDEX IF NOT EXISTS credits_alias ON credits (alias_id);

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
