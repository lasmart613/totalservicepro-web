/**
 * Customer-record equipment: the existing public.equipment row, keyed by
 * customer_organization_id and location_id. Add, edit, and soft-remove.
 *
 * Soft-remove sets removed_at when a ticket or service report still points
 * at the row. The id stays, so those links keep working. A unit with no
 * history is deleted. A removed serial can be restored by saving it again.
 */
import { textsMatchCaseInsensitive } from './email-match.ts';
import { normalizeEquipmentType, type EquipmentType } from './equipment-types.ts';
import {
  applyLocationToTicketFields,
  persistedLocationId,
  type CustomerLocation,
  type TicketLocationFields,
} from './customer-locations.ts';

export type CustomerEquipmentRecord = {
  id: number | string;
  customer_organization_id: number | string | null;
  equipment_type: EquipmentType | null;
  manufacturer: string;
  model: string;
  serial_number: string;
  location_id: number | string | null;
  install_date: string;
  warranty_or_contract: string;
  notes: string;
  removed_at: string | null;
};

export type EquipmentRecordDraft = {
  equipment_type?: string | null;
  manufacturer: string;
  model: string;
  serial: string;
  location_id?: string | number | null;
  install_date?: string | null;
  warranty_or_contract?: string | null;
  notes?: string | null;
};

export type EquipmentLink = {
  id: string | number;
  equipment_id?: string | number | null;
  serial_number?: string | null;
  label: string;
  href: string;
};

type Client = { from: (table: string) => any };

const FULL_COLUMNS =
  'id, customer_organization_id, equipment_type, manufacturer, model, serial_number, location_id, install_date, warranty_or_contract, notes, removed_at';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function columnMissing(err: { message?: string; code?: string } | null | undefined, name: string): boolean {
  if (!err) return false;
  const text = `${err.code || ''} ${err.message || ''}`;
  if (!new RegExp(`\\b${name}\\b`, 'i').test(text)) return false;
  return /42703|PGRST204|column|schema cache|does not exist/i.test(text);
}

function optionalColumns(err: { message?: string; code?: string } | null | undefined): string[] {
  return ['removed_at', 'warranty_or_contract', 'install_date', 'location_id', 'notes', 'equipment_type'].filter(
    (name) => columnMissing(err, name)
  );
}

export function toCustomerEquipmentRecord(row: any): CustomerEquipmentRecord | null {
  if (!row || row.id == null || row.id === '') return null;
  const install = clean(row.install_date).slice(0, 10);
  return {
    id: row.id,
    customer_organization_id: row.customer_organization_id ?? null,
    equipment_type: normalizeEquipmentType(row.equipment_type),
    manufacturer: clean(row.manufacturer),
    model: clean(row.model),
    serial_number: clean(row.serial_number),
    location_id:
      row.location_id == null || row.location_id === '' ? null : (row.location_id as string | number),
    install_date: /^\d{4}-\d{2}-\d{2}$/.test(install) ? install : '',
    warranty_or_contract: clean(row.warranty_or_contract),
    notes: clean(row.notes),
    removed_at: row.removed_at ? String(row.removed_at) : null,
  };
}

export function equipmentLocationLabel(
  locationId: string | number | null | undefined,
  locations: CustomerLocation[]
): string {
  if (locationId == null || locationId === '') return 'Unassigned';
  const loc = locations.find((row) => String(row.id) === String(locationId));
  if (!loc) return 'Saved site';
  const place = [loc.city, loc.state].filter(Boolean).join(', ');
  return place ? `${loc.name} · ${place}` : loc.name || 'Saved site';
}

/** Active roster only. Removed rows stay in the table for ticket links. */
export async function loadCustomerEquipmentRecords(
  client: Client,
  customerOrgId: string | number | null | undefined
): Promise<CustomerEquipmentRecord[]> {
  if (customerOrgId == null || customerOrgId === '') return [];
  let columns = FULL_COLUMNS;
  const run = (cols: string) => {
    let q = client.from('equipment').select(cols).eq('customer_organization_id', customerOrgId);
    if (cols.includes('removed_at') && typeof q.is === 'function') q = q.is('removed_at', null);
    return q.order('manufacturer', { ascending: true }).order('model', { ascending: true }).limit(200);
  };
  try {
    let res = await run(columns);
    const dropped = new Set<string>();
    for (let attempt = 0; attempt < 6 && res?.error; attempt++) {
      const names = optionalColumns(res.error).filter((name) => columns.includes(name) && !dropped.has(name));
      if (!names.length) break;
      for (const name of names) dropped.add(name);
      columns = columns
        .split(',')
        .map((part) => part.trim())
        .filter((part) => !dropped.has(part))
        .join(', ');
      res = await run(columns);
    }
    if (res?.error || !Array.isArray(res?.data)) {
      if (res?.error) console.warn('loadCustomerEquipmentRecords', res.error);
      return [];
    }
    return (res.data as any[])
      .map(toCustomerEquipmentRecord)
      .filter((row): row is CustomerEquipmentRecord => row != null && !row.removed_at);
  } catch (err) {
    console.warn('loadCustomerEquipmentRecords', err);
    return [];
  }
}

