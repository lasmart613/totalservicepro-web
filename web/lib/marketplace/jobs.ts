/**
 * Marketplace job board (000954).
 * Free posts: no Stripe price, no promotion flag, no upgrade check.
 * Hiring requires an organization the actor belongs to.
 * Looking may be an individual (organization_id null).
 */

import { sameOrg } from '../org-membership.ts';

export const JOB_TYPES = ['full_time', 'part_time', 'contract', 'subcontract'] as const;
export const JOB_SIDES = ['hiring', 'looking'] as const;
export const JOB_STATUSES = ['open', 'filled', 'closed'] as const;
export const JOB_PUBLIC_STATUSES = ['open', 'filled'] as const;

export type JobType = (typeof JOB_TYPES)[number];
export type JobSide = (typeof JOB_SIDES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Columns anon / authenticated may SELECT. contact_email and contact_phone stay off this list. */
export const JOB_PUBLIC_COLUMNS = [
  'id',
  'created_by',
  'organization_id',
  'side',
  'job_type',
  'title',
  'description',
  'city',
  'state',
  'location',
  'remote',
  'service_area',
  'compensation',
  'equipment',
  'modality',
  'contact_name',
  'status',
  'created_at',
  'updated_at',
] as const;

export const JOB_PRIVATE_COLUMNS = ['contact_email', 'contact_phone'] as const;

export const JOB_PUBLIC_SELECT = JOB_PUBLIC_COLUMNS.join(', ');

export const JOB_LIMITS = {
  title: 160,
  description: 8000,
  city: 80,
  state: 40,
  location: 200,
  service_area: 300,
  compensation: 200,
  equipment: 200,
  modality: 120,
  contact_name: 120,
  contact_email: 200,
  contact_phone: 40,
} as const;

export const JOB_ERRORS = {
  signIn: 'Sign in required.',
  hiringOrg: 'Join an organization before posting a hiring job.',
  hiringUsesOrg: 'Hiring posts use your organization.',
  wrongOrg: 'That organization is not one you belong to.',
  lookingOrg: 'Include my organization needs an organization on your profile.',
  title: 'Enter a job title (at least 3 characters).',
  description: 'Describe the role or the work you are looking for.',
  type: 'Choose full-time, part-time, contract, or subcontract.',
  side: 'Choose hiring or looking for work.',
  status: 'Choose open, filled, or closed.',
  email: 'Enter a valid contact email or leave it blank.',
  permission: 'You do not have permission to edit this job post.',
  save: 'Could not save this job post.',
  unavailable: 'Job board is not available yet.',
} as const;

export type JobActor = {
  userId?: string | null;
  orgId?: string | number | null;
  membershipOrgIds?: Array<string | number | null | undefined>;
};

export type JobRow = {
  id?: string;
  created_by?: string | null;
  organization_id?: string | number | null;
  side?: string | null;
  job_type?: string | null;
  title?: string | null;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  remote?: boolean | null;
  service_area?: string | null;
  compensation?: string | null;
  equipment?: string | null;
  modality?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type JobInsertRow = {
  created_by: string;
  organization_id: number | string | null;
  side: JobSide;
  job_type: JobType;
  title: string;
  description: string;
  city: string | null;
  state: string | null;
  location: string | null;
  remote: boolean;
  service_area: string | null;
  compensation: string | null;
  equipment: string | null;
  modality: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: 'open';
};

export type JobWriteResult<T> = { ok: true; row: T } | { ok: false; error: string };

export type JobBoardFilters = {
  query?: string;
  side?: string;
  job_type?: string;
  remote?: '' | 'remote' | 'onsite';
  showFilled?: boolean;
  includeClosed?: boolean;
};

export type JobPrefill = {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  city: string;
  state: string;
  location: string;
  organization_id: string | number | null;
  organization_name: string;
};

type PgError = { message?: string; code?: string } | null | undefined;

function trimLine(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function trimBlock(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function asOrgId(value: string | number): number | string {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : String(value);
}

/** Memberships win. If none were loaded, fall back to the active profile org and let RLS decide. */
export function allowedOrgIds(actor: JobActor): Array<string | number> {
  const members = (actor.membershipOrgIds || []).filter((id) => id != null && id !== '') as Array<string | number>;
  if (members.length) return members;
  if (actor.orgId != null && actor.orgId !== '') return [actor.orgId];
  return [];
}

export function actorOwnsOrg(actor: JobActor, orgId: unknown): boolean {
  return allowedOrgIds(actor).some((id) => sameOrg(id, orgId as string | number | null));
}

export function canManageJob(job: JobRow | null | undefined, actor: JobActor | null | undefined): boolean {
  if (!job || !actor?.userId) return false;
  if (job.created_by && job.created_by === actor.userId) return true;
  if (job.organization_id == null) return false;
  return actorOwnsOrg(actor, job.organization_id);
}

export function isJobType(value: unknown): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(String(value || ''));
}

export function isJobSide(value: unknown): value is JobSide {
  return (JOB_SIDES as readonly string[]).includes(String(value || ''));
}

export function isJobStatus(value: unknown): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(String(value || ''));
}

export function isPublicJobStatus(status?: string | null): boolean {
  return (JOB_PUBLIC_STATUSES as readonly string[]).includes(String(status || ''));
}

export function isMissingJobsTable(error: PgError): boolean {
  if (!error) return false;
  const msg = String(error.message || '');
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /marketplace_jobs|marketplace_job_contact/i.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

function optionalLine(value: unknown, max: number): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = trimLine(value);
  if (!text) return { ok: true, value: null };
  if (text.length > max) return { ok: false, error: JOB_ERRORS.save };
  return { ok: true, value: text };
}

function cleanState(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = trimLine(value);
  if (!text) return { ok: true, value: null };
  if (text.length > JOB_LIMITS.state) return { ok: false, error: JOB_ERRORS.save };
  return { ok: true, value: text.length === 2 ? text.toUpperCase() : text };
}

function cleanEmail(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = trimLine(value);
  if (!text) return { ok: true, value: null };
  if (text.length > JOB_LIMITS.contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return { ok: false, error: JOB_ERRORS.email };
  }
  return { ok: true, value: text };
}

function resolveOrg(
  actor: JobActor,
  requested: unknown,
  required: boolean,
): { ok: true; id: number | string | null } | { ok: false; error: string } {
  const allowed = allowedOrgIds(actor);
  const raw = requested == null || requested === '' ? null : requested;
  if (raw != null) {
    if (!allowed.some((id) => sameOrg(id, raw as string | number))) {
      return { ok: false, error: JOB_ERRORS.wrongOrg };
    }
    const match = allowed.find((id) => sameOrg(id, raw as string | number)) as string | number;
    return { ok: true, id: asOrgId(match) };
  }
  if (!required) return { ok: true, id: null };
  if (actor.orgId != null && allowed.some((id) => sameOrg(id, actor.orgId))) {
    return { ok: true, id: asOrgId(actor.orgId as string | number) };
  }
  if (allowed.length === 1) return { ok: true, id: asOrgId(allowed[0]) };
  if (!allowed.length) return { ok: false, error: JOB_ERRORS.hiringOrg };
  return { ok: false, error: JOB_ERRORS.hiringUsesOrg };
}

function asBody(input: object): Record<string, unknown> {
  return input as Record<string, unknown>;
}

function readShared(input: Record<string, unknown>): JobWriteResult<Omit<JobInsertRow, 'created_by' | 'organization_id' | 'side' | 'status'>> {
  if (!isJobType(input.job_type)) return { ok: false, error: JOB_ERRORS.type };
  const title = trimLine(input.title);
  if (title.length < 3 || title.length > JOB_LIMITS.title) return { ok: false, error: JOB_ERRORS.title };
  const description = trimBlock(input.description);
  if (description.length < 1 || description.length > JOB_LIMITS.description) {
    return { ok: false, error: JOB_ERRORS.description };
  }
  const city = optionalLine(input.city, JOB_LIMITS.city);
  if (!city.ok) return city;
  const state = cleanState(input.state);
  if (!state.ok) return state;
  const location = optionalLine(input.location, JOB_LIMITS.location);
  if (!location.ok) return location;
  const serviceArea = optionalLine(input.service_area, JOB_LIMITS.service_area);
  if (!serviceArea.ok) return serviceArea;
  const compensation = optionalLine(input.compensation, JOB_LIMITS.compensation);
  if (!compensation.ok) return compensation;
  const equipment = optionalLine(input.equipment, JOB_LIMITS.equipment);
  if (!equipment.ok) return equipment;
  const modality = optionalLine(input.modality, JOB_LIMITS.modality);
  if (!modality.ok) return modality;
  const contactName = optionalLine(input.contact_name, JOB_LIMITS.contact_name);
  if (!contactName.ok) return contactName;
  const contactPhone = optionalLine(input.contact_phone, JOB_LIMITS.contact_phone);
  if (!contactPhone.ok) return contactPhone;
  const contactEmail = cleanEmail(input.contact_email);
  if (!contactEmail.ok) return contactEmail;

  return {
    ok: true,
    row: {
      job_type: input.job_type,
      title,
      description,
      city: city.value,
      state: state.value,
      location: location.value,
      remote: asBool(input.remote),
      service_area: serviceArea.value,
      compensation: compensation.value,
      equipment: equipment.value,
      modality: modality.value,
      contact_name: contactName.value,
      contact_email: contactEmail.value,
      contact_phone: contactPhone.value,
    },
  };
}

/**
 * Insert payload. created_by comes from the actor, never the body.
 * Hiring always stores an org the actor belongs to.
 * Looking stores an org only when post_as_org is set.
 */
export function buildJobInsert(input: object, actor: JobActor): JobWriteResult<JobInsertRow> {
  const body = asBody(input);
  if (!actor.userId) return { ok: false, error: JOB_ERRORS.signIn };
  if (!isJobSide(body.side)) return { ok: false, error: JOB_ERRORS.side };
  const shared = readShared(body);
  if (!shared.ok) return shared;

  const asOrg = body.side === 'hiring' || asBool(body.post_as_org);
  const org = resolveOrg(actor, asOrg ? body.organization_id : null, asOrg);
  if (!org.ok) {
    if (body.side === 'looking' && org.error === JOB_ERRORS.hiringOrg) {
      return { ok: false, error: JOB_ERRORS.lookingOrg };
    }
    return org;
  }

  return {
    ok: true,
    row: {
      ...shared.row,
      created_by: actor.userId,
      organization_id: asOrg ? org.id : null,
      side: body.side,
      status: 'open',
    },
  };
}

/** Partial update. created_by is never written. Status may move among open, filled, and closed. */
export function buildJobUpdate(
  existing: JobRow,
  patch: object,
  actor: JobActor,
): JobWriteResult<Record<string, unknown>> {
  const body = asBody(patch);
  if (!canManageJob(existing, actor)) return { ok: false, error: JOB_ERRORS.permission };
  const merged: Record<string, unknown> = {
    side: existing.side,
    job_type: existing.job_type,
    title: existing.title,
    description: existing.description,
    city: existing.city,
    state: existing.state,
    location: existing.location,
    remote: existing.remote,
    service_area: existing.service_area,
    compensation: existing.compensation,
    equipment: existing.equipment,
    modality: existing.modality,
    contact_name: existing.contact_name,
    contact_email: existing.contact_email,
    contact_phone: existing.contact_phone,
    organization_id: existing.organization_id,
    post_as_org: existing.organization_id != null,
    ...body,
  };
  if (!isJobSide(merged.side)) return { ok: false, error: JOB_ERRORS.side };
  const shared = readShared(merged);
  if (!shared.ok) return shared;

  const touchesOrg = ['post_as_org', 'organization_id', 'side'].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
  let organizationId = existing.organization_id ?? null;
  if (touchesOrg) {
    const asOrg = merged.side === 'hiring' || asBool(merged.post_as_org);
    const org = resolveOrg(actor, asOrg ? merged.organization_id : null, asOrg);
    if (!org.ok) {
      if (merged.side === 'looking' && org.error === JOB_ERRORS.hiringOrg) {
        return { ok: false, error: JOB_ERRORS.lookingOrg };
      }
      return org;
    }
    organizationId = asOrg ? org.id : null;
  }
  if (merged.side === 'hiring' && (organizationId == null || organizationId === '')) {
    return { ok: false, error: JOB_ERRORS.hiringOrg };
  }

  let status: JobStatus = isJobStatus(existing.status) ? existing.status : 'open';
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!isJobStatus(body.status)) return { ok: false, error: JOB_ERRORS.status };
    status = body.status;
  }

  const row: Record<string, unknown> = {
    ...shared.row,
    side: merged.side,
    organization_id: organizationId,
    status,
    updated_at: new Date().toISOString(),
  };
  // A status-only edit must not blank private contact columns the caller did not load.
  if (!Object.prototype.hasOwnProperty.call(body, 'contact_email') && existing.contact_email === undefined) {
    delete row.contact_email;
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'contact_phone') && existing.contact_phone === undefined) {
    delete row.contact_phone;
  }
  return { ok: true, row };
}

