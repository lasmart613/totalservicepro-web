/**
 * Marketplace Wanted board.
 * Buyers post equipment they are looking for. Posting and viewing are free:
 * there is no fee, no Stripe price, and no upgrade wall on this board.
 */

import { EQUIPMENT_TYPE_VALUES, equipmentTypeLabel, normalizeEquipmentType, type EquipmentType } from '../equipment-types.ts';
import { sameOrg } from '../org-membership.ts';
import { canPostWanted, isAdmin, normalizeRole, type OrgTypeLike, type RoleLike } from '../roles.ts';
import { actorBelongsToListingOrg, type ListingActor } from './ownership.ts';

export const WANTED_POSTING_IS_FREE = true;

export const WANTED_STATUSES = ['open', 'filled', 'closed'] as const;
export type WantedStatus = (typeof WANTED_STATUSES)[number];

/** Guests and signed-in visitors can read these. Closed posts stay with the org. */
export const PUBLIC_WANTED_STATUSES: readonly WantedStatus[] = ['open', 'filled'];

export const WANTED_CONDITIONS = ['any', 'new', 'refurbished', 'used', 'for_parts'] as const;
export type WantedCondition = (typeof WANTED_CONDITIONS)[number];

export const WANTED_CONTACT = ['message', 'org'] as const;
export type WantedContact = (typeof WANTED_CONTACT)[number];

export const WANTED_CONDITION_LABEL: Record<WantedCondition, string> = {
  any: 'Any condition',
  new: 'New',
  refurbished: 'Refurbished',
  used: 'Used',
  for_parts: 'For parts',
};

export const WANTED_STATUS_LABEL: Record<WantedStatus, string> = {
  open: 'Open — still looking',
  filled: 'Filled',
  closed: 'Closed',
};

/** Columns anon and authenticated may read. No email, phone, or payment fields. */
export const WANTED_PUBLIC_SELECT = [
  'id',
  'created_by',
  'organization_id',
  'title',
  'description',
  'manufacturer',
  'model',
  'modality',
  'preferred_condition',
  'city',
  'state',
  'country',
  'service_area',
  'budget_min',
  'budget_max',
  'currency',
  'contact_via',
  'poster_name',
  'contact_name',
  'status',
  'created_at',
  'updated_at',
  'filled_at',
  'closed_at',
].join(', ');

export const WANTED_MESSAGE_SELECT = 'id, wanted_id, sender_id, body, created_at';

const TITLE_MIN = 3;
const TITLE_MAX = 160;
const DESCRIPTION_MAX = 4000;
const SHORT_MAX = 120;
const NAME_MAX = 200;
const AREA_MAX = 500;
const MESSAGE_MAX = 2000;

/** Keys a client must never write. Budget is what they hope to pay, not a charge. */
const BLOCKED_KEY = /stripe|checkout|price_id|listing_fee|premium|paid_ad|connect_account/i;

export type WantedWrite = {
  title: string;
  description: string;
  manufacturer: string | null;
  model: string | null;
  modality: EquipmentType;
  preferred_condition: WantedCondition;
  city: string | null;
  state: string | null;
  country: string | null;
  service_area: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  contact_via: WantedContact;
  poster_name: string | null;
  contact_name: string | null;
};

export type WantedRecord = WantedWrite & {
  id?: string;
  created_by?: string | null;
  organization_id?: string | number | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  filled_at?: string | null;
  closed_at?: string | null;
};

export type WantedFilters = {
  query?: string;
  modality?: string;
  condition?: string;
  status?: string;
  state?: string;
};

export type OrgWantedPrefill = {
  name?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  contact_name?: string | null;
  service_territories?: string[] | null;
};

export type LocationWantedPrefill = {
  city?: string | null;
  state?: string | null;
};

export type WantedValidation = { ok: true; value: WantedWrite } | { ok: false; error: string };

export { canPostWanted };

export function isWantedStatus(value: unknown): value is WantedStatus {
  return WANTED_STATUSES.includes(value as WantedStatus);
}

export function isPublicWantedStatus(status?: string | null): boolean {
  return PUBLIC_WANTED_STATUSES.includes(String(status || '').trim().toLowerCase() as WantedStatus);
}

