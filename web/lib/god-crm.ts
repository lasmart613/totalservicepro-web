/**
 * God Dashboard CRM — composed views over live RepairPlanet / TSP tables.
 * There is no deals / pipeline table. Stages are derived from existing statuses.
 * clinic_service_leads is in later migrations and may be missing on live.
 */

import { fetchAllPages } from './supabase/paginate.ts';
import { currentOrgPlan, currentOrgPlanLabel, type OrgPlanFields } from './org-plan.ts';
import { orgTypeLabel } from './labels.ts';
import { isGodPlanName } from './god.ts';
import { GOD_CRM_PATH, godTableHref } from './god-tables.ts';

export { GOD_CRM_PATH };

export const CRM_TABS = ['pipeline', 'accounts', 'contacts', 'work'] as const;
export type CrmTab = (typeof CRM_TABS)[number];

export const CRM_PIPELINE_SOURCES = [
  'clinic_lead',
  'service_request',
  'waitlist',
  'marketplace_request',
] as const;
export type CrmPipelineSource = (typeof CRM_PIPELINE_SOURCES)[number];

export const CRM_WORK_KINDS = ['ticket', 'estimate', 'invoice'] as const;
export type CrmWorkKind = (typeof CRM_WORK_KINDS)[number];

export const OPEN_REQUEST_STATUSES = ['open', 'new', 'pending'] as const;
export const CLOSED_REQUEST_STATUSES = ['awarded', 'closed', 'cancelled', 'canceled', 'declined'] as const;
export const OPEN_ESTIMATE_STATUSES = ['draft', 'pending', 'sent'] as const;
export const WON_ESTIMATE_STATUSES = ['invoiced', 'approved', 'accepted'] as const;
export const LOST_ESTIMATE_STATUSES = ['expired', 'rejected', 'declined'] as const;
export const UNPAID_INVOICE_STATUSES = ['draft', 'sent', 'overdue', 'unpaid'] as const;
export const PAID_INVOICE_STATUSES = ['paid'] as const;
export const CLOSED_TICKET_STATUSES = ['completed', 'closed', 'cancelled', 'canceled'] as const;
export const NEEDS_SCHEDULING_TICKET = ['awaiting scheduling', 'unassigned', 'new', 'open'] as const;

const MISSING_TABLE =
  /relation .* does not exist|could not find the table|Could not find the table|schema cache/i;

export type CrmPipelineStage = 'new' | 'open' | 'awarded' | 'closed';
export type CrmWorkStage = 'open' | 'unpaid' | 'won' | 'lost' | 'active' | 'closed';

export type GodCrmPipelineItem = {
  id: string;
  source: CrmPipelineSource;
  sourceLabel: string;
  title: string;
  company: string | null;
  contact: string | null;
  email: string | null;
  location: string | null;
  status: string | null;
  stage: CrmPipelineStage;
  urgency: string | null;
  amount: number | null;
  createdAt: string | null;
  href: string;
  tableKey: string;
};

export type GodCrmAccount = {
  id: number | string;
  name: string;
  type: string;
  typeLabel: string;
  planKey: string;
  planLabel: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  createdAt: string | null;
  contactCount: number;
  customerCount: number;
  shopCount: number;
  href: string;
};

export type GodCrmContact = {
  id: number | string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
  orgId: number | string | null;
  orgName: string | null;
  createdAt: string | null;
  href: string;
};

export type GodCrmWorkItem = {
  id: string;
  kind: CrmWorkKind;
  kindLabel: string;
  title: string;
  customer: string | null;
  orgId: number | string | null;
  orgName: string | null;
  status: string | null;
  stage: CrmWorkStage;
  amount: number | null;
  createdAt: string | null;
  href: string;
  tableKey: string;
};

export type GodCrmSummary = {
  organizations: number | null;
  contacts: number | null;
  shopClinicLinks: number | null;
  openRequests: number | null;
  clinicLeads: number | null;
  waitlist: number | null;
  openTickets: number | null;
  needsScheduling: number | null;
  openEstimates: number | null;
  unpaidInvoices: number | null;
  activeListings: number | null;
};

