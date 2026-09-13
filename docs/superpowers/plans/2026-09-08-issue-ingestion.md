# Protected Issue Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give invited volunteers a safe browser workflow for submitting scanned newspaper PDFs while keeping final publication under curator control.

**Architecture:** Keep the public archive on Cloudflare Pages. Add Pages Functions backed by D1 for issue metadata and R2 for PDF/preview objects. Cloudflare Access protects admin routes, while Functions enforce role allowlists and publication state on the server.

**Tech Stack:** React 18, TypeScript/esbuild, Cloudflare Pages Functions, D1, R2, Cloudflare Access.

**Spec:** `docs/issue-ingestion-spec.md`

## Global Constraints

- Existing public archive URLs and hash deep links must continue to work.
- Only supplied scans and PDFs may be published; no invented issues.
- Volunteer upload remains a browser workflow with PDF validation and page preview.
- A volunteer can create `pending` records but cannot publish them.
- Public API responses contain only `approved` records.
- Existing static deployment remains usable while bindings are not configured.

---

### Task 1: Storage schema and role contract

**Files:**
- Create: `migrations/0001_issue_submissions.sql`
- Create: `src/ingestion.ts`
- Modify: `docs/issue-ingestion-spec.md`

**Interfaces:**
- Produces `IssueSubmission`, `SubmissionStatus`, `parseAllowlist`, and `isAllowedRole` used by Functions and the UI.
- D1 table `issue_submissions` stores `id`, `year`, `number`, `serial`, `date`, `filename`, `pages`, `storage_key`, `status`, `submitted_by`, timestamps, and rejection reason.

- [ ] Add the D1 migration with unique `(year, number, serial)` and status checks.
- [ ] Add TypeScript role/status types and allowlist parsing.
- [ ] Run the TypeScript/esbuild build.
- [ ] Commit `feat: define protected issue submission schema`.

### Task 2: Pages Function API

**Files:**
- Create: `functions/api/issues.ts`
- Create: `functions/api/admin/submissions.ts`
- Create: `functions/api/admin/submissions/[id]/file.ts`
- Create: `functions/api/admin/submissions/[id]/approve.ts`
- Create: `functions/api/admin/submissions/[id]/reject.ts`
- Create: `wrangler.toml`

**Interfaces:**
- `GET /api/issues` returns approved records only.
- `POST /api/admin/submissions` creates a pending record after role validation.
- `PUT /api/admin/submissions/:id/file` streams PDF bytes into the bound R2 bucket.
- `POST /api/admin/submissions/:id/approve` requires curator role.
- `POST /api/admin/submissions/:id/reject` requires curator role and reason.

- [ ] Implement Access-header and env allowlist checks.
- [ ] Implement JSON validation, duplicate detection, size/type checks, and status transitions.
- [ ] Implement R2 object metadata and private storage keys.
- [ ] Add local no-binding errors that explain required Cloudflare configuration.
- [ ] Run build and a local request smoke test.
- [ ] Commit `feat: add protected issue submission API`.

### Task 3: Volunteer and curator UI

**Files:**
- Modify: `src/app.tsx`
- Modify: `src/metadata.ts`
- Modify: `src/style.css`

**Interfaces:**
- Existing upload validation feeds `POST /api/admin/submissions` and then the file PUT endpoint.
- Admin queue renders only when the API authorizes the current user.
- Public archive merges approved API records with bundled records without changing existing URLs.

- [ ] Add upload states: `pending upload`, `sent for review`, `rejected`, and `published`.
- [ ] Add a curator queue with approve/reject controls and rejection reason.
- [ ] Keep a demo fallback when Functions are unavailable, clearly labeled as local-only.
- [ ] Add accessible error/status messaging.
- [ ] Build and verify archive, upload, and reader routes locally.
- [ ] Commit `feat: connect upload form to protected review queue`.

### Task 4: Cloudflare configuration and deployment runbook

**Files:**
- Modify: `wrangler.toml`
- Create: `docs/cloudflare-ingestion.md`
- Modify: `package.json`

**Interfaces:**
- Documents exact commands for creating D1/R2, applying migrations, binding resources, configuring Access allowlists, and deploying with Wrangler.

- [ ] Document `VOLUNTEER_EMAILS` and `CURATOR_EMAILS` variables.
- [ ] Document R2 and D1 bindings and Pages Access paths.
- [ ] Add `db:migrate` and `deploy` scripts without changing the existing build.
- [ ] Deploy a test version to `pilot-archive.pages.dev`.
- [ ] Verify an invited volunteer can submit and an uninvited user is rejected.
- [ ] Commit `docs: document protected issue publishing setup`.
