/**
 * Customer org equipment for the estimate and invoice forms.
 *
 * Reads and writes go through the live equipment RLS policies only:
 *  - equipment_service_org_manage: members of a service org linked to the
 *    customer in organization_customers (or the customer org's owner).
 *  - equipment_member_select: members of the customer org.
 * Nothing here reads service history, pricing, notes, or other shops' rows,
 * and a serial match never moves or exposes a machine from another org.
 */
import { normalizeEquipmentType, type EquipmentType } from './equipment-types.ts';
import { textsMatchCaseInsensitive } from './email-match.ts';

export type CustomerEquipment = {
  id: number | string;
  equipment_type: EquipmentType | null;
  manufacturer: string;
  model: string;
  serial_number: string;
};

/** Only these columns are read. notes, service_notes, photo_url and room stay out. */
export const CUSTOMER_EQUIPMENT_COLUMNS = 'id, equipment_type, manufacturer, model, serial_number';
const LEGACY_COLUMNS = 'id, manufacturer, model, serial_number';
export const NEW_EQUIPMENT_VALUE = '__new__';

type Client = { from: (t: string) => any };

function clean(v: unknown): string {
  return String(v ?? '').trim();
}

function missingTypeColumn(err: any): boolean {
  const m = String(err?.message || '');
  return err?.code === '42703' || /equipment_type/i.test(m);
}

export function toCustomerEquipment(row: any): CustomerEquipment | null {
  if (!row || row.id == null) return null;
  return {
    id: row.id,
    equipment_type: normalizeEquipmentType(row.equipment_type),
    manufacturer: clean(row.manufacturer),
    model: clean(row.model),
    serial_number: clean(row.serial_number),
  };
}

export function customerEquipmentLabel(eq: CustomerEquipment): string {
  const name = [eq.manufacturer, eq.model].filter(Boolean).join(' ') || 'Equipment';
  return eq.serial_number ? `${name} — S/N ${eq.serial_number}` : name;
}

/** Equipment on file for one customer org. Empty on no org, RLS refusal, or error. */
export async function loadCustomerEquipment(
  client: Client,
  customerOrgId: string | number | null | undefined
): Promise<CustomerEquipment[]> {
  if (customerOrgId == null || customerOrgId === '') return [];
  const run = (cols: string) =>
    client
      .from('equipment')
      .select(cols)
      .eq('customer_organization_id', customerOrgId)
      .order('manufacturer', { ascending: true })
      .order('model', { ascending: true })
      .limit(200);
  try {
    let res = await run(CUSTOMER_EQUIPMENT_COLUMNS);
    if (res.error && missingTypeColumn(res.error)) res = await run(LEGACY_COLUMNS);
    if (res.error) {
      console.warn('loadCustomerEquipment', res.error);
      return [];
    }
    return ((res.data || []) as any[])
      .map(toCustomerEquipment)
      .filter((r): r is CustomerEquipment => r != null);
  } catch (e) {
    console.warn('loadCustomerEquipment', e);
    return [];
  }
}

export type EquipmentDraft = {
  equipment_type: EquipmentType | string | null;
  manufacturer: string;
  model: string;
  serial: string;
};

/** The on-file row the form currently describes (serial first, else make + model with no serial). */
export function matchCustomerEquipment(
  list: CustomerEquipment[],
  draft: EquipmentDraft
): CustomerEquipment | null {
  const serial = clean(draft.serial);
  if (serial) return list.find((r) => textsMatchCaseInsensitive(r.serial_number, serial)) || null;
  return null;
}

/** Show "Add this equipment to <org>" only for a complete machine not already on file. */
export function canOfferAddToOrg(
  list: CustomerEquipment[],
  draft: EquipmentDraft,
  customerOrgId: string | number | null | undefined
): boolean {
  if (customerOrgId == null || customerOrgId === '') return false;
  if (!clean(draft.manufacturer) || !clean(draft.model) || !clean(draft.serial)) return false;
  return matchCustomerEquipment(list, draft) == null;
}

export type AddEquipmentResult =
  | { status: 'created'; id: number | string }
  | { status: 'exists'; id: number | string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Insert a new equipment row on the customer org. Never updates or transfers an
 * existing row: a serial already on this customer's list returns 'exists', and
 * a duplicate anywhere else is reported, not reassigned.
 */
export async function addEquipmentToCustomerOrg(
  client: Client,
  customerOrgId: string | number | null | undefined,
  draft: EquipmentDraft
): Promise<AddEquipmentResult> {
  if (customerOrgId == null || customerOrgId === '') return { status: 'skipped', reason: 'no_customer_org' };
  const manufacturer = clean(draft.manufacturer);
  const model = clean(draft.model);
  const serial = clean(draft.serial);
  if (!manufacturer || !model || !serial) return { status: 'skipped', reason: 'incomplete' };
  if (/^__/.test(manufacturer) || /^__/.test(model)) return { status: 'skipped', reason: 'incomplete' };

  const current = await loadCustomerEquipment(client, customerOrgId);
  const hit = matchCustomerEquipment(current, draft);
  if (hit) return { status: 'exists', id: hit.id };

  const type = normalizeEquipmentType(draft.equipment_type);
  const row: Record<string, any> = {
    customer_organization_id: customerOrgId,
    manufacturer,
    model,
    serial_number: serial,
  };
  if (type) row.equipment_type = type;
  try {
    let ins = await client.from('equipment').insert([row]).select('id').maybeSingle();
    if (ins.error && type && missingTypeColumn(ins.error)) {
      const { equipment_type: _drop, ...slim } = row;
      ins = await client.from('equipment').insert([slim]).select('id').maybeSingle();
    }
    if (ins.error) {
      const msg = String(ins.error.message || '');
      if (ins.error.code === '23505' || /unique|duplicate/i.test(msg)) {
        return { status: 'failed', reason: 'duplicate_serial' };
      }
      if (ins.error.code === '42501' || /row-level security|permission/i.test(msg)) {
        return { status: 'failed', reason: 'not_allowed' };
      }
      return { status: 'failed', reason: msg || 'insert_failed' };
    }
    if (ins.data?.id == null) return { status: 'failed', reason: 'not_allowed' };
    return { status: 'created', id: ins.data.id };
  } catch (e: any) {
    return { status: 'failed', reason: String(e?.message || e) };
  }
}

export function addEquipmentMessage(result: AddEquipmentResult, orgName: string): string | null {
  const org = orgName || 'the customer';
  switch (result.status) {
    case 'created':
      return `Equipment added to ${org}.`;
    case 'exists':
      return null;
    case 'skipped':
      return result.reason === 'incomplete'
        ? `Not added to ${org}: manufacturer, model and serial # are all required.`
        : null;
    case 'failed':
      if (result.reason === 'duplicate_serial') return `Not added to ${org}: that serial # is already on file.`;
      if (result.reason === 'not_allowed')
        return `Not added to ${org}: your company is not linked to this customer.`;
      return `Could not add the equipment to ${org}.`;
  }
}
