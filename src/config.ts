declare global { interface Window { PILOT_ADMIN_ORIGIN?: string; PILOT_MANIFEST_URL?: string } }
export const adminOrigin = () => window.PILOT_ADMIN_ORIGIN || 'https://pilot-archive.pages.dev';
export const isPublicSite = () => !['localhost', '127.0.0.1', 'pilot-archive.pages.dev'].includes(window.location.hostname) && !window.location.hostname.endsWith('.pilot-archive.pages.dev');
export const adminUrl = () => `${adminOrigin()}/api/admin/login`;
export const manifestUrl = () => window.PILOT_MANIFEST_URL || '/archive/manifest.json';
