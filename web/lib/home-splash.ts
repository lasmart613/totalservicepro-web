/**
 * GET / first paint: marketing landing unless a session is already known.
 * Waiting on "auth hint not checked yet" SSRs crawlers behind "Loading dashboard…".
 */
export function shouldShowHomeDashboardSplash(
  loading: boolean,
  hasUser: boolean,
  hasAuthHint: boolean,
): boolean {
  return loading && (hasUser || hasAuthHint);
}