export type GodCrmPayload = {
  ok: true;
  summary: GodCrmSummary;
  pipeline: GodCrmPipelineItem[];
  accounts: GodCrmAccount[];
  contacts: GodCrmContact[];
  work: GodCrmWorkItem[];
  missingTables: string[];
  notes: string[];
};

export type GodCrmOrgRow = OrgPlanFields & {
  id?: number | string | null;
  name?: string | null;
  type?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  created_at?: string | null;
};

export type GodCrmContactRow = {
  id?: number | string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  is_primary?: boolean | null;
  organization_id?: number | string | null;
  created_at?: string | null;
};

export type GodCrmRequestRow = {
  id?: number | string | null;
  title?: string | null;
  status?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  model_type?: string | null;
  city?: string | null;
  state?: string | null;
  location?: string | null;
  urgency?: string | null;
  price?: number | string | null;
  budget_max?: number | string | null;
  organization_id?: number | string | null;
  created_at?: string | null;
};

export type GodCrmLeadRow = {
  id?: number | string | null;
  clinic_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  equipment_type?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  urgency?: string | null;
  created_at?: string | null;
};

export type GodCrmWaitlistRow = {
  id?: number | string | null;
  email?: string | null;
  plan?: string | null;
  created_at?: string | null;
};

export type GodCrmMarketplaceRequestRow = {
  id?: number | string | null;
  title?: string | null;
  status?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  urgency?: string | null;
  organization_id?: number | string | null;
  created_at?: string | null;
};

export type GodCrmTicketRow = {
  id?: number | string | null;
  ticket_number?: string | null;
  status?: string | null;
  customer_name?: string | null;
  organization_id?: number | string | null;
  customer_organization_id?: number | string | null;
  created_at?: string | null;
};

export type GodCrmMoneyRow = {
  id?: number | string | null;
  estimate_number?: string | null;
  invoice_number?: string | null;
  status?: string | null;
  customer_name?: string | null;
  total?: number | string | null;
  organization_id?: number | string | null;
  customer_organization_id?: number | string | null;
  created_at?: string | null;
};

export type GodCrmLinkRow = {
  service_organization_id?: number | string | null;
  customer_organization_id?: number | string | null;
  organization_id?: number | string | null;
};

export type GodCrmSources = {
  orgs?: GodCrmOrgRow[] | null;
  contacts?: GodCrmContactRow[] | null;
  requests?: GodCrmRequestRow[] | null;
  leads?: GodCrmLeadRow[] | null;
  waitlist?: GodCrmWaitlistRow[] | null;
  marketplaceRequests?: GodCrmMarketplaceRequestRow[] | null;
  tickets?: GodCrmTicketRow[] | null;
  estimates?: GodCrmMoneyRow[] | null;
  invoices?: GodCrmMoneyRow[] | null;
  links?: GodCrmLinkRow[] | null;
  listingCounts?: { total?: number | null; active?: number | null };
  missingTables?: string[];
};

export function parseCrmTab(raw?: string | null): CrmTab {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return (CRM_TABS as readonly string[]).includes(v) ? (v as CrmTab) : 'pipeline';
}