export function filterJobs<T extends JobRow>(rows: T[], filters: JobBoardFilters = {}): T[] {
  const q = (filters.query || '').trim().toLowerCase();
  return rows.filter((row) => {
    const status = String(row.status || '');
    if (status === 'closed' && !filters.includeClosed) return false;
    if (status === 'filled' && !filters.showFilled && !filters.includeClosed) return false;
    if (!filters.includeClosed && status !== 'open' && status !== 'filled') return false;
    if (filters.side && row.side !== filters.side) return false;
    if (filters.job_type && row.job_type !== filters.job_type) return false;
    if (filters.remote === 'remote' && !row.remote) return false;
    if (filters.remote === 'onsite' && row.remote) return false;
    if (!q) return true;
    const hay = [
      row.title,
      row.description,
      row.city,
      row.state,
      row.location,
      row.service_area,
      row.equipment,
      row.modality,
      row.compensation,
      row.contact_name,
    ]
      .map((part) => String(part || '').toLowerCase())
      .join('\n');
    return hay.includes(q);
  });
}

export function jobPrefillFromSources(sources: {
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    email?: string | null;
    organization_id?: string | number | null;
  } | null;
  org?: {
    id?: string | number | null;
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
    email?: string | null;
    contact_name?: string | null;
  } | null;
}): JobPrefill {
  const profile = sources.profile || {};
  const org = sources.org || {};
  const person = [profile.first_name, profile.last_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const city = String(org.city || '').trim();
  const stateRaw = String(org.state || '').trim();
  const state = stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw;
  const address = String(org.address || '').trim();
  const cityState = [city, state].filter(Boolean).join(', ');
  return {
    contact_name: person || String(org.contact_name || '').trim(),
    contact_email: String(profile.email || org.email || '').trim(),
    contact_phone: String(profile.phone || org.phone || '').trim(),
    city,
    state,
    location: [address, cityState].filter(Boolean).join(', '),
    organization_id: profile.organization_id ?? org.id ?? null,
    organization_name: String(org.name || '').trim(),
  };
}

export function jobDetailPath(id: string): string {
  return `/marketplace/jobs/${id}`;
}

export function jobEditPath(id: string): string {
  return `/marketplace/jobs/${id}/edit`;
}

/** Drop private contact columns before a public JSON response. */
export function stripJobPrivateColumns<T extends Record<string, unknown>>(row: T): T {
  const next = { ...row };
  delete next.contact_email;
  delete next.contact_phone;
  return next;
}
