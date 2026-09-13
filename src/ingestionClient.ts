import type { Issue } from './metadata';

declare global { interface Window { PILOT_API_ORIGIN?: string } }

const apiUrl = (path: string) => `${(window.PILOT_API_ORIGIN ?? '').replace(/\/$/, '')}${path}`;

export type Submission = {
  id: string;
  year: number;
  number: string;
  serial: string;
  date: string;
  dateLabel: string;
  filename: string;
  pages: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  submittedBy?: string;
  rejectionReason?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), { ...init, credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Ошибка запроса: ${response.status}`);
  return payload as T;
}

export async function sendSubmission(file: File, metadata: { year: number; number: string; serial: string; date: string; dateLabel: string; pages: number }, cover?: Blob) {
  const created = await jsonRequest<{ id: string; status: string; storageMode?: 'selectel' | 'r2'; uploadUrl?: string | null; coverUploadUrl?: string | null }>('/api/admin/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...metadata, filename: file.name }) });
  if (created.storageMode === 'selectel' && created.uploadUrl) {
    const upload = await fetch(created.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: file });
    if (!upload.ok) throw new Error(`Не удалось загрузить PDF в хранилище: ${upload.status}`);
    if (cover && created.coverUploadUrl) {
      const coverUpload = await fetch(created.coverUploadUrl, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: cover });
      if (!coverUpload.ok) throw new Error(`Не удалось загрузить обложку: ${coverUpload.status}`);
    }
    return { id: created.id, status: created.status };
  }
  return jsonRequest<{ id: string; status: string }>(`/api/admin/submissions/${created.id}/file`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(file.size) }, body: file });
}

export async function loadSubmissionQueue() { return jsonRequest<{ submissions: Submission[] }>('/api/admin/submissions'); }
export async function approveSubmission(id: string) { return jsonRequest(`/api/admin/submissions/${id}/approve`, { method: 'POST' }); }
export async function rejectSubmission(id: string, reason: string) { return jsonRequest(`/api/admin/submissions/${id}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) }); }

export function submissionToIssue(item: Submission): Issue {
  return { id: item.id, year: item.year, slug: `submission-${item.id}`, number: item.number, serial: item.serial, date: item.date, dateLabel: item.dateLabel, pages: item.pages, filename: item.filename, source: 'submission' };
}

export async function loadSubmissionPdf(id: string) {
  const response = await fetch(apiUrl(`/api/admin/submissions/${id}/file`), { credentials: 'include' });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? `Ошибка загрузки PDF: ${response.status}`); }
  return response.arrayBuffer();
}