export function normalizeStatus(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function inStatusList(status: string | null | undefined, list: readonly string[]): boolean {
  return list.includes(normalizeStatus(status));
}

export function personName(row: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  contact_name?: string | null;
}): string {
  const composed = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  const named = String(row.name || row.contact_name || '').trim();
  if (composed) return composed;
  if (named) return named;
  const email = String(row.email || '').trim();
  return email ? email.split('@')[0] : '';
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatCrmDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function asAmount(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function locationOf(row: { city?: string | null; state?: string | null; location?: string | null }): string | null {
  const cityState = [row.city, row.state].filter(Boolean).join(', ').trim();
  if (cityState) return cityState;
  const loc = String(row.location || '').trim();
  return loc || null;
}

function planKey(org: OrgPlanFields | null | undefined): string {
  const raw = String(org?.subscription_tier || org?.plan || '')
    .toLowerCase()
    .trim();
  if (raw === 'unpaid' || raw === 'canceled' || raw === 'cancelled' || raw === 'past_due') return 'unpaid';
  if (isGodPlanName(raw)) return currentOrgPlan({ is_premium: false });
  return currentOrgPlan(org);
}

function planLabel(org: OrgPlanFields | null | undefined): string {
  if (planKey(org) === 'unpaid') return 'Unpaid';
  return currentOrgPlanLabel(org);
}

export function requestPipelineStage(status?: string | null): CrmPipelineStage {
  const s = normalizeStatus(status);
  if (inStatusList(s, CLOSED_REQUEST_STATUSES) && s === 'awarded') return 'awarded';
  if (inStatusList(s, CLOSED_REQUEST_STATUSES)) return 'closed';
  if (!s || inStatusList(s, OPEN_REQUEST_STATUSES)) return 'open';
  return 'open';
}

export function estimateWorkStage(status?: string | null): CrmWorkStage {
  const s = normalizeStatus(status);
  if (inStatusList(s, WON_ESTIMATE_STATUSES)) return 'won';
  if (inStatusList(s, LOST_ESTIMATE_STATUSES)) return 'lost';
  return 'open';
}

export function invoiceWorkStage(status?: string | null): CrmWorkStage {
  const s = normalizeStatus(status);
  if (inStatusList(s, PAID_INVOICE_STATUSES)) return 'won';
  if (s === 'void' || s === 'cancelled' || s === 'canceled') return 'lost';
  if (inStatusList(s, UNPAID_INVOICE_STATUSES)) return 'unpaid';
  return 'unpaid';
}

export function ticketWorkStage(status?: string | null): CrmWorkStage {
  const s = normalizeStatus(status);
  if (inStatusList(s, CLOSED_TICKET_STATUSES)) return 'closed';
  return 'active';
}

export function needsSchedulingTicket(status?: string | null): boolean {
  return inStatusList(status, NEEDS_SCHEDULING_TICKET);
}

function sortNewest<T extends { createdAt?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
}

export function assembleGodCrm(input: GodCrmSources): GodCrmPayload {
  const orgs = input.orgs || [];
  const orgById = new Map<string, GodCrmOrgRow>();
  for (const org of orgs) {
    if (org.id == null) continue;
    orgById.set(String(org.id), org);
  }

  const contactRows = input.contacts || [];
  const contactsByOrg = new Map<string, number>();
  for (const row of contactRows) {
    if (row.organization_id == null || row.organization_id === '') continue;
    const key = String(row.organization_id);
    contactsByOrg.set(key, (contactsByOrg.get(key) || 0) + 1);
  }

  const customerCount = new Map<string, number>();
  const shopCount = new Map<string, number>();
  for (const link of input.links || []) {
    const shop = link.service_organization_id ?? link.organization_id;
    const clinic = link.customer_organization_id;
    if (shop != null && shop !== '') {
      const key = String(shop);
      customerCount.set(key, (customerCount.get(key) || 0) + 1);
    }
    if (clinic != null && clinic !== '') {
      const key = String(clinic);
      shopCount.set(key, (shopCount.get(key) || 0) + 1);
    }
  }

  const pipeline: GodCrmPipelineItem[] = [];

  for (const lead of input.leads || []) {
    pipeline.push({
      id: `lead:${lead.id}`,
      source: 'clinic_lead',
      sourceLabel: 'Clinic find-a-rep',
      title: String(lead.clinic_name || '').trim() || 'Clinic lead',
      company: String(lead.clinic_name || '').trim() || null,
      contact: personName(lead) || null,
      email: lead.email || null,
      location: lead.location || null,
      status: 'new',
      stage: 'new',
      urgency: lead.urgency || null,
      amount: null,
      createdAt: lead.created_at || null,
      href: godTableHref('clinic_service_leads'),
      tableKey: 'clinic_service_leads',
    });
  }

  for (const row of input.waitlist || []) {
    pipeline.push({
      id: `waitlist:${row.id}`,
      source: 'waitlist',
      sourceLabel: 'Waitlist',
      title: row.plan ? `Waitlist · ${row.plan}` : 'Plan waitlist',
      company: null,
      contact: row.email || null,
      email: row.email || null,
      location: null,
      status: 'new',
      stage: 'new',
      urgency: null,
      amount: null,
      createdAt: row.created_at || null,
      href: godTableHref('waitlist'),
      tableKey: 'waitlist',
    });
  }

  for (const row of input.requests || []) {
    const org = row.organization_id != null ? orgById.get(String(row.organization_id)) : undefined;
    const equipment = [row.manufacturer, row.model || row.model_type].filter(Boolean).join(' ').trim();
    pipeline.push({
      id: `request:${row.id}`,
      source: 'service_request',
      sourceLabel: 'Service request',
      title: String(row.title || '').trim() || equipment || 'Service request',
      company: org?.name || null,
      contact: null,
      email: org?.email || null,
      location: locationOf(row) || locationOf(org || {}),
      status: row.status || null,
      stage: requestPipelineStage(row.status),
      urgency: row.urgency || null,
      amount: asAmount(row.price ?? row.budget_max),
      createdAt: row.created_at || null,
      href: godTableHref('service_requests'),
      tableKey: 'service_requests',
    });
  }

  for (const row of input.marketplaceRequests || []) {
    const org = row.organization_id != null ? orgById.get(String(row.organization_id)) : undefined;
    pipeline.push({
      id: `mreq:${row.id}`,
      source: 'marketplace_request',
      sourceLabel: 'Marketplace request',
      title: String(row.title || '').trim() || 'Marketplace request',
      company: org?.name || null,
      contact: null,
      email: org?.email || null,
      location: locationOf(org || {}),
      status: row.status || null,
      stage: requestPipelineStage(row.status),
      urgency: row.urgency || null,
      amount: null,
      createdAt: row.created_at || null,
      href: godTableHref('marketplace_requests'),
      tableKey: 'marketplace_requests',
    });
  }

  const accounts: GodCrmAccount[] = orgs
    .filter((org) => org.id != null)
    .map((org) => {
      const key = String(org.id);
      return {
        id: org.id as number | string,
        name: String(org.name || '').trim() || `Organization ${org.id}`,
        type: String(org.type || '').trim() || 'unknown',
        typeLabel: orgTypeLabel(org.type) || 'Organization',
        planKey: planKey(org),
        planLabel: planLabel(org),
        email: org.email || null,
        phone: org.phone || null,
        city: org.city || null,
        state: org.state || null,
        createdAt: org.created_at || null,
        contactCount: contactsByOrg.get(key) || 0,
        customerCount: customerCount.get(key) || 0,
        shopCount: shopCount.get(key) || 0,
        href: godTableHref('organizations'),
      };
    });

  const contacts: GodCrmContact[] = contactRows
    .filter((row) => row.id != null)
    .map((row) => {
      const org = row.organization_id != null ? orgById.get(String(row.organization_id)) : undefined;
      return {
        id: row.id as number | string,
        name: personName(row) || 'Contact',
        email: row.email || null,
        phone: row.phone || null,
        title: row.title || null,
        isPrimary: Boolean(row.is_primary),
        orgId: row.organization_id ?? null,
        orgName: org?.name || null,
        createdAt: row.created_at || null,
        href: godTableHref('contacts'),
      };
    });

  const work: GodCrmWorkItem[] = [];

  for (const row of input.tickets || []) {
    const org = row.organization_id != null ? orgById.get(String(row.organization_id)) : undefined;
    const customerOrg =
      row.customer_organization_id != null ? orgById.get(String(row.customer_organization_id)) : undefined;
    work.push({
      id: `ticket:${row.id}`,
      kind: 'ticket',
      kindLabel: 'Ticket',
      title: String(row.ticket_number || '').trim() || `Ticket ${row.id}`,
      customer: row.customer_name || customerOrg?.name || null,
      orgId: row.organization_id ?? null,
      orgName: org?.name || null,
      status: row.status || null,
      stage: ticketWorkStage(row.status),
      amount: null,
      createdAt: row.created_at || null,
      href: godTableHref('service_tickets'),
      tableKey: 'service_tickets',
    });
  }

  for (const row of input.estimates || []) {
    const org = row.organization_id != null ? orgById.get(String(row.organization_id)) : undefined;
    work.push({
      id: `estimate:${row.id}`,
      kind: 'estimate',
      kindLabel: 'Estimate',
      title: String(row.estimate_number || '').trim() || `Estimate ${row.id}`,
      customer: row.customer_name || null,
      orgId: row.organization_id ?? null,
      orgName: org?.name || null,
      status: row.status || null,
      stage: estimateWorkStage(row.status),
      amount: asAmount(row.total),
      createdAt: row.created_at || null,
      href: godTableHref('service_estimates'),
      tableKey: 'service_estimates',
    });
  }

  for (const row of input.invoices || []) {
    const org = row.organization_id != null ? orgById.get(String(row.organization_id)) : undefined;
    work.push({
      id: `invoice:${row.id}`,
      kind: 'invoice',
      kindLabel: 'Invoice',
      title: String(row.invoice_number || '').trim() || `Invoice ${row.id}`,
      customer: row.customer_name || null,
      orgId: row.organization_id ?? null,
      orgName: org?.name || null,
      status: row.status || null,
      stage: invoiceWorkStage(row.status),
      amount: asAmount(row.total),
      createdAt: row.created_at || null,
      href: godTableHref('service_invoices'),
      tableKey: 'service_invoices',
    });
  }

  const missingTables = [...new Set(input.missingTables || [])];
  const notes = [
    'No deals / pipeline table exists. Stages are derived from service_requests, estimates, invoices, and tickets.',
  ];
  if (missingTables.includes('clinic_service_leads')) {
    notes.push(
      'clinic_service_leads is not on this Supabase project yet. Guest find-a-rep rows will appear here after that migration.'
    );
  }

  const openRequests = (input.requests || []).filter((r) => requestPipelineStage(r.status) === 'open').length;
  const openTickets = (input.tickets || []).filter((r) => ticketWorkStage(r.status) === 'active').length;
  const needsScheduling = (input.tickets || []).filter((r) => needsSchedulingTicket(r.status)).length;
  const openEstimates = (input.estimates || []).filter((r) => estimateWorkStage(r.status) === 'open').length;
  const unpaidInvoices = (input.invoices || []).filter((r) => invoiceWorkStage(r.status) === 'unpaid').length;

  return {
    ok: true,
    summary: {
      organizations: orgs.length,
      contacts: contactRows.length,
      shopClinicLinks: (input.links || []).length,
      openRequests,
      clinicLeads: missingTables.includes('clinic_service_leads') ? null : (input.leads || []).length,
      waitlist: (input.waitlist || []).length,
      openTickets,
      needsScheduling,
      openEstimates,
      unpaidInvoices,
      activeListings: input.listingCounts?.active ?? null,
    },
    pipeline: sortNewest(pipeline),
    accounts: sortNewest(accounts),
    contacts: sortNewest(contacts),
    work: sortNewest(work),
    missingTables,
    notes,
  };
}

export type GodCrmFilters = {
  q?: string | null;
  source?: string | null;
  stage?: string | null;
  type?: string | null;
  plan?: string | null;
  kind?: string | null;
};

function hay(...parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p != null && p !== '')
    .join(' ')
    .toLowerCase();
}

export function filterCrmPipeline(
  rows: GodCrmPipelineItem[],
  filters: GodCrmFilters = {}
): GodCrmPipelineItem[] {
  const q = String(filters.q || '')
    .trim()
    .toLowerCase();
  const source = String(filters.source || '')
    .trim()
    .toLowerCase();
  const stage = String(filters.stage || '')
    .trim()
    .toLowerCase();
  return rows.filter((row) => {
    if (source && source !== 'all' && row.source !== source) return false;
    if (stage && stage !== 'all' && row.stage !== stage) return false;
    if (!q) return true;
    return hay(row.title, row.company, row.contact, row.email, row.location, row.status, row.sourceLabel).includes(
      q
    );
  });
}

export function filterCrmAccounts(rows: GodCrmAccount[], filters: GodCrmFilters = {}): GodCrmAccount[] {
  const q = String(filters.q || '')
    .trim()
    .toLowerCase();
  const type = String(filters.type || '')
    .trim()
    .toLowerCase();
  const plan = String(filters.plan || '')
    .trim()
    .toLowerCase();
  return rows.filter((row) => {
    if (type && type !== 'all' && String(row.type).toLowerCase() !== type) return false;
    if (plan && plan !== 'all' && row.planKey !== plan) return false;
    if (!q) return true;
    return hay(row.name, row.email, row.phone, row.city, row.state, row.typeLabel, row.planLabel).includes(q);
  });
}

export function filterCrmContacts(rows: GodCrmContact[], filters: GodCrmFilters = {}): GodCrmContact[] {
  const q = String(filters.q || '')
    .trim()
    .toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => hay(row.name, row.email, row.phone, row.title, row.orgName).includes(q));
}

