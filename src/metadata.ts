declare global { interface Window { PILOT_ARCHIVE_ORIGIN?: string } }
const assetUrl = (path: string) => /^https:\/\//.test(path) ? path : `${typeof window === 'undefined' ? '' : (window.PILOT_ARCHIVE_ORIGIN || '').replace(/\/$/, '')}${path}`;
export type Issue = { id: number | string; year: number; slug: string; number: string; serial: string; date: string; dateLabel: string; pages: number; filename: string; pdfUrl?: string; coverUrl?: string; source?: 'static' | 'submission' };
export const issues: Issue[] = [
  { id: 1, year: 2000, slug: 'issue-01-0066', number: '01', serial: '0066', date: '2000-01-05', dateLabel: '5 января 2000', pages: 15, filename: 'ПП №01(0066)-5.01.2000.pdf' },
  { id: 2, year: 2000, slug: 'issue-02-0067', number: '02', serial: '0067', date: '2000-01-12', dateLabel: '12 января 2000', pages: 15, filename: 'ПП №02(0067)-12.01.2000.pdf' },
  { id: 5, year: 2000, slug: 'issue-03-0068', number: '03', serial: '0068', date: '2000-01-19', dateLabel: '19 января 2000', pages: 15, filename: 'ПП №03(0068)-19.01.2000.pdf' },
  { id: 6, year: 2000, slug: 'issue-04-0069', number: '04', serial: '0069', date: '2000-01-26', dateLabel: '26 января 2000', pages: 15, filename: 'ПП №04(0069)-26.01.2000.pdf' },
  { id: 7, year: 2000, slug: 'issue-05-0070', number: '05', serial: '0070', date: '2000-02-02', dateLabel: '2 февраля 2000', pages: 15, filename: 'ПП №05(0070)-02.02.2000.pdf' },
  { id: 8, year: 2000, slug: 'issue-06-0071', number: '06', serial: '0071', date: '2000-02-09', dateLabel: '9 февраля 2000', pages: 15, filename: 'ПП №06(0071)-09.02.2000.pdf' },
  { id: 3, year: 2000, slug: 'issue-13-0078', number: '13', serial: '0078', date: '2000-03-29', dateLabel: '29 марта 2000', pages: 19, filename: 'пилот (1).pdf' },
  { id: 4, year: 2002, slug: 'issue-32-0201', number: '32', serial: '0201', date: '2002-12-01', dateLabel: 'декабрь 2002', pages: 32, filename: '2026.06.07_PP0201_2002.12.pdf' },
];
export const issuePdfUrl = (issue: Issue) => issue.pdfUrl ? assetUrl(issue.pdfUrl) : (issue.source === 'submission' ? `/api/issues/${issue.id}/file` : assetUrl(`/archive/${issue.year}/${issue.slug}/issue.pdf`));
export const scanUrl = (issue: Issue, _page = 1) => issue.coverUrl ? assetUrl(issue.coverUrl) : assetUrl(`/archive/${issue.year}/${issue.slug}/cover.jpg`);
export function parseFilename(name: string) {
  const number = name.match(/№\s*(\d+)(?:\s*\((\d+)\))?/);
  const date = name.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return {
    number: number?.[1] ?? '', serial: number?.[2] ?? '',
    date: date ? `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}` : '',
  };
}
export function validateMetadata(date: string, number: string, serial: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Укажите дату выхода выпуска.';
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return 'Проверьте дату: такого дня нет в календаре.';
  if (Number(date.slice(0, 4)) < 1996 || Number(date.slice(0, 4)) > 2007) return 'В архиве собираем выпуски за 1996–2007 годы.';
  if (!/^\d{1,3}$/.test(number) || Number(number) < 1) return 'Укажите номер выпуска, например 01.';
  if (serial && (!/^\d{1,5}$/.test(serial) || Number(serial) < 1)) return 'Проверьте сквозной номер, например 0066.';
  return '';
}
