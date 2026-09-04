/**
 * Owner/clinic service_requests insert — same shape as
 * /service-requests and /marketplace/list (listingType=request).
 *
 * DB required: title (NOT NULL). Everything else is nullable with defaults
 * for status ('open'), urgency ('Medium'), category ('service').
 * In-app create still requires manufacturer, model, description, and an org.
 * Guest landing has no auth user — posted_by / created_by stay null.
 */

export const SERVICE_REQUEST_TYPES = [
  'Emergency Repair',
  'PM',
  'Install / Commission',
  'Calibration',
  'Full Contract',
  'Other',
] as const;

export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const SERVICE_REQUEST_URGENCY = ['Low', 'Medium', 'High', 'Emergency'] as const;

export type ServiceRequestUrgency = (typeof SERVICE_REQUEST_URGENCY)[number];

export const SERVICE_REQUEST_STATUS_OPEN = 'open';
export const SERVICE_REQUEST_CATEGORY = 'service';

export function normalizeServiceRequestType(raw?: string | null): ServiceRequestType {
  const v = String(raw || '').trim();
  return (SERVICE_REQUEST_TYPES as readonly string[]).includes(v)
    ? (v as ServiceRequestType)
    : 'Emergency Repair';
}

/** Map landing + in-app urgency onto service_requests.urgency. */
export function normalizeServiceRequestUrgency(raw?: string | null): ServiceRequestUrgency {
  const v = String(raw || '').trim();
  if ((SERVICE_REQUEST_URGENCY as readonly string[]).includes(v)) {
    return v as ServiceRequestUrgency;
  }
  const lower = v.toLowerCase();
  if (lower === 'now' || lower === 'emergency') return 'Emergency';
  if (lower === 'this_week' || lower === 'high') return 'High';
  if (lower === 'flexible' || lower === 'low') return lower === 'low' ? 'Low' : 'Medium';
  if (lower === 'medium') return 'Medium';
  return 'Medium';
}

export function ownerServiceRequestTitle(opts: {
  serviceType: string;
  manufacturer: string;
  model: string;
}): string {
  return `${opts.serviceType}: ${[opts.manufacturer, opts.model].filter(Boolean).join(' ')}`;
}

export type OwnerServiceRequestInput = {
  organizationId: string | number;
  manufacturer: string;
  model: string;
  description: string;
  serviceType?: string | null;
  urgency?: string | null;
  serialNumber?: string | null;
  preferredDate?: string | null;
  errorCodes?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  equipmentId?: number | null;
  budgetMax?: number | null;
  postedBy?: string | null;
  createdBy?: string | null;
  facilityContact?: Record<string, unknown> | null;
};

/**
 * Full insert row used by the in-app post form, then a slim fallback
 * when live PostgREST rejects newer columns.
 */
export function ownerServiceRequestPayload(input: OwnerServiceRequestInput): {
  full: Record<string, unknown>;
  slim: Record<string, unknown>;
} {
  const serviceType = normalizeServiceRequestType(input.serviceType);
  const urgency = normalizeServiceRequestUrgency(input.urgency);
  const manufacturer = input.manufacturer.trim();
  const model = input.model.trim();
  const title = ownerServiceRequestTitle({ serviceType, manufacturer, model });
  const location =
    input.location?.trim() ||
    [input.city, input.state].filter(Boolean).join(', ') ||
    null;

  const full: Record<string, unknown> = {
    organization_id: input.organizationId,
    title,
    description: input.description.trim(),
    service_type: serviceType,
    model_type: model || null,
    manufacturer: manufacturer || null,
    model: model || null,
    serial_number: input.serialNumber?.trim() || null,
    urgency,
    preferred_date: input.preferredDate || null,
    deadline: input.preferredDate || null,
    error_codes: input.errorCodes?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    location,
    status: SERVICE_REQUEST_STATUS_OPEN,
    category: SERVICE_REQUEST_CATEGORY,
    equipment_id: input.equipmentId ?? null,
    budget_max: input.budgetMax ?? null,
  };
  if (input.postedBy) full.posted_by = input.postedBy;
  if (input.createdBy) full.created_by = input.createdBy;
  if (input.facilityContact) full.facility_contact = input.facilityContact;

  const slim: Record<string, unknown> = {
    organization_id: input.organizationId,
    title,
    description: full.description,
    service_type: serviceType,
    model_type: model || null,
    manufacturer: manufacturer || null,
    model: model || null,
    urgency,
    status: SERVICE_REQUEST_STATUS_OPEN,
    category: SERVICE_REQUEST_CATEGORY,
  };
  if (input.postedBy) slim.posted_by = input.postedBy;
  if (input.createdBy) slim.created_by = input.createdBy;

  return { full, slim };
}