export function filterCrmWork(rows: GodCrmWorkItem[], filters: GodCrmFilters = {}): GodCrmWorkItem[] {
  const q = String(filters.q || '')
    .trim()
    .toLowerCase();
  const kind = String(filters.kind || '')
    .trim()
    .toLowerCase();
  const stage = String(filters.stage || '')
    .trim()
    .toLowerCase();
  return rows.filter((row) => {
    if (kind && kind !== 'all' && row.kind !== kind) return false;
    if (stage && stage !== 'all' && row.stage !== stage) return false;
    if (!q) return true;
    return hay(row.title, row.customer, row.orgName, row.status, row.kindLabel).includes(q);
  });
}

export type GodCrmQuery = {
  select: (
    columns: string,
    options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }
  ) => GodCrmQuery;
  order: (column: string, options?: { ascending?: boolean }) => GodCrmQuery;
  range: (from: number, to: number) => GodCrmQuery;
  eq: (column: string, value: unknown) => GodCrmQuery;
  limit: (count: number) => GodCrmQuery;
  then: (onFulfilled?: (value: { data?: unknown; error?: { message?: string } | null; count?: number | null }) => unknown) => Promise<unknown>;
};

export type GodCrmAdmin = {
  from: (table: string) => GodCrmQuery;
};

