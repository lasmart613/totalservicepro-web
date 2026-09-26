/**
 * Prefill a Service Report from a schedule ticket.
 *
 * Android service_schedule.html (createServiceReportFromTicket, added in e3c9554)
 * opened service_report.html with customer/equipment query params. The website
 * ticket page (/service-tickets/[id], opened from the calendar since fa99915)
 * never included that button. 7e7d64e remapped the HTML schedule to
 * /service-schedule, so the live site lost the action. This module restores it
 * on the current /reports/new model (ticketId query + service_reports.ticket_id).
 */

import { persistedLocationId } from './customer-locations.ts';
import { memberDisplayName, looksLikeUuid } from './ticket-assignees.ts';
import {
  equipmentTypeOrDefault,
  inferEquipmentType,
  normalizeEquipmentType,
  type EquipmentType,
} from './equipment-types.ts';

export const REPORT_SERVICE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'PM', label: 'PM' },
  { value: 'Repair', label: 'Repair' },
  { value: 'PM+Repair', label: 'PM + Repair' },
  { value: 'Install', label: 'Install' },
  { value: 'Cal', label: 'Cal' },
];

const REPORT_SERVICE_TYPE_VALUES = new Set(REPORT_SERVICE_TYPE_OPTIONS.map((o) => o.value));

export type TicketReportPrefill = {
  ticketId: string;
  ticketNumber: string;
  customerOrganizationId: string | number | null;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerState: string;
  customerPhone: string;
  customerEmail: string;
  customerContactName: string;
  /** locations.id from the ticket. Null when the ticket has no customer_location_id. */
  locationId: string | number | null;
  /** Location or legacy site name. Empty when the ticket has neither. */
  siteName: string;
  equipmentId: string | number | null;
  equipmentMake: string;
  equipmentModel: string;
  equipmentName: string;
  serialNumber: string;
  equipmentType: EquipmentType;
  /** Empty means leave the report form default (PM). */
  serviceType: string;
  /** YYYY-MM-DD. Empty means leave the form default (today). */
  dateOut: string;
  serviceEngineer: string;
  comments: string;
};

export type ExistingTicketReport = {
  id: string;
  reportNumber: string | null;
  status: string | null;
};

export type TicketReportContext = {
  prefill: TicketReportPrefill;
  existingReports: ExistingTicketReport[];
};

export type TicketReportSource = {
  ticket: Record<string, unknown>;
  customer?: Record<string, unknown> | null;
  location?: Record<string, unknown> | null;
  equipment?: Record<string, unknown> | null;
  assignee?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
};

type QueryResult = {
  data?: any;
  error?: { message?: string } | null;
};

export type TicketReportClient = {
  from: (table: string) => {
    select: (columns: string) => any;
  };
};

export function newServiceReportHref(ticketId: string | number): string {
  return `/reports/new?ticketId=${encodeURIComponent(String(ticketId))}`;
}

/** Numeric service_tickets.id only. */
export function normalizeTicketId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return /^\d+$/.test(s) ? s : '';
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

/** Ticket snapshot wins; linked site, then customer org, fill blanks. */
function gapFill(
  ticketValue: unknown,
  locationValue: unknown,
  customerValue: unknown
): string {
  return firstNonEmpty(ticketValue, locationValue, customerValue);
}

/**
 * Reports have no zip column. Keep a site zip by appending it to the street
 * line when it is not already written there.
 */
export function addressWithZip(address: unknown, zip: unknown): string {
  const street = clean(address);
  const postal = clean(zip);
  if (!postal) return street;
  if (street.toLowerCase().includes(postal.toLowerCase())) return street;
  return street ? `${street}, ${postal}` : postal;
}

