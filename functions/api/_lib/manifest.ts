export type CatalogIssue = {
  id: number | string;
  year: number;
  slug: string;
  number: string;
  serial: string;
  date: string;
  dateLabel: string;
  pages: number;
  filename: string;
  source?: string;
  pdfUrl: string;
  coverUrl: string;
};

export type SubmissionRow = {
  id: string;
  year: number;
  number: string;
  serial: string;
  date: string;
  dateLabel: string;
  pages: number;
  filename: string;
  storageKey: string;
};

const identity = (issue: { year: number; number: string; serial: string }) => `${Number(issue.year)}/${Number(issue.number)}/${Number(issue.serial)}`;

export function submissionIssue(row: SubmissionRow, publicBase: string): CatalogIssue {
  const base = publicBase.replace(/\/$/, '');
  return {
    id: row.id,
    year: row.year,
    slug: `submission-${row.id}`,
    number: row.number,
    serial: row.serial,
    date: row.date,
    dateLabel: row.dateLabel,
    pages: row.pages,
    filename: row.filename,
    source: 'submission',
    pdfUrl: `${base}/published/${row.storageKey}`,
    coverUrl: `${base}/published/${row.storageKey}.cover.jpg`,
  };
}

// The published manifest is the migrated archive with approved submissions layered
// on top, keyed by year/number/serial. Rebuilding it from issue_submissions alone
// erases every issue that predates the admin panel.
export function composeManifest(base: CatalogIssue[], submissions: SubmissionRow[], publicBase: string, version = Date.now()) {
  const merged = new Map(base.map(issue => [identity(issue), issue]));
  for (const row of submissions) merged.set(identity(row), submissionIssue(row, publicBase));
  const issues = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.number) - Number(b.number));
  return { version, issues };
}