export type GodCrmAdminLike = {
  from: (table: string) => unknown;
};

const ORG_SELECTS = [
  'id, name, type, email, phone, city, state, created_at, is_premium, subscription_tier, plan',
  'id, name, type, email, phone, city, state, created_at, is_premium, subscription_tier',
  'id, name, type, email, phone, city, state, created_at, is_premium',
  'id, name, type, email, created_at',
] as const;

const CONTACT_SELECTS = [
  'id, first_name, last_name, name, email, phone, title, is_primary, organization_id, created_at',
  'id, first_name, last_name, email, phone, title, is_primary, organization_id, created_at',
  'id, first_name, last_name, email, phone, organization_id, created_at',
] as const;

const REQUEST_SELECTS = [
  'id, title, status, manufacturer, model, model_type, city, state, location, urgency, price, budget_max, organization_id, created_at',
  'id, title, status, city, state, location, urgency, organization_id, created_at',
  'id, title, status, organization_id, created_at',
] as const;

const LEAD_SELECTS = [
  'id, clinic_name, contact_name, email, phone, location, equipment_type, manufacturer, model, urgency, created_at, service_request_id',
  'id, clinic_name, contact_name, email, phone, location, equipment_type, manufacturer, urgency, created_at',
] as const;

const WAITLIST_SELECTS = ['id, email, plan, created_at'] as const;