export function isoDateOnly(value: unknown): string {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/**
 * Map a ticket service type onto the report form options.
 * Calibration → Cal. Unknown labels (Training, Other) are kept so the form
 * can show them instead of dropping the ticket value.
 */
export function mapTicketServiceType(raw: unknown): string {
  const original = clean(raw);
  const key = original.toLowerCase().replace(/\s+/g, ' ');
  if (!key) return '';
  if (key === 'pm' || key === 'preventive maintenance' || key === 'preventative maintenance') {
    return 'PM';
  }
  if (key === 'repair') return 'Repair';
  if (key === 'pm+repair' || key === 'pm + repair' || key === 'pm and repair') return 'PM+Repair';
  if (key === 'install' || key === 'installation') return 'Install';
  if (key === 'cal' || key === 'calibration') return 'Cal';
  if (REPORT_SERVICE_TYPE_VALUES.has(original)) return original;
  return original;
}

/** Description and notes, without repeating the same text twice. */
export function ticketProblemComments(description: unknown, notes: unknown): string {
  const problem = clean(description);
  const extra = clean(notes);
  if (!problem) return extra;
  if (!extra || extra === problem) return problem;
  return `${problem}\n\n${extra}`;
}

export function reportPrefillFromTicket(source: TicketReportSource): TicketReportPrefill | null {
  const ticket = source.ticket || {};
  const ticketId = normalizeTicketId(ticket.id);
  if (!ticketId) return null;

  const customer = source.customer || null;
  const location = source.location || null;
  const equipment = source.equipment || null;

  const make = gapFill(ticket.equipment_make, null, equipment?.manufacturer);
  const model = gapFill(ticket.equipment_model, null, equipment?.model);
  const serial = gapFill(ticket.serial_number, null, equipment?.serial_number);
  const explicitType = normalizeEquipmentType(ticket.equipment_type);
  const equipmentType =
    explicitType ||
    inferEquipmentType({
      title: [make, model].filter(Boolean).join(' '),
      brand: make,
      model,
    });

  const street = gapFill(
    firstNonEmpty(ticket.customer_address, ticket.address),
    location?.address,
    customer?.address
  );
  const zip = gapFill(ticket.zip, location?.zip, customer?.zip);

  let serviceEngineer = '';
  if (source.assignee) {
    serviceEngineer = memberDisplayName(source.assignee);
    if (serviceEngineer === 'Team member') serviceEngineer = '';
  }
  if (!serviceEngineer) {
    const rawAssignee = firstNonEmpty(ticket.assigned_to, ticket.assigned_fse);
    if (rawAssignee && !looksLikeUuid(rawAssignee)) serviceEngineer = rawAssignee;
  }

  const customerOrganizationId =
    ticket.customer_organization_id ??
    equipment?.customer_organization_id ??
    customer?.id ??
    null;

  return {
    ticketId,
    ticketNumber: clean(ticket.ticket_number),
    customerOrganizationId:
      customerOrganizationId == null || customerOrganizationId === ''
        ? null
        : (customerOrganizationId as string | number),
    customerName: gapFill(ticket.customer_name, null, customer?.name),
    customerAddress: addressWithZip(street, zip),
    customerCity: gapFill(firstNonEmpty(ticket.customer_city, ticket.city), location?.city, customer?.city),
    customerState: gapFill(
      firstNonEmpty(ticket.customer_state, ticket.state),
      location?.state,
      customer?.state
    ),
    customerPhone: gapFill(ticket.customer_phone, location?.phone, customer?.phone),
    customerEmail: gapFill(ticket.customer_email, null, customer?.email),
    customerContactName: gapFill(null, location?.contact_name, customer?.contact_name),
    locationId: persistedLocationId(ticket.customer_location_id),
    siteName: clean(location?.name),
    equipmentId: (ticket.equipment_id ?? equipment?.id ?? null) as string | number | null,
    equipmentMake: make,
    equipmentModel: model,
    equipmentName: [make, model].filter(Boolean).join(' '),
    serialNumber: serial,
    equipmentType: equipmentTypeOrDefault(equipmentType),
    serviceType: mapTicketServiceType(ticket.service_type),
    dateOut: isoDateOnly(ticket.service_date),
    serviceEngineer,
    comments: ticketProblemComments(ticket.description, ticket.notes),
  };
}

export function catalogManufacturerValue(
  make: string,
  manufacturers: { id?: string | number | null; name?: string | null }[]
): string {
  const needle = clean(make).toLowerCase();
  if (!needle) return '';
  const named = manufacturers
    .map((row) => ({
      value: String(row.id || row.name || ''),
      name: clean(row.name).toLowerCase(),
    }))
    .filter((row) => row.value && row.name);
  const exact = named.find((row) => row.name === needle);
  if (exact) return exact.value;
  const partial = named.find((row) => row.name.includes(needle) || needle.includes(row.name));
  return partial ? partial.value : make;
}

export function catalogModelValue(
  model: string,
  models: { name?: string | null; label?: string | null }[]
): string {
  const needle = clean(model).toLowerCase();
  if (!needle) return '';
  const exact = models.find((row) => clean(row.name || row.label).toLowerCase() === needle);
  if (exact) return clean(exact.name || exact.label);
  return clean(model);
}

function isMissingColumn(error: { message?: string } | null | undefined, column: string): boolean {
  const message = String(error?.message || '');
  return new RegExp(column, 'i').test(message) && /column|schema cache|does not exist|PGRST204/i.test(message);
}

function isMissingSchema(error: { message?: string } | null | undefined): boolean {
  const message = String(error?.message || '');
  return /could not find the table|does not exist|schema cache|PGRST205|permission denied/i.test(message);
}

function sameId(a: unknown, b: unknown): boolean {
  if (a == null || a === '' || b == null || b === '') return false;
  return String(a) === String(b);
}

async function maybeOne(query: any): Promise<QueryResult> {
  try {
    const res = await query.maybeSingle();
    return { data: res?.data ?? null, error: res?.error ?? null };
  } catch (error: any) {
    return { data: null, error: { message: error?.message || String(error) } };
  }
}

async function many(query: any): Promise<QueryResult> {
  try {
    const res = await query;
    return { data: res?.data ?? null, error: res?.error ?? null };
  } catch (error: any) {
    return { data: null, error: { message: error?.message || String(error) } };
  }
}

async function loadLinkedCustomer(
  supabase: TicketReportClient,
  customerOrganizationId: unknown
): Promise<Record<string, unknown> | null> {
  if (customerOrganizationId == null || customerOrganizationId === '') return null;
  const res = await maybeOne(
    supabase
      .from('organizations')
      .select('id, name, address, city, state, zip, phone, email, contact_name')
      .eq('id', customerOrganizationId)
  );
  if (res.error || !res.data) return null;
  return res.data as Record<string, unknown>;
}

async function loadLinkedLocation(
  supabase: TicketReportClient,
  ticket: Record<string, unknown>,
  customerOrganizationId: unknown
): Promise<Record<string, unknown> | null> {
  const locationId = ticket.customer_location_id;
  if (locationId != null && locationId !== '') {
    const scoped = (columns: string) => {
      let query = supabase.from('locations').select(columns).eq('id', locationId);
      if (customerOrganizationId != null && customerOrganizationId !== '') {
        query = query.eq('organization_id', customerOrganizationId);
      }
      return query;
    };
    let res = await maybeOne(
      scoped('id, organization_id, name, address, city, state, zip, phone, contact_name')
    );
    if (isMissingColumn(res.error, 'contact_name')) {
      res = await maybeOne(scoped('id, organization_id, name, address, city, state, zip, phone'));
    }
    if (!res.error && res.data) {
      if (
        customerOrganizationId != null &&
        customerOrganizationId !== '' &&
        res.data.organization_id != null &&
        !sameId(res.data.organization_id, customerOrganizationId)
      ) {
        return null;
      }
      return res.data as Record<string, unknown>;
    }
    if (res.error && !isMissingSchema(res.error)) return null;
  }

  const siteId = ticket.site_id;
  if (siteId == null || siteId === '') return null;
  const site = await maybeOne(
    supabase
      .from('sites')
      .select('id, organization_id, name, address, city, state, zip')
      .eq('id', siteId)
  );
  if (site.error || !site.data) return null;
  if (
    customerOrganizationId != null &&
    customerOrganizationId !== '' &&
    site.data.organization_id != null &&
    !sameId(site.data.organization_id, customerOrganizationId)
  ) {
    return null;
  }
  return site.data as Record<string, unknown>;
}

async function loadLinkedEquipment(
  supabase: TicketReportClient,
  equipmentId: unknown
): Promise<Record<string, unknown> | null> {
  if (equipmentId == null || equipmentId === '') return null;
  const res = await maybeOne(
    supabase
      .from('equipment')
      .select('id, manufacturer, model, serial_number, customer_organization_id')
      .eq('id', equipmentId)
  );
  if (res.error || !res.data) return null;
  return res.data as Record<string, unknown>;
}

async function loadAssignee(
  supabase: TicketReportClient,
  assignedTo: unknown
): Promise<TicketReportSource['assignee']> {
  if (!looksLikeUuid(assignedTo)) return null;
  const res = await maybeOne(
    supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email')
      .eq('id', String(assignedTo))
  );
  if (res.error || !res.data) return null;
  return res.data;
}

function normalizeExisting(rows: any[]): ExistingTicketReport[] {
  const seen = new Set<string>();
  const out: ExistingTicketReport[] = [];
  for (const row of rows) {
    const id = clean(row?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      reportNumber: clean(row.report_number) || null,
      status: clean(row.status) || null,
    });
  }
  return out;
}

