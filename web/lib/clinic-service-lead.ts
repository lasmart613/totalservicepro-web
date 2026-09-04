/**
 * Guest clinic / facility service leads from the logged-out RepairPlanet
 * landing. Team copy follows the product-inbox pattern (contact@ + QA).
 *
 * Submit inserts (1) a new owner/clinic organizations row (type=customer),
 * (2) a real service_requests row linked to that org (same payload as the
 * in-app create flow), and (3) a clinic_service_leads audit row.
 * Insert only — never update a live Premium, service-company, or claimed org.
 * Guest has no auth user, so posted_by / created_by stay null.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertOmittingCharOverflow, shortTicketPrefix } from './char-overflow.ts';
import { customerOrgPayload, emptyCustomerForm } from './customer-form.ts';
import { normalizeRegionInput } from './geo.ts';
import {
  parseSubmittedEmail,
  productIssuesFromAddress,
  productIssuesTeamRecipients,
  PRODUCT_ISSUE_CONFIRM_REPLY_TO,
} from './product-issues.ts';
import {
  ownerServiceRequestPayload,
  normalizeServiceRequestType,
  normalizeServiceRequestUrgency,
  SERVICE_REQUEST_TYPES,
  SERVICE_REQUEST_URGENCY,
  type ServiceRequestType,
  type ServiceRequestUrgency,
} from './service-request-create.ts';

export { SERVICE_REQUEST_TYPES, SERVICE_REQUEST_URGENCY };

/** Guest landing source flag. Safe to persist when the column exists. */
export const CLINIC_LEAD_ORG_SOURCE = 'landing_find_a_rep';

export const CLINIC_LEAD_DESCRIPTION_MIN = 10;
export const CLINIC_LEAD_DESCRIPTION_MAX = 2000;
export const CLINIC_LEAD_NAME_MAX = 120;
export const CLINIC_LEAD_LOCATION_MAX = 80;
export const FIND_REP_HASH = 'find-a-rep';

export const CLINIC_LEAD_EQUIPMENT_OTHER_MAX = 80;

export const CLINIC_LEAD_EQUIPMENT_TYPES = [
  { value: 'laser', label: 'Laser' },
  { value: 'lithotriptor', label: 'Lithotriptor' },
  { value: 'c_arm', label: 'C-arm' },
  { value: 'other', label: 'Other' },
] as const;

export type ClinicLeadEquipmentType = (typeof CLINIC_LEAD_EQUIPMENT_TYPES)[number]['value'];

export const CLINIC_LEAD_URGENCY = SERVICE_REQUEST_URGENCY.map((value) => ({
  value,
  label: value === 'Emergency' ? 'Down now / emergency' : value,
}));

export type ClinicLeadUrgency = ServiceRequestUrgency;

export type ClinicLeadInput = {
  clinicName?: unknown;
  location?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  equipmentType?: unknown;
  equipmentTypeOther?: unknown;
  manufacturer?: unknown;
  model?: unknown;
  serialNumber?: unknown;
  serviceType?: unknown;
  description?: unknown;
  urgency?: unknown;
  preferredDate?: unknown;
  errorCodes?: unknown;
  website?: unknown;
  companyWebsite?: unknown;
};

export type ClinicLead = {
  clinicName: string;
  location: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  equipmentType: ClinicLeadEquipmentType;
  equipmentTypeOther: string | null;
  manufacturer: string;
  model: string;
  serialNumber: string | null;
  serviceType: ServiceRequestType;
  description: string;
  urgency: ClinicLeadUrgency;
  preferredDate: string | null;
  errorCodes: string | null;
};

export type ClinicLeadMailPlan = {
  confirmationTo: string | null;
  teamRecipients: string[];
};

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return raw.slice(0, 40);
}

export function clinicLeadFromAddress(): string {
  const from = productIssuesFromAddress();
  if (/^Total Service Pro </i.test(from)) {
    return from.replace(/^Total Service Pro /i, 'RepairPlanet ');
  }
  return from;
}

export function clinicLeadTeamRecipients(): string[] {
  return productIssuesTeamRecipients();
}

export function clinicLeadConfirmReplyTo(): string {
  return PRODUCT_ISSUE_CONFIRM_REPLY_TO;
}