const MREQ_SELECTS = [
  'id, title, status, manufacturer, model, urgency, organization_id, created_at',
  'id, title, status, created_at',
] as const;

const TICKET_SELECTS = [
  'id, ticket_number, status, customer_name, organization_id, customer_organization_id, created_at',
  'id, ticket_number, status, customer_name, organization_id, created_at',
] as const;

const ESTIMATE_SELECTS = [
  'id, estimate_number, status, customer_name, total, organization_id, customer_organization_id, created_at',
  'id, status, customer_name, total, organization_id, created_at',
] as const;

const INVOICE_SELECTS = [
  'id, invoice_number, status, customer_name, total, organization_id, customer_organization_id, created_at',
  'id, status, customer_name, total, organization_id, created_at',
] as const;

const LINK_SELECTS = [
  'service_organization_id, customer_organization_id',
  'organization_id, customer_organization_id',
] as const;

function isMissingTable(message?: string | null): boolean {
  return MISSING_TABLE.test(String(message || ''));
}

function isColumnError(message?: string | null): boolean {
  return /column|schema cache|does not exist/i.test(String(message || ''));
}

async function listTable<T>(
  admin: GodCrmAdmin,
  table: string,
  selects: readonly string[]
): Promise<{ rows: T[]; missing: boolean }> {
  let lastMissing = false;
  for (const cols of selects) {
    const { data, error } = await fetchAllPages<T>(async (from, to) => {
      const res = await admin.from(table).select(cols).range(from, to);
      return { data: (res.data as T[] | null) || [], error: res.error || null };
    });
    if (!error) return { rows: data, missing: false };
    if (isMissingTable(error.message)) return { rows: [], missing: true };
    if (!isColumnError(error.message)) {
      lastMissing = isMissingTable(error.message);
      break;
    }
  }
  return { rows: [], missing: lastMissing };
}

