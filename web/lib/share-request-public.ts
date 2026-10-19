/**
 * Public (logged-out) RFQ share preview. The public.open_service_requests
 * view's column set minus budget_max (CEO 2026-10-18: budget is for signed-in
 * bidders only, who read the view directly). No serial number, error codes,
 * preferred date, budget, equipment, photos, contacts or bids.
 */
export const PUBLIC_SHARE_REQUEST_COLUMNS = [
  'id',
  'title',
  'description',
  'status',
  'urgency',
  'manufacturer',
  'model',
  'service_type',
  'city',
  'state',
  'location',
  'category',
  'created_at',
  'organization_id',
] as const;

export const SHARE_REQUEST_SELECT = PUBLIC_SHARE_REQUEST_COLUMNS.join(', ');

type Row = Record<string, unknown>;

/** Response body for /api/share/request/[id]. organization_id is not echoed; the org name is. */
export function publicShareRequestRow(
  data: Row,
  org: { name?: string | null; state?: string | null } | null
) {
  return {
    id: data.id,
    title: data.title ?? null,
    description: data.description ?? null,
    status: data.status ?? null,
    urgency: data.urgency ?? null,
    manufacturer: data.manufacturer ?? null,
    model: data.model ?? null,
    service_type: data.service_type ?? null,
    // The request's own city only; the requesting org's city is never used (F-2).
    city: (data.city as string | null) || null,
    state: (data.state as string | null) || org?.state || null,
    location: data.location ?? null,
    category: data.category ?? null,
    created_at: data.created_at ?? null,
    organization_name: org?.name || null,
    _public_share: true as const,
  };
}