export function wantedModalityLabel(value: unknown): string {
  return equipmentTypeLabel(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}

function money(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, value: null };
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a budget as a number, or leave it blank.' };
  if (n < 0) return { ok: false, error: 'Budget cannot be negative.' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function blockedKey(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    if (BLOCKED_KEY.test(key)) return key;
  }
  return null;
}

export function validateWantedWrite(body: unknown): WantedValidation {
  const rec = asRecord(body);
  if (!rec) return { ok: false, error: 'That wanted post could not be saved.' };
  const blocked = blockedKey(rec);
  if (blocked) {
    return { ok: false, error: 'Wanted posts are free. This board does not take payment.' };
  }

  const title = cleanText(rec.title, TITLE_MAX);
  if (title.length < TITLE_MIN) return { ok: false, error: 'Add a title (at least 3 characters).' };
  const description = String(rec.description ?? '').trim().slice(0, DESCRIPTION_MAX);
  if (!description) return { ok: false, error: 'Add a description of the equipment you are looking for.' };

  const modality = normalizeEquipmentType(rec.modality);
  if (!modality || !EQUIPMENT_TYPE_VALUES.includes(modality)) {
    return { ok: false, error: 'Choose a modality.' };
  }

  const conditionRaw = String(rec.preferred_condition ?? rec.condition ?? 'any')
    .trim()
    .toLowerCase();
  const preferred_condition = WANTED_CONDITIONS.includes(conditionRaw as WantedCondition)
    ? (conditionRaw as WantedCondition)
    : null;
  if (!preferred_condition) return { ok: false, error: 'Choose a preferred condition.' };

  const contactRaw = String(rec.contact_via ?? 'message')
    .trim()
    .toLowerCase();
  const contact_via = WANTED_CONTACT.includes(contactRaw as WantedContact) ? (contactRaw as WantedContact) : null;
  if (!contact_via) return { ok: false, error: 'Choose how sellers should reach you.' };

  const min = money(rec.budget_min);
  if (!min.ok) return min;
  const max = money(rec.budget_max);
  if (!max.ok) return max;
  if (min.value != null && max.value != null && max.value < min.value) {
    return { ok: false, error: 'Maximum budget cannot be less than the minimum.' };
  }

  let currency = cleanText(rec.currency || 'USD', 8).toUpperCase();
  if (!/^[A-Z]{3,8}$/.test(currency)) currency = 'USD';

  let state = cleanText(rec.state, SHORT_MAX);
  if (/^[A-Za-z]{2}$/.test(state)) state = state.toUpperCase();

  return {
    ok: true,
    value: {
      title,
      description,
      manufacturer: emptyToNull(cleanText(rec.manufacturer, SHORT_MAX)),
      model: emptyToNull(cleanText(rec.model, SHORT_MAX)),
      modality,
      preferred_condition,
      city: emptyToNull(cleanText(rec.city, SHORT_MAX)),
      state: emptyToNull(state),
      country: emptyToNull(cleanText(rec.country, SHORT_MAX)),
      service_area: emptyToNull(cleanText(rec.service_area, AREA_MAX)),
      budget_min: min.value,
      budget_max: max.value,
      currency,
      contact_via,
      poster_name: emptyToNull(cleanText(rec.poster_name, NAME_MAX)),
      contact_name: emptyToNull(cleanText(rec.contact_name, NAME_MAX)),
    },
  };
}

/** Insert row. Ownership is set here; the client cannot pick another org or a fee. */
export function buildWantedInsert(
  value: WantedWrite,
  actor: { userId: string; organizationId: number }
): Record<string, unknown> {
  return {
    ...value,
    created_by: actor.userId,
    organization_id: actor.organizationId,
    status: 'open',
  };
}

/** Content update. Status, ownership, and payment keys are not copied from the body. */
export function buildWantedContentUpdate(value: WantedWrite): Record<string, unknown> {
  return { ...value };
}

export function buildWantedStatusPatch(status: WantedStatus): { status: WantedStatus } {
  return { status };
}

export function validateWantedStatus(value: unknown): WantedStatus | null {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  return isWantedStatus(s) ? s : null;
}

export function validateWantedMessage(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const rec = asRecord(body);
  const text = String(rec?.body ?? rec?.message ?? '').trim();
  if (!text) return { ok: false, error: 'Write a message before sending.' };
  if (text.length > MESSAGE_MAX) return { ok: false, error: 'That message is too long.' };
  return { ok: true, body: text };
}

export function resolveWantedOrgId(
  requested: unknown,
  actor: { orgId?: string | number | null; membershipOrgIds?: Array<string | number | null | undefined> }
): number | null {
  const memberships = actor.membershipOrgIds || [];
  const allowed = (id: string | number | null | undefined) =>
    sameOrg(id, actor.orgId) || memberships.some((memberId) => sameOrg(memberId, id));
  const requestedId = typeof requested === 'number' || typeof requested === 'string' ? requested : null;
  if (requestedId != null && requestedId !== '' && allowed(requestedId)) {
    const n = Number(requestedId);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (actor.orgId != null && actor.orgId !== '' && allowed(actor.orgId)) {
    const n = Number(actor.orgId);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function canManageWanted(post: WantedRecord | null | undefined, actor: ListingActor): boolean {
  if (!post || !actor.userId) return false;
  if (post.created_by && post.created_by === actor.userId) return true;
  if (!actorBelongsToListingOrg(post, actor)) return false;
  return isAdmin(actor.role) || normalizeRole(actor.role) === 'owner';
}

export function prefillWantedFromOrg(
  org: OrgWantedPrefill | null | undefined,
  location?: LocationWantedPrefill | null
): Partial<WantedWrite> {
  const territories = Array.isArray(org?.service_territories)
    ? org.service_territories.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
    : '';
  const state = cleanText(org?.state || location?.state, SHORT_MAX);
  return {
    poster_name: emptyToNull(cleanText(org?.name, NAME_MAX)),
    contact_name: emptyToNull(cleanText(org?.contact_name, NAME_MAX)),
    city: emptyToNull(cleanText(org?.city || location?.city, SHORT_MAX)),
    state: emptyToNull(/^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : state),
    country: emptyToNull(cleanText(org?.country, SHORT_MAX)),
    service_area: emptyToNull(cleanText(territories, AREA_MAX)),
    modality: 'laser',
    preferred_condition: 'any',
    contact_via: 'message',
    currency: 'USD',
  };
}

export type WantedBudgetView =
  | { kind: 'none' }
  | { kind: 'range'; min: string; max: string }
  | { kind: 'min'; amount: string }
  | { kind: 'max'; amount: string };

function formatMoney(amount: number, currency: string): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${code} ${amount}`;
  }
}

export function wantedBudgetView(post: {
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  currency?: string | null;
}): WantedBudgetView {
  const currency = String(post.currency || 'USD').toUpperCase();
  const min = post.budget_min == null || post.budget_min === '' ? null : Number(post.budget_min);
  const max = post.budget_max == null || post.budget_max === '' ? null : Number(post.budget_max);
  const minOk = min != null && Number.isFinite(min);
  const maxOk = max != null && Number.isFinite(max);
  if (minOk && maxOk) return { kind: 'range', min: formatMoney(min, currency), max: formatMoney(max, currency) };
  if (minOk) return { kind: 'min', amount: formatMoney(min, currency) };
  if (maxOk) return { kind: 'max', amount: formatMoney(max, currency) };
  return { kind: 'none' };
}

export function wantedLocationLabel(post: { city?: string | null; state?: string | null; country?: string | null; service_area?: string | null }): string {
  const place = [post.city, post.state, post.country].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
  const area = String(post.service_area || '').trim();
  if (place && area) return `${place} · ${area}`;
  return place || area;
}

export function filterWantedPosts<T extends WantedRecord>(rows: T[], filters: WantedFilters): T[] {
  const query = String(filters.query || '').trim().toLowerCase();
  const modality = String(filters.modality || '').trim().toLowerCase();
  const condition = String(filters.condition || '').trim().toLowerCase();
  const status = String(filters.status || '').trim().toLowerCase();
  const state = String(filters.state || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (modality && String(row.modality || '').toLowerCase() !== modality) return false;
    if (condition && String(row.preferred_condition || '').toLowerCase() !== condition) return false;
    if (status && String(row.status || '').toLowerCase() !== status) return false;
    if (state && !String(row.state || '').toLowerCase().includes(state)) return false;
    if (!query) return true;
    const hay = [row.title, row.description, row.manufacturer, row.model, row.poster_name, row.city, row.service_area, row.contact_name]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return hay.includes(query);
  });
}

export const WANTED_DB_MISSING_MESSAGE = 'The Wanted board is not on this database yet.';
export const WANTED_SAVE_FAILED_MESSAGE = 'That wanted post could not be saved.';

/** Message for a failed create or edit. A 503 with no body still names the missing migration. */
export function wantedApiErrorMessage(status: number, body: unknown): string {
  const rec = asRecord(body);
  const fromBody = typeof rec?.error === 'string' ? rec.error.trim() : '';
  if (fromBody) return fromBody;
  if (status === 503) return WANTED_DB_MISSING_MESSAGE;
  return WANTED_SAVE_FAILED_MESSAGE;
}

export function isMissingWantedTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  const msg = String(error.message || '');
  return /marketplace_wanted|schema cache/i.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

export function wantedBelongsToActor(post: WantedRecord, actor: ListingActor): boolean {
  if (!actor.userId) return false;
  if (post.created_by && post.created_by === actor.userId) return true;
  return actorBelongsToListingOrg(post, actor);
}

export function assertWantedActorCanPost(role?: RoleLike, orgType?: OrgTypeLike): string | null {
  if (canPostWanted(role, orgType)) return null;
  return 'You need an organization membership to post a wanted listing.';
}