/** Reports already saved for this ticket, scoped to the ticket's shop. */
export async function listReportsForTicket(
  supabase: TicketReportClient,
  ticket: Record<string, unknown>
): Promise<ExistingTicketReport[]> {
  const ticketId = normalizeTicketId(ticket.id);
  const ticketNumber = clean(ticket.ticket_number);
  if (!ticketId && !ticketNumber) return [];
  const orgId = ticket.organization_id;
  const columns = 'id, report_number, status, ticket_id, ticket_number, organization_id';

  const scoped = (column: string, value: string) => {
    let query = supabase.from('service_reports').select(columns).eq(column, value);
    if (orgId != null && orgId !== '') query = query.eq('organization_id', orgId);
    return query;
  };

  const rows: any[] = [];
  if (ticketId) {
    const byId = await many(scoped('ticket_id', ticketId));
    if (!byId.error && Array.isArray(byId.data)) rows.push(...byId.data);
  }
  if (ticketNumber) {
    const byNumber = await many(scoped('ticket_number', ticketNumber));
    if (!byNumber.error && Array.isArray(byNumber.data)) rows.push(...byNumber.data);
  }
  return normalizeExisting(rows);
}

/**
 * Load a ticket and linked customer, site, device, and assignee through the
 * caller's Supabase client (RLS). A ticket from another shop is ignored when
 * the caller org is known.
 */
