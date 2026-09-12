import type { ReactNode } from 'react';
export { privateAppMetadata as metadata } from '@/lib/seo';

/**
 * Public, no-login estimate action pages.
 * Middleware does not session-gate; this layout also does not wrap RequireAuth.
 * Token URLs stay noindex.
 */
export default function PublicEstimateActionLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
