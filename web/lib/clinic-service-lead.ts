/**
 * Guest clinic / facility service leads from the logged-out RepairPlanet
 * landing. Not a marketplace RFQ and not a TSP product-issue report.
 * Team copy follows the product-inbox pattern (contact@ + QA).
 */

import {
  parseSubmittedEmail,
  productIssuesFromAddress,
  productIssuesTeamRecipients,
  PRODUCT_ISSUE_CONFIRM_REPLY_TO,
} from './product-issues.ts';

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

export const CLINIC_LEAD_URGENCY = [
  { value: 'now', label: 'Down now' },
  { value: 'this_week', label: 'This week' },
  { value: 'flexible', label: 'Flexible' },
] as const;

export type ClinicLeadUrgency = (typeof CLINIC_LEAD_URGENCY)[number]['value'];

export type ClinicLeadInput = {
  clinicName?: unknown;
  location?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  equipmentType?: unknown;
  equipmentTypeOther?: unknown;
  manufacturer?: unknown;
  description?: unknown;
  urgency?: unknown;
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
  manufacturer: string | null;
  description: string;
  urgency: ClinicLeadUrgency | null;
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

  const urgencyRaw = clip(body.urgency, 20);
  const urgency =
    CLINIC_LEAD_URGENCY.find((u) => u.value === urgencyRaw)?.value ?? null;

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
      manufacturer: manufacturer || null,
      description,
      urgency,
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

export function clinicLeadText(opts: {
  lead: ClinicLead;
  confirmationSent?: boolean;
}): string {
  const { lead } = opts;
  return [
    'RepairPlanet — clinic service lead (no TSP account)',
    '',
    `Clinic / org: ${lead.clinicName}`,
    `Location: ${lead.location}`,
    `Contact: ${lead.contactName}`,
    `Email: ${lead.email || '(not provided)'}`,
    `Phone: ${lead.phone || '(not provided)'}`,
    `Equipment type: ${equipmentTypeLabel(lead)}`,
    `Brand / model: ${lead.manufacturer || '(not provided)'}`,
    `Urgency: ${urgencyLabel(lead.urgency)}`,
    '',
    'What is going on:',
    lead.description,
    '',
    confirmationNote({ email: lead.email, confirmationSent: opts.confirmationSent }),
    '',
    'Do not treat this as a live marketplace RFQ. Match a nearby shop; do not blast shops.',
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
}): string {
  const { lead } = opts;
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#111827;line-height:1.45">
  <h2 style="color:#92400e;margin:0 0 12px">RepairPlanet — clinic service lead</h2>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Guest landing form. No Total Service Pro account. ${esc(confirmationNote({ email: lead.email, confirmationSent: opts.confirmationSent }))}</p>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Clinic / org</td><td>${esc(lead.clinicName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Location</td><td>${esc(lead.location)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Contact</td><td>${esc(lead.contactName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td>${esc(lead.email || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td>${esc(lead.phone || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Equipment type</td><td>${esc(equipmentTypeLabel(lead))}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Brand / model</td><td>${esc(lead.manufacturer || '(not provided)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Urgency</td><td>${esc(urgencyLabel(lead.urgency))}</td></tr>
  </table>
  <p style="margin:16px 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">What is going on</p>
  <pre style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;padding:12px;border-radius:8px">${esc(lead.description)}</pre>
  <p style="color:#6b7280;font-size:12px">Do not treat this as a live marketplace RFQ. Match a nearby shop; do not blast shops.</p>
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
