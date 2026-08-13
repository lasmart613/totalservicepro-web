import type { ReactNode } from 'react';

/**
 * Public, no-login estimate action pages.
 * Middleware does not session-gate; this layout also does not wrap RequireAuth.
 */
export default function PublicEstimateActionLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