export async function loadTicketReportContext(
  supabase: TicketReportClient,
  ticketId: string | number,
  opts?: { organizationId?: string | number | null }
): Promise<TicketReportContext | null> {
  const id = normalizeTicketId(ticketId);
  if (!id) return null;

  const ticketRes = await maybeOne(supabase.from('service_tickets').select('*').eq('id', id));
  if (ticketRes.error || !ticketRes.data) return null;
  const ticket = ticketRes.data as Record<string, unknown>;

  const callerOrg = opts?.organizationId;
  if (
    callerOrg != null &&
    callerOrg !== '' &&
    ticket.organization_id != null &&
    ticket.organization_id !== '' &&
    !sameId(ticket.organization_id, callerOrg)
  ) {
    return null;
  }

  const customerOrganizationId = ticket.customer_organization_id;
  const [customer, location, equipment, assignee, existingReports] = await Promise.all([
    loadLinkedCustomer(supabase, customerOrganizationId),
    loadLinkedLocation(supabase, ticket, customerOrganizationId),
    loadLinkedEquipment(supabase, ticket.equipment_id),
    loadAssignee(supabase, ticket.assigned_to),
    listReportsForTicket(supabase, ticket),
  ]);

  const prefill = reportPrefillFromTicket({ ticket, customer, location, equipment, assignee });
  if (!prefill) return null;
  return { prefill, existingReports };
}
