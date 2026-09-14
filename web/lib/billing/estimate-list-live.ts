/**
 * Live shop-dashboard updates for estimate customer actions.
 * Prefer Supabase Realtime; fall back to a short visibility-aware poll.
 */

export const ESTIMATE_LIST_POLL_MS = 8_000;

export type EstimateLiveRow = {
  id: string | number;
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
  estimate_data?: unknown;
  status?: string | null;
  organization_id?: string | number | null;
  created_by?: string | null;
  [key: string]: unknown;
};

export function sameEstimateId(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

export function mergeEstimateLiveRow<T extends EstimateLiveRow>(
  rows: T[],
  incoming: T
): T[] {
  if (incoming?.id == null) return rows;
  const idx = rows.findIndex((row) => sameEstimateId(row.id, incoming.id));
  if (idx < 0) return [incoming, ...rows];
  const next = rows.slice();
  next[idx] = { ...rows[idx], ...incoming };
  return next;
}

export function estimateRowBelongsToViewer(
  row: Pick<EstimateLiveRow, 'organization_id' | 'created_by'>,
  viewer: { orgId?: string | number | null; userId?: string | null }
): boolean {
  if (viewer.orgId != null && row.organization_id != null) {
    if (String(row.organization_id) === String(viewer.orgId)) return true;
  }
  if (viewer.userId && row.created_by) {
    if (String(row.created_by) === String(viewer.userId)) return true;
  }
  return false;
}
