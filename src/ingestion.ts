export type SubmissionStatus = 'draft' | 'pending' | 'approved' | 'rejected';
export type SubmissionRole = 'volunteer' | 'curator';

export type IssueSubmission = {
  id: string;
  year: number;
  number: string;
  serial: string;
  date: string;
  dateLabel: string;
  filename: string;
  pages: number;
  storageKey: string;
  status: SubmissionStatus;
  submittedBy: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export function parseAllowlist(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
}

export function roleForEmail(email: string | null | undefined, env: { VOLUNTEER_EMAILS?: string; CURATOR_EMAILS?: string; BANNED_EMAILS?: string; PUBLIC_SUBMISSIONS?: string }): SubmissionRole | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (parseAllowlist(env.BANNED_EMAILS).has(normalized)) return null;
  if (parseAllowlist(env.CURATOR_EMAILS).has(normalized)) return 'curator';
  if (parseAllowlist(env.VOLUNTEER_EMAILS).has(normalized)) return 'volunteer';
  if (env.PUBLIC_SUBMISSIONS?.trim().toLowerCase() === 'true') return 'volunteer';
  return null;
}

export function canSubmit(role: SubmissionRole | null) { return role === 'volunteer' || role === 'curator'; }
export function canPublish(role: SubmissionRole | null) { return role === 'curator'; }

export function isoNow() { return new Date().toISOString(); }

export function normalizeSubmissionNumber(value: string) {
  return value.trim().replace(/^0+(?=\d)/, '').padStart(2, '0');
}

export function submissionIdentity(year: number, number: string, serial: string) {
  return `${year}-${normalizeSubmissionNumber(number)}-${serial.trim().replace(/^0+(?=\d)/, '').padStart(4, '0')}`;
}
