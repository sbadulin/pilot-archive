export function validateIssueInput(input: any) {
  const year = Number(input?.year);
  const number = String(input?.number ?? '').trim();
  const serial = String(input?.serial ?? '').trim();
  const date = String(input?.date ?? '').trim();
  const dateLabel = String(input?.dateLabel ?? '').trim();
  const filename = String(input?.filename ?? '').trim();
  const pages = Number(input?.pages);
  if (!Number.isInteger(year) || year < 1996 || year > 2007) return 'Год должен быть в диапазоне 1996–2007.';
  if (!/^\d{1,3}$/.test(number) || Number(number) < 1) return 'Проверьте номер выпуска.';
  if (serial && !/^\d{1,5}$/.test(serial)) return 'Проверьте сквозной номер.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return 'Проверьте дату выпуска.';
  if (!dateLabel || !filename.toLowerCase().endsWith('.pdf')) return 'Нужны дата, имя PDF и подпись даты.';
  if (!Number.isInteger(pages) || pages < 1 || pages > 100) return 'Выпуск должен содержать от 1 до 100 листов.';
  return '';
}

export function issueSlug(number: string, serial: string) {
  const normalizedNumber = number.replace(/^0+(?=\d)/, '').padStart(2, '0');
  const normalizedSerial = serial.replace(/^0+(?=\d)/, '').padStart(4, '0');
  return `issue-${normalizedNumber}-${normalizedSerial}`;
}

// Moderation staging. Lives in the private bucket under pending/ or rejected/.
export function issueKey(year: number, number: string, serial: string, id: string) {
  return `submissions/${year}/${issueSlug(number, serial)}/${id}.pdf`;
}

// Published location. Approved issues join the same archive/<year>/<slug>/ tree as the
// migrated originals; the submission id keeps a republished issue from overwriting one.
export function archiveKey(year: number, number: string, serial: string, id: string) {
  return `archive/${year}/${issueSlug(number, serial)}/issue-${id}.pdf`;
}

export function archiveCoverKey(year: number, number: string, serial: string, id: string) {
  return `archive/${year}/${issueSlug(number, serial)}/cover-${id}.jpg`;
}
