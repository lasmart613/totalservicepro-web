/**
 * Pure helpers for clinic estimate approval.
 * Kept free of @/ imports so Node tests can load this file.
 */

import {
  coerceOrgId,
  parseJsonField,
} from './save-helpers.ts';

export const UNSCHEDULED_TICKET_STATUS = 'Awaiting Scheduling' as const;
export const APPROVE_MARKETPLACE_STATUSES = new Set(['open', 'bidding']);

export function sameOrgId(a: unknown, b: unknown): boolean {
  const left = coerceOrgId(a);
  const right = coerceOrgId(b);
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

export function normalizeEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function customerOrgIdFromEstimate(estimate: any): string | number | null {
  const ed = parseJsonField(estimate?.estimate_data);
  return coerceOrgId(estimate?.customer_organization_id ?? ed.customer_organization_id);
}

export function shopOrgIdFromEstimate(estimate: any): string | number | null {
  return coerceOrgId(estimate?.organization_id);
}

export function estimateCustomerEmail(estimate: any): string {
  const ed = parseJsonField(estimate?.estimate_data);
  return normalizeEmail(ed.custEmail || ed.email || ed.customer_email);
}

export function isEstimateShop(
  estimate: any,
  opts: { orgId?: unknown; userId?: string | null }
): boolean {
  if (sameOrgId(opts.orgId, shopOrgIdFromEstimate(estimate))) return true;
  const createdBy = estimate?.created_by ? String(estimate.created_by) : '';
  return Boolean(opts.userId && createdBy && createdBy === String(opts.userId));
}

export function isEstimateCustomer(
  estimate: any,
  opts: { orgId?: unknown; email?: string | null }
): boolean {
  if (sameOrgId(opts.orgId, customerOrgIdFromEstimate(estimate))) return true;
  const estimateEmail = estimateCustomerEmail(estimate);
  const callerEmail = normalizeEmail(opts.email);
  return Boolean(estimateEmail && callerEmail && estimateEmail === callerEmail);
}

export function callerRoleOnEstimate(
  estimate: any,
  opts: { orgId?: unknown; userId?: string | null; email?: string | null }
): 'shop' | 'customer' | null {
  if (isEstimateShop(estimate, opts)) return 'shop';
  if (isEstimateCustomer(estimate, opts)) return 'customer';
  return null;
}

export function approvedTicketRefFromEstimate(estimate: any): {
  id: string | number | null;
  number: string | null;
} {
  const ed = parseJsonField(estimate?.estimate_data);
  const id =
    estimate?.approved_ticket_id ??
    ed.approved_ticket_id ??
    ed.approved_service_request_id ??
    null;
  const number = String(
    estimate?.approved_ticket_number ||
      ed.approved_ticket_number ||
      ed.approved_service_request_number ||
      ''
  ).trim();
  return {
    id: id != null && id !== '' ? id : null,
    number: number || null,
  };
}

function firstServiceType(estimate: any, ed: Record<string, any>): string {
  const raw = estimate?.services ?? ed.services;
  const list = Array.isArray(raw) ? raw.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (list.length) {
    const first = list[0].replace(/^Other:\s*/i, '').trim();
    return first || 'Repair';
  }
  if (ed.service_type) return String(ed.service_type);
  return 'Repair';
}

function priorityFromUrgency(urgency: unknown): string {
  const u = String(urgency || '').toLowerCase();
  if (u === 'emergency' || u === 'urgent' || u === 'high') return 'High';
  if (u === 'low') return 'Low';
  return 'Medium';
}

export function unscheduledTicketPayloadFromEstimate(estimate: any): Record<string, unknown> {
  const ed = parseJsonField(estimate?.estimate_data);
  const shopOrgId = shopOrgIdFromEstimate(estimate);
  const estimateNumber = String(
    estimate?.estimate_number || ed.estimate_number || ed.estNumber || estimate?.id || ''
  ).trim();
  const manufacturer = String(ed.manufacturer || '').trim();
  const model = String(ed.model || '').trim();
  const device = String(estimate?.device_model || [manufacturer, model].filter(Boolean).join(' ')).trim();
  const notes = [
    estimateNumber ? `Approved from estimate ${estimateNumber}.` : 'Approved from online estimate.',
    'Unscheduled — shop that wrote the estimate only. Not posted to the marketplace.',
    ed.description || estimate?.issues || ed.issues || '',
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');

  return {
    organization_id: shopOrgId,
    customer_name: String(estimate?.customer_name || ed.customer_name || 'Customer').trim() || 'Customer',
    customer_address: ed.custAddress || ed.address || null,
    customer_city: ed.custCity || ed.city || null,
    customer_state: ed.custState || ed.state || null,
    customer_phone: ed.custPhone || ed.phone || null,
    customer_email: ed.custEmail || ed.email || null,
    equipment_make: manufacturer || null,
    equipment_model: model || device || null,
    serial_number: ed.serial || ed.serial_number || null,
    service_date: null,
    scheduled_time: null,
    end_time: null,
    service_type: firstServiceType(estimate, ed),
    priority: priorityFromUrgency(ed.urgency || estimate?.urgency),
    status: UNSCHEDULED_TICKET_STATUS,
    notes,
    description: notes,
    estimate_id: estimate?.id ?? null,
    assigned_to: null,
  };
}

/** Marketplace RFQs use open/bidding. Estimate approval must never use those. */
export function isMarketplaceVisibleStatus(status: unknown): boolean {
  return APPROVE_MARKETPLACE_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function mergeApprovedTicketIntoEstimateData(
  estimateData: unknown,
  ticket: { id?: string | number | null; ticket_number?: string | null }
): Record<string, unknown> {
  const ed = { ...parseJsonField(estimateData) };
  if (ticket.id != null) {
    ed.approved_ticket_id = ticket.id;
    ed.approved_service_request_id = ticket.id;
  }
  if (ticket.ticket_number) {
    ed.approved_ticket_number = ticket.ticket_number;
    ed.approved_service_request_number = ticket.ticket_number;
  }
  return ed;
}
