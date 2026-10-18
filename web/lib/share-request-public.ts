/**
 * Public (logged-out) RFQ share preview. Same column set as the
 * public.open_service_requests view that signed-in bidders read: no serial
 * number, error codes, preferred date, equipment, photos, contacts or bids.
 */
export const OPEN_SERVICE_REQUEST_COLUMNS = [
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
  'budget_max',
  'organization_id',
] as const;

export const SHARE_REQUEST_SELECT = OPEN_SERVICE_REQUEST_COLUMNS.join(', ');

type Row = Record<string, unknown>;

/** Response body for /api/share/request/[id]. organization_id is not echoed; the org name is. */
export function publicShareRequestRow(
  data: Row,
  org: { name?: string | null; city?: string | null; state?: string | null } | null
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
    city: (data.city as string | null) || org?.city || null,
    state: (data.state as string | null) || org?.state || null,
    location: data.location ?? null,
    category: data.category ?? null,
    created_at: data.created_at ?? null,
    budget_max: data.budget_max ?? null,
    organization_name: org?.name || null,
    _public_share: true as const,
  };
}