async function countEq(admin: GodCrmAdmin, table: string, column: string, value: string): Promise<number | null> {
  try {
    const res = (await admin.from(table).select('id', { count: 'exact', head: true }).eq(column, value)) as {
      count?: number | null;
      error?: { message?: string } | null;
    };
    if (res.error) return null;
    return res.count ?? 0;
  } catch {
    return null;
  }
}

export async function fetchGodCrmSources(admin: GodCrmAdminLike): Promise<GodCrmSources> {
  const client = admin as GodCrmAdmin;
  const missingTables: string[] = [];

  const [
    orgs,
    contacts,
    requests,
    leads,
    waitlist,
    marketplaceRequests,
    tickets,
    estimates,
    invoices,
    links,
    activeListings,
  ] = await Promise.all([
    listTable<GodCrmOrgRow>(client, 'organizations', ORG_SELECTS),
    listTable<GodCrmContactRow>(client, 'contacts', CONTACT_SELECTS),
    listTable<GodCrmRequestRow>(client, 'service_requests', REQUEST_SELECTS),
    listTable<GodCrmLeadRow>(client, 'clinic_service_leads', LEAD_SELECTS),
    listTable<GodCrmWaitlistRow>(client, 'waitlist', WAITLIST_SELECTS),
    listTable<GodCrmMarketplaceRequestRow>(client, 'marketplace_requests', MREQ_SELECTS),
    listTable<GodCrmTicketRow>(client, 'service_tickets', TICKET_SELECTS),
    listTable<GodCrmMoneyRow>(client, 'service_estimates', ESTIMATE_SELECTS),
    listTable<GodCrmMoneyRow>(client, 'service_invoices', INVOICE_SELECTS),
    listTable<GodCrmLinkRow>(client, 'organization_customers', LINK_SELECTS),
    countEq(client, 'marketplace_listings', 'status', 'active'),
  ]);

  for (const [name, result] of [
    ['organizations', orgs],
    ['contacts', contacts],
    ['service_requests', requests],
    ['clinic_service_leads', leads],
    ['waitlist', waitlist],
    ['marketplace_requests', marketplaceRequests],
    ['service_tickets', tickets],
    ['service_estimates', estimates],
    ['service_invoices', invoices],
    ['organization_customers', links],
  ] as const) {
    if (result.missing) missingTables.push(name);
  }

  return {
    orgs: orgs.rows,
    contacts: contacts.rows,
    requests: requests.rows,
    leads: leads.rows,
    waitlist: waitlist.rows,
    marketplaceRequests: marketplaceRequests.rows,
    tickets: tickets.rows,
    estimates: estimates.rows,
    invoices: invoices.rows,
    links: links.rows,
    listingCounts: { active: activeListings },
    missingTables,
  };
}

export async function loadGodCrm(admin: GodCrmAdminLike): Promise<GodCrmPayload> {
  const sources = await fetchGodCrmSources(admin);
  return assembleGodCrm(sources);
}