export function shouldAutoOpenFindRep(search: string, hash: string): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (q.get('find') === '1' || q.get('find') === 'rep') return true;
  const h = hash.replace(/^#/, '');
  return h === FIND_REP_HASH || h === 'find';
}

export function parseClinicLead(body: ClinicLeadInput):
  | { ok: true; spam: true }
  | { ok: true; spam?: false; lead: ClinicLead }
  | { ok: false; error: string } {
  const honeypot = clip(body.website ?? body.companyWebsite, 200);
  if (honeypot) return { ok: true, spam: true };

  const equipmentRaw = clip(body.equipmentType, 20);
  const equipmentType =
    CLINIC_LEAD_EQUIPMENT_TYPES.find((t) => t.value === equipmentRaw)?.value ?? null;
  if (!equipmentType) {
    return { ok: false, error: 'Please choose an equipment type.' };
  }
  const equipmentTypeOther = clip(body.equipmentTypeOther, CLINIC_LEAD_EQUIPMENT_OTHER_MAX);
  if (equipmentType === 'other' && equipmentTypeOther.length < 2) {
    return { ok: false, error: 'Please say what kind of equipment (a short note is enough).' };
  }

  const clinicName = clip(body.clinicName, CLINIC_LEAD_NAME_MAX);
  if (clinicName.length < 2) {
    return { ok: false, error: 'Please enter the clinic or organization name.' };
  }

  const location = clip(body.location, CLINIC_LEAD_LOCATION_MAX);
  if (location.length < 2) {
    return { ok: false, error: 'Please enter a city or ZIP so we can look nearby.' };
  }

  const contactName = clip(body.contactName, CLINIC_LEAD_NAME_MAX);
  if (contactName.length < 2) {
    return { ok: false, error: 'Please enter a contact name.' };
  }

  const emailParsed = parseSubmittedEmail(body.email);
  if (!emailParsed.ok) return emailParsed;
  const email = emailParsed.email;

  const rawPhone = String(body.phone ?? '').trim();
  const phone = normalizePhone(rawPhone);
  if (rawPhone && !phone) {
    return { ok: false, error: 'That phone number does not look valid.' };
  }
  if (!email && !phone) {
    return { ok: false, error: 'Add an email or a phone number so we can reach you.' };
  }

  const manufacturer = clip(body.manufacturer, 80);
  if (manufacturer.length < 2) {
    return { ok: false, error: 'Please enter the brand / manufacturer.' };
  }
  const model = clip(body.model, 80);
  if (model.length < 1) {
    return { ok: false, error: 'Please enter the model.' };
  }
  const serialNumber = clip(body.serialNumber, 80) || null;
  const errorCodes = clip(body.errorCodes, 120) || null;
  const preferredRaw = clip(body.preferredDate, 12);
  const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(preferredRaw) ? preferredRaw : null;
  const serviceType = normalizeServiceRequestType(clip(body.serviceType, 40));

  const description = String(body.description || '').trim();
  if (description.length < CLINIC_LEAD_DESCRIPTION_MIN) {
    return {
      ok: false,
      error: `Please describe the problem (at least ${CLINIC_LEAD_DESCRIPTION_MIN} characters).`,
    };
  }
  if (description.length > CLINIC_LEAD_DESCRIPTION_MAX) {
    return {
      ok: false,
      error: `Description is too long (max ${CLINIC_LEAD_DESCRIPTION_MAX} characters).`,
    };
  }

  const urgency = normalizeServiceRequestUrgency(clip(body.urgency, 20));

  return {
    ok: true,
    lead: {
      clinicName,
      location,
      contactName,
      email,
      phone,
      equipmentType,
      equipmentTypeOther: equipmentType === 'other' ? equipmentTypeOther : null,
      manufacturer,
      model,
      serialNumber,
      serviceType,
      description,
      urgency,
      preferredDate,
      errorCodes,
    },
  };
}

export function planClinicLeadMail(opts: {
  email?: string | null;
  confirmationAlreadySent?: boolean;
}): ClinicLeadMailPlan {
  const confirmationTo =
    opts.email && !opts.confirmationAlreadySent ? opts.email : null;
  return {
    confirmationTo,
    teamRecipients: clinicLeadTeamRecipients(),
  };
}