export function equipmentWriteRow(
  customerOrgId: string | number,
  draft: EquipmentRecordDraft
): { ok: true; row: Record<string, unknown> } | { ok: false; reason: 'incomplete' | 'bad_date' } {
  const manufacturer = clean(draft.manufacturer);
  const model = clean(draft.model);
  if (!manufacturer || !model || /^__/.test(manufacturer) || /^__/.test(model)) {
    return { ok: false, reason: 'incomplete' };
  }
  const install = clean(draft.install_date);
  if (install && !/^\d{4}-\d{2}-\d{2}$/.test(install)) return { ok: false, reason: 'bad_date' };
  const serial = clean(draft.serial);
  const row: Record<string, unknown> = {
    customer_organization_id: customerOrgId,
    manufacturer,
    model,
    serial_number: serial || null,
    location_id: persistedLocationId(draft.location_id),
    install_date: install || null,
    warranty_or_contract: clean(draft.warranty_or_contract) || null,
    notes: clean(draft.notes) || null,
    removed_at: null,
  };
  const type = normalizeEquipmentType(draft.equipment_type);
  if (type) row.equipment_type = type;
  return { ok: true, row };
}

export type SaveEquipmentResult =
  | { status: 'saved'; id: number | string }
  | { status: 'restored'; id: number | string }
  | { status: 'exists'; id: number | string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

async function writeRow(
  client: Client,
  op: 'insert' | 'update',
  id: string | number | null,
  row: Record<string, unknown>
): Promise<{ data: { id?: string | number } | null; error: any }> {
  const payload = { ...row };
  let blankSerialRetried = false;
  let last: { data: { id?: string | number } | null; error: any } = {
    data: null,
    error: { message: 'save_failed' },
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const query =
      op === 'insert'
        ? client.from('equipment').insert([payload]).select('id').maybeSingle()
        : client
            .from('equipment')
            .update(payload)
            .eq('id', id)
            .eq('customer_organization_id', row.customer_organization_id)
            .select('id')
            .maybeSingle();
    const res = await query;
    if (!res?.error) return res;
    last = res;
    const missing = optionalColumns(res.error).find((name) => name in payload);
    if (missing) {
      delete payload[missing];
      continue;
    }
    if (
      !blankSerialRetried &&
      (payload.serial_number == null || payload.serial_number === '') &&
      (res.error.code === '23502' || /null value/i.test(String(res.error.message || '')))
    ) {
      blankSerialRetried = true;
      payload.serial_number = '';
      continue;
    }
    return res;
  }
  return last;
}

async function serialOwner(
  client: Client,
  customerOrgId: string | number,
  serial: string
): Promise<{ id: string | number; removed_at: string | null } | null> {
  if (!serial) return null;
  try {
    const res = await client
      .from('equipment')
      .select('id, serial_number, removed_at')
      .eq('customer_organization_id', customerOrgId)
      .limit(200);
    if (res?.error || !Array.isArray(res?.data)) return null;
    const hit = (res.data as any[]).find((row) => textsMatchCaseInsensitive(row?.serial_number, serial));
    if (!hit?.id) return null;
    return { id: hit.id, removed_at: hit.removed_at ? String(hit.removed_at) : null };
  } catch {
    return null;
  }
}

export async function saveCustomerEquipmentRecord(
  client: Client,
  customerOrgId: string | number | null | undefined,
  equipmentId: string | number | null,
  draft: EquipmentRecordDraft
): Promise<SaveEquipmentResult> {
  if (customerOrgId == null || customerOrgId === '') return { status: 'skipped', reason: 'no_customer' };
  const written = equipmentWriteRow(customerOrgId, draft);
  if (!written.ok) return { status: 'skipped', reason: written.reason };
  const serial = clean(draft.serial);
  const owner = await serialOwner(client, customerOrgId, serial);
  if (owner && String(owner.id) !== String(equipmentId ?? '')) {
    if (!equipmentId && owner.removed_at) {
      const restored = await writeRow(client, 'update', owner.id, written.row);
      if (restored.error) return { status: 'failed', reason: failReason(restored.error, serial) };
      if (restored.data?.id == null) return { status: 'failed', reason: 'not_allowed' };
      return { status: 'restored', id: restored.data.id };
    }
    return { status: 'exists', id: owner.id };
  }
  const res = await writeRow(client, equipmentId ? 'update' : 'insert', equipmentId, written.row);
  if (res.error) return { status: 'failed', reason: failReason(res.error, serial) };
  const id = res.data?.id ?? equipmentId;
  if (id == null) return { status: 'failed', reason: 'not_allowed' };
  return { status: 'saved', id };
}

function failReason(err: { code?: string; message?: string }, serial: string): string {
  const msg = String(err?.message || '');
  if (err?.code === '23505' || /unique|duplicate/i.test(msg)) return serial ? 'duplicate_serial' : 'duplicate_blank_serial';
  if (err?.code === '42501' || /row-level security|permission/i.test(msg)) return 'not_allowed';
  if (err?.code === '23502' || /null value/i.test(msg)) return 'missing_field';
  return msg || 'save_failed';
}

export function equipmentSaveMessage(result: SaveEquipmentResult): string | null {
  switch (result.status) {
    case 'saved':
      return 'Equipment saved.';
    case 'restored':
      return 'That serial was removed. It is back on this customer.';
    case 'exists':
      return 'That serial is already on file for this customer.';
    case 'skipped':
      if (result.reason === 'incomplete') return 'Manufacturer and model are required.';
      if (result.reason === 'bad_date') return 'Install date must be a calendar day.';
      return null;
    case 'failed':
      if (result.reason === 'duplicate_serial') return 'That serial is already on file for this customer.';
      if (result.reason === 'duplicate_blank_serial')
        return 'This customer already has a unit with no serial number. Enter a serial so they can be told apart.';
      if (result.reason === 'not_allowed') return 'Your company cannot change equipment for this customer.';
      if (result.reason === 'missing_field') return 'A required field is missing. Check make and model.';
      if (result.reason && result.reason !== 'save_failed') return `Could not save the equipment: ${result.reason}`;
      return 'Could not save the equipment.';
  }
}

export type RemoveEquipmentResult =
  | { status: 'archived' }
  | { status: 'deleted' }
  | { status: 'failed'; reason: string };

/** History keeps the row. No history deletes it. A foreign key also archives. */
export function removalMode(ticketCount: number, reportCount: number): 'archive' | 'delete' {
  return ticketCount + reportCount > 0 ? 'archive' : 'delete';
}

async function hasLink(client: Client, table: string, equipmentId: string | number): Promise<boolean | null> {
  try {
    const res = await client.from(table).select('id').eq('equipment_id', equipmentId).limit(1);
    if (res?.error) return null;
    return Array.isArray(res?.data) && res.data.length > 0;
  } catch {
    return null;
  }
}

export async function removeCustomerEquipmentRecord(
  client: Client,
  customerOrgId: string | number,
  equipmentId: string | number
): Promise<RemoveEquipmentResult> {
  const tickets = await hasLink(client, 'service_tickets', equipmentId);
  const reports = await hasLink(client, 'service_reports', equipmentId);
  const unknown = tickets == null || reports == null;
  const archive = unknown || removalMode(tickets ? 1 : 0, reports ? 1 : 0) === 'archive';
  if (archive) return archiveEquipment(client, customerOrgId, equipmentId);
  const deleted = await client
    .from('equipment')
    .delete()
    .eq('id', equipmentId)
    .eq('customer_organization_id', customerOrgId)
    .select('id')
    .maybeSingle();
  if (!deleted?.error && deleted?.data?.id != null) return { status: 'deleted' };
  if (deleted?.error && (deleted.error.code === '23503' || /foreign key/i.test(String(deleted.error.message || '')))) {
    return archiveEquipment(client, customerOrgId, equipmentId);
  }
  if (deleted?.error) return { status: 'failed', reason: failReason(deleted.error, '') };
  return { status: 'failed', reason: 'not_allowed' };
}

async function archiveEquipment(
  client: Client,
  customerOrgId: string | number,
  equipmentId: string | number
): Promise<RemoveEquipmentResult> {
  const res = await client
    .from('equipment')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', equipmentId)
    .eq('customer_organization_id', customerOrgId)
    .select('id')
    .maybeSingle();
  if (!res?.error && res?.data?.id != null) return { status: 'archived' };
  if (res?.error && columnMissing(res.error, 'removed_at')) return { status: 'failed', reason: 'history_keep' };
  if (res?.error) return { status: 'failed', reason: failReason(res.error, '') };
  return { status: 'failed', reason: 'not_allowed' };
}

export function equipmentRemoveMessage(result: RemoveEquipmentResult): string {
  if (result.status === 'archived') return 'Equipment hidden. Tickets and reports still link to it.';
  if (result.status === 'deleted') return 'Equipment removed.';
  if (result.reason === 'history_keep')
    return 'This unit has service history, so it was not deleted. Apply the equipment update before hiding it.';
  if (result.reason === 'not_allowed') return 'Your company cannot change equipment for this customer.';
  return 'Could not remove the equipment.';
}

export type TicketEquipmentPrefill = {
  equipment_type: EquipmentType | null;
  equipment_make: string;
  equipment_model: string;
  serial_number: string;
  /** Set only when the unit has a saved customer location. */
  selectedLocationId: string | null;
  address: TicketLocationFields | null;
};

/**
 * New-ticket fields copied from a saved unit. Location is applied only when
 * that unit has a location_id that is one of this customer's sites.
 */
export function ticketPatchFromSavedEquipment(opts: {
  equipment: {
    equipment_type?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serial_number?: string | null;
    location_id?: string | number | null;
  };
  locations: CustomerLocation[];
  current: {
    customer_address?: string | null;
    customer_city?: string | null;
    customer_state?: string | null;
    customer_zip?: string | null;
    customer_phone?: string | null;
    customer_contact?: string | null;
  };
  officePhone?: string | null;
}): TicketEquipmentPrefill {
  const loc =
    opts.equipment.location_id == null || opts.equipment.location_id === ''
      ? null
      : opts.locations.find(
          (row) => !row.localOnly && String(row.id) === String(opts.equipment.location_id)
        ) || null;
  return {
    equipment_type: normalizeEquipmentType(opts.equipment.equipment_type),
    equipment_make: clean(opts.equipment.manufacturer),
    equipment_model: clean(opts.equipment.model),
    serial_number: clean(opts.equipment.serial_number),
    selectedLocationId: loc ? String(loc.id) : null,
    address: loc ? applyLocationToTicketFields(opts.current, loc, { officePhone: opts.officePhone }) : null,
  };
}

export function scheduleEquipmentQuery(params: { get: (key: string) => string | null }): {
  customerId: string;
  equipmentId: string;
} | null {
  const customerId = clean(params.get('customer_id'));
  if (!customerId) return null;
  return { customerId, equipmentId: clean(params.get('equipment_id')) };
}

export function linksForEquipment(
  row: { id: string | number; serial_number?: string | null },
  tickets: Array<{ id: string | number; equipment_id?: string | number | null; serial_number?: string | null; ticket_number?: string | null }>,
  reports: Array<{ id: string | number; equipment_id?: string | number | null; serial_number?: string | null; report_number?: string | null }>
): { tickets: EquipmentLink[]; reports: EquipmentLink[] } {
  const serial = clean(row.serial_number).toLowerCase();
  const id = String(row.id);
  const match = (item: { equipment_id?: string | number | null; serial_number?: string | null }) =>
    (item.equipment_id != null && item.equipment_id !== '' && String(item.equipment_id) === id) ||
    (serial !== '' && clean(item.serial_number).toLowerCase() === serial);
  return {
    tickets: tickets.filter(match).map((ticket) => ({
      id: ticket.id,
      equipment_id: ticket.equipment_id,
      serial_number: ticket.serial_number,
      label: clean(ticket.ticket_number) || `Ticket ${ticket.id}`,
      href: `/service-tickets/${ticket.id}`,
    })),
    reports: reports.filter(match).map((report) => ({
      id: report.id,
      equipment_id: report.equipment_id,
      serial_number: report.serial_number,
      label: clean(report.report_number) || `Report ${String(report.id).slice(0, 8)}`,
      href: `/reports/${report.id}`,
    })),
  };
}

const TICKET_COLUMNS = 'id, ticket_number, status, equipment_id, serial_number, equipment_make, equipment_model';

export async function loadCustomerEquipmentTickets(
  client: Client,
  customerOrgId: string | number
): Promise<
  Array<{
    id: string | number;
    ticket_number?: string | null;
    equipment_id?: string | number | null;
    serial_number?: string | null;
    status?: string | null;
  }>
> {
  let columns = TICKET_COLUMNS;
  let orderByCreated = true;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      let q = client.from('service_tickets').select(columns).eq('customer_organization_id', customerOrgId);
      if (orderByCreated && typeof q.order === 'function') q = q.order('created_at', { ascending: false });
      const res = await q.limit(200);
      if (!res?.error) return Array.isArray(res?.data) ? res.data : [];
      const text = `${res.error.code || ''} ${res.error.message || ''}`;
      if (orderByCreated && /\bcreated_at\b/i.test(text)) {
        orderByCreated = false;
        continue;
      }
      const name = ['equipment_id', 'serial_number', 'ticket_number', 'equipment_make', 'equipment_model', 'status'].find(
        (col) => columns.includes(col) && new RegExp(`\\b${col}\\b`, 'i').test(text)
      );
      if (!name) return [];
      columns = columns
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== name)
        .join(', ');
    }
    return [];
  } catch {
    return [];
  }
}
