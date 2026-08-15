'use client';

/**
 * Recovery emails and bookmarks may use /reset-password.
 * Reuse the working set-password flow so hash/query tokens are not dropped
 * by a server redirect.
 */
export { default } from '../auth/set-password/page';