export type ClinicLeadLocationParts = {
  city: string;
  zip: string;
  state: string | null;
};

/** Split "Somis, CA 93066" / "93066" / "Los Angeles" for organizations columns. */
export function clinicLeadLocationParts(location: string): ClinicLeadLocationParts {
  const raw = String(location || '').trim();
  const zipMatch = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch?.[1] ?? '';
  let rest = raw.replace(/\b\d{5}(?:-\d{4})?\b/, '').replace(/[,\s]+$/g, '').trim();
  let stateRaw = '';
  const stateMatch = rest.match(/,\s*([A-Za-z][A-Za-z.\s]{1,40})$/);
  if (stateMatch) {
    stateRaw = stateMatch[1].trim();
    rest = rest.slice(0, stateMatch.index).trim();
  }
  const region = normalizeRegionInput(stateRaw);
  return {
    city: rest,
    zip,
    state: region.state,
  };
}

export function clinicLeadOrgNotes(lead: ClinicLead): string {
  return [
    `[${CLINIC_LEAD_ORG_SOURCE}] Guest clinic service request — not a live TSP customer account.`,
    `Equipment: ${equipmentTypeLabel(lead)}`,
    `Brand: ${lead.manufacturer}`,
    `Model: ${lead.model}`,
    lead.serialNumber ? `Serial: ${lead.serialNumber}` : '',
    `Service type: ${lead.serviceType}`,
    `Urgency: ${lead.urgency}`,
    `Location (as entered): ${lead.location}`,
    '',
    lead.description,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * New owner/clinic org row for a guest landing lead.
 * Reuses customerOrgPayload (same as CRM create). Always a new insert —
 * callers must not upsert/update existing live orgs by name.
 */
export function organizationInsertFromClinicLead(lead: ClinicLead): Record<string, unknown> {
  const loc = clinicLeadLocationParts(lead.location);
  const form = {
    ...emptyCustomerForm(),
    name: lead.clinicName,
    contact_name: lead.contactName,
    email: lead.email || '',
    phone: lead.phone || '',
    city: loc.city,
    state: loc.state || '',
    zip: loc.zip,
    notes: clinicLeadOrgNotes(lead),
  };
  return customerOrgPayload(form, {
    type: 'customer',
    is_active: false,
    is_premium: false,
    facility_type: 'Laser Clinic / Medical Practice',
    ticket_prefix: shortTicketPrefix(lead.clinicName),
    lead_source: CLINIC_LEAD_ORG_SOURCE,
    list_in_directory: false,
  });
}

/** True only for a prior guest landing row — never a Premium or shop org. */
export function isReusableGuestClinicOrg(row: {
  type?: string | null;
  is_premium?: boolean | null;
  is_active?: boolean | null;
  lead_source?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if (row.lead_source !== CLINIC_LEAD_ORG_SOURCE) return false;
  if (row.is_premium === true) return false;
  if (row.is_active !== false) return false;
  const type = String(row.type || '').toLowerCase();
  return type === 'customer' || type === 'laser_clinic';
}

/**
 * Insert a new organizations row for this guest clinic. Never updates.
 * Missing columns (lead_source, list_in_directory, is_premium) are omitted
 * and retried via insertOmittingCharOverflow.
 */
export async function insertOrganizationFromClinicLead(
  supabase: SupabaseClient,
  lead: ClinicLead
): Promise<{ id: string | number } | { error: string }> {
  const payload = organizationInsertFromClinicLead(lead);
  delete payload.created_by;
  const { data, error } = await insertOmittingCharOverflow(supabase, 'organizations', payload, {
    select: 'id',
    maxAttempts: 24,
  });
  if (error || data?.id == null) {
    return { error: error?.message || 'Could not create organization' };
  }
  return { id: data.id };
}

export function serviceRequestInsertFromClinicLead(
  lead: ClinicLead,
  organizationId: string | number
): Record<string, unknown> {
  const loc = clinicLeadLocationParts(lead.location);
  const location =
    [loc.city, loc.state].filter(Boolean).join(', ') || lead.location;
  const { full } = ownerServiceRequestPayload({
    organizationId,
    manufacturer: lead.manufacturer,
    model: lead.model,
    description: lead.description,
    serviceType: lead.serviceType,
    urgency: lead.urgency,
    serialNumber: lead.serialNumber,
    preferredDate: lead.preferredDate,
    errorCodes: lead.errorCodes,
    city: loc.city || null,
    state: loc.state,
    location,
    facilityContact: {
      organization_id: organizationId,
      name: lead.clinicName,
      contact_name: lead.contactName,
      contact_person: lead.contactName,
      contact_email: lead.email,
      contact_phone: lead.phone,
      email: lead.email,
      phone: lead.phone,
      city: loc.city || null,
      state: loc.state,
      zip: loc.zip || null,
      location,
      source: CLINIC_LEAD_ORG_SOURCE,
    },
  });
  return full;
}

/**
 * Insert a service_requests row for the new guest clinic org.
 * Same columns as the in-app post form. Never updates an existing request.
 * Does not set posted_by / created_by (guest has no user).
 */
export async function insertServiceRequestFromClinicLead(
  supabase: SupabaseClient,
  lead: ClinicLead,
  organizationId: string | number
): Promise<{ id: string } | { error: string }> {
  const full = serviceRequestInsertFromClinicLead(lead, organizationId);
  const first = await insertOmittingCharOverflow(supabase, 'service_requests', full, {
    select: 'id',
    maxAttempts: 24,
  });
  if (first.data?.id != null) return { id: String(first.data.id) };

  const loc = clinicLeadLocationParts(lead.location);
  const { slim } = ownerServiceRequestPayload({
    organizationId,
    manufacturer: lead.manufacturer,
    model: lead.model,
    description: lead.description,
    serviceType: lead.serviceType,
    urgency: lead.urgency,
    city: loc.city || null,
    state: loc.state,
    location: [loc.city, loc.state].filter(Boolean).join(', ') || lead.location,
  });
  const retry = await insertOmittingCharOverflow(supabase, 'service_requests', slim, {
    select: 'id',
    maxAttempts: 16,
  });
  if (retry.data?.id != null) return { id: String(retry.data.id) };
  return {
    error: retry.error?.message || first.error?.message || 'Could not create service request',
  };
}

export function equipmentTypeLabel(lead: Pick<ClinicLead, 'equipmentType' | 'equipmentTypeOther'>): string {
  if (lead.equipmentType === 'other') {
    return lead.equipmentTypeOther || 'Other';
  }
  return CLINIC_LEAD_EQUIPMENT_TYPES.find((t) => t.value === lead.equipmentType)?.label || lead.equipmentType;
}

export function clinicLeadSubject(lead: ClinicLead): string {
  return `RepairPlanet clinic lead: ${equipmentTypeLabel(lead)} · ${lead.clinicName} · ${lead.location}`;
}

function urgencyLabel(value: ClinicLeadUrgency | null): string {
  if (!value) return '(not specified)';
  return CLINIC_LEAD_URGENCY.find((u) => u.value === value)?.label || value;
}

function confirmationNote(opts: {
  email?: string | null;
  confirmationSent?: boolean;
}): string {
  if (opts.confirmationSent && opts.email) {
    return `Confirmation sent to ${opts.email}.`;
  }
  if (opts.email) {
    return 'Clinic left an address; confirmation is sent after this lead is accepted.';
  }
  return 'No clinic email — confirmation was not sent.';
}

function organizationNote(organizationId?: string | number | null): string {
  if (organizationId != null && organizationId !== '') {
    return `Organizations row: #${organizationId} (type=customer, guest lead, is_active=false). Do not merge this into a live Premium or service-company org. Delete QA test orgs after review.`;
  }
  return 'Organizations row: insert was attempted as type=customer (clinic/owner). If missing, check service-role logs. Never attach this lead to a live customer org by name.';
}

function serviceRequestNote(serviceRequestId?: string | null): string {
  if (serviceRequestId) {
    return `service_requests row: ${serviceRequestId} (status=open, category=service) linked to the new guest clinic org. Do not blast shops. Delete the QA request with the test org after review.`;
  }
  return 'service_requests row: insert was attempted (same payload as the in-app post form). If missing, check service-role logs.';
}

export function clinicLeadText(opts: {
  lead: ClinicLead;
  confirmationSent?: boolean;
  organizationId?: string | number | null;
  serviceRequestId?: string | null;
}): string {
  const { lead } = opts;
  return [
    'RepairPlanet — clinic service request (no TSP account)',
    '',
    `Clinic / org: ${lead.clinicName}`,
    `Location: ${lead.location}`,
    `Contact: ${lead.contactName}`,
    `Email: ${lead.email || '(not provided)'}`,
    `Phone: ${lead.phone || '(not provided)'}`,
    `Equipment type: ${equipmentTypeLabel(lead)}`,
    `Brand: ${lead.manufacturer}`,
    `Model: ${lead.model}`,
    `Serial: ${lead.serialNumber || '(not provided)'}`,
    `Service type: ${lead.serviceType}`,
    `Urgency: ${urgencyLabel(lead.urgency)}`,
    `Preferred date: ${lead.preferredDate || '(not provided)'}`,
    `Error codes: ${lead.errorCodes || '(not provided)'}`,
    '',
    'What is going on:',
    lead.description,
    '',
    organizationNote(opts.organizationId),
    serviceRequestNote(opts.serviceRequestId),
    confirmationNote({ email: lead.email, confirmationSent: opts.confirmationSent }),
    '',
    'A real service_requests row was created on the new guest clinic org. Do not blast shops.',
  ].join('\n');
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function clinicLeadHtml(opts: {
  lead: ClinicLead;
  confirmationSent?: boolean;
  organizationId?: string | number | null;
  serviceRequestId?: string | null;
}): string {
  const { lead } = opts;
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#111827;line-height:1.45">
  <h2 style="color:#92400e;margin:0 0 12px">RepairPlanet — clinic service request</h2>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Guest landing form. No Total Service Pro account. ${esc(confirmationNote({ email: lead.email, confirmationSent: opts.confirmationSent }))}</p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">${esc(organizationNote(opts.organizationId))}</p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">${esc(serviceRequestNote(opts.serviceRequestId))}</p>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Clinic / org</td><td>${esc(lead.clinicName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Location</td><td>${esc(lead.location)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Contact</td><td>${esc(lead.contactName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td>${esc(lead.email || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td>${esc(lead.phone || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Equipment type</td><td>${esc(equipmentTypeLabel(lead))}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Brand</td><td>${esc(lead.manufacturer)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Model</td><td>${esc(lead.model)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Serial</td><td>${esc(lead.serialNumber || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Service type</td><td>${esc(lead.serviceType)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Urgency</td><td>${esc(urgencyLabel(lead.urgency))}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Preferred date</td><td>${esc(lead.preferredDate || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Error codes</td><td>${esc(lead.errorCodes || '(not provided)')}</td></tr>
  </table>
  <p style="margin:16px 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">What is going on</p>
  <pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;padding:12px;border-radius:8px">${esc(lead.description)}</pre>
  <p style="color:#6b7280;font-size:12px">A real service_requests row was created on the new guest clinic org. Do not blast shops.</p>
</body></html>`;
}

export function clinicLeadConfirmationSubject(): string {
  return 'We received your RepairPlanet service request';
}

export function clinicLeadConfirmationText(): string {
  return [
    'Hi,',
    '',
    'Thanks for writing. RepairPlanet received your request for a nearby service rep, and the team will match you with a shop that can help.',
    '',
    'You do not need a Total Service Pro account for this. If we need details, we will write or call you.',
    '',
    '— RepairPlanet',
    'repairplanet.net',
  ].join('\n');
}

export function clinicLeadConfirmationHtml(): string {
  const subject = clinicLeadConfirmationSubject();
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
          <tr>
            <td style="padding:22px 24px 8px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#92400e;text-transform:uppercase;">RepairPlanet</div>
              <h1 style="margin:10px 0 0;font-size:20px;line-height:1.35;color:#111827;">We received your request</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 24px 8px;font-size:15px;line-height:1.55;color:#374151;">
              <p style="margin:0 0 12px;">Hi,</p>
              <p style="margin:0 0 12px;">Thanks for writing. RepairPlanet received your request for a nearby service rep, and the team will match you with a shop that can help.</p>
              <p style="margin:0 0 12px;">You do not need a Total Service Pro account for this. If we need details, we will write or call you.</p>
              <p style="margin:0;">— RepairPlanet</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 22px;font-size:12px;color:#6b7280;">
              repairplanet.net
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
