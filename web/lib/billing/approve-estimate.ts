/**
 * Clinic Approve on a sent estimate → one unscheduled service ticket
 * owned by the estimating shop. Not a marketplace RFQ.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { allocateDocNumber } from '@/lib/billing/doc-numbers';
import { customerActionFromEstimate } from '@/lib/billing/save-helpers';
import {
  approvedTicketRefFromEstimate,
  isMarketplaceVisibleStatus,
  mergeApprovedTicketIntoEstimateData,
  shopOrgIdFromEstimate,
  UNSCHEDULED_TICKET_STATUS,
  unscheduledTicketPayloadFromEstimate,
} from '@/lib/billing/approve-estimate-helpers';

export {
  APPROVE_MARKETPLACE_STATUSES,
  approvedTicketRefFromEstimate,
  callerRoleOnEstimate,
  customerOrgIdFromEstimate,
  estimateCustomerEmail,
  isEstimateCustomer,
  isEstimateShop,
  isMarketplaceVisibleStatus,
  mergeApprovedTicketIntoEstimateData,
  sameOrgId,
  shopOrgIdFromEstimate,
  UNSCHEDULED_TICKET_STATUS,
  unscheduledTicketPayloadFromEstimate,
} from '@/lib/billing/approve-estimate-helpers';

const CUSTOMER_ACTION_APPROVED = 'approved' as const;

async function findTicketByEstimateId(
  client: SupabaseClient,
  estimateId: string | number
): Promise<{ id: string | number; ticket_number: string | null } | null> {
  const { data, error } = await client
    .from('service_tickets')
    .select('id, ticket_number')
    .eq('estimate_id', estimateId)
    .limit(1)
    .maybeSingle();
  if (!error && data?.id != null) {
    return { id: data.id, ticket_number: data.ticket_number || null };
  }
  if (error && !/column|schema cache|does not exist/i.test(error.message || '')) {
    console.warn('findTicketByEstimateId', error.message);
  }
  return null;
}

async function findTicketById(
  client: SupabaseClient,
  ticketId: string | number
): Promise<{ id: string | number; ticket_number: string | null } | null> {
  const { data, error } = await client
    .from('service_tickets')
    .select('id, ticket_number')
    .eq('id', ticketId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return { id: data.id, ticket_number: data.ticket_number || null };
}

async function persistApprovedTicketOnEstimate(
  client: SupabaseClient,
  estimate: any,
  ticket: { id: string | number; ticket_number: string | null },
  alreadyApproved: boolean
): Promise<void> {
  const prev = customerActionFromEstimate(estimate);
  const at = alreadyApproved && prev.at ? prev.at : new Date().toISOString();
  const ed = mergeApprovedTicketIntoEstimateData(estimate.estimate_data, ticket);
  if (prev.token) ed.customer_action_token = prev.token;
  ed.customer_action = CUSTOMER_ACTION_APPROVED;
  ed.customer_action_at = at;
  ed.customer_action_note = prev.note;
  const attempts: Record<string, unknown>[] = [
    {
      customer_action: CUSTOMER_ACTION_APPROVED,
      customer_action_at: at,
      customer_action_note: prev.note,
      approved_ticket_id: ticket.id,
      approved_ticket_number: ticket.ticket_number,
      estimate_data: ed,
    },
    {
      customer_action: CUSTOMER_ACTION_APPROVED,
      customer_action_at: at,
      customer_action_note: prev.note,
      estimate_data: ed,
    },
    { estimate_data: ed },
  ];
  for (const body of attempts) {
    const { error } = await client.from('service_estimates').update(body).eq('id', estimate.id);
    if (!error) return;
    if (!/column|schema cache|does not exist/i.test(error.message || '')) {
      throw new Error(error.message);
    }
  }
  throw new Error('Could not save estimate approval');
}

async function insertUnscheduledTicket(
  client: SupabaseClient,
  estimate: any
): Promise<{ id: string | number; ticket_number: string | null }> {
  const shopOrgId = shopOrgIdFromEstimate(estimate);
  if (shopOrgId == null) {
    throw new Error('This estimate is not linked to a service company.');
  }

  let ticketNumber: string;
  try {
    ticketNumber = await allocateDocNumber(client, { orgId: shopOrgId, kind: 'TKT' });
  } catch {
    ticketNumber = `TMP-TKT-${Date.now().toString().slice(-6)}`;
  }

  const base = unscheduledTicketPayloadFromEstimate(estimate);
  if (isMarketplaceVisibleStatus(base.status)) {
    throw new Error('Refusing to create a marketplace-visible request from estimate approval.');
  }

  const attempts: Record<string, unknown>[] = [
    { ...base, ticket_number: ticketNumber },
    (() => {
      const slim = { ...base, ticket_number: ticketNumber };
      delete slim.estimate_id;
      return slim;
    })(),
    {
      ticket_number: ticketNumber,
      organization_id: shopOrgId,
      customer_name: base.customer_name,
      status: UNSCHEDULED_TICKET_STATUS,
      service_date: null,
      notes: base.notes,
    },
  ];

  let lastError = 'Could not create service request';
  for (const body of attempts) {
    const { data, error } = await client
      .from('service_tickets')
      .insert(body)
      .select('id, ticket_number')
      .single();
    if (!error && data?.id != null) {
      return { id: data.id, ticket_number: data.ticket_number || ticketNumber };
    }
    lastError = error?.message || lastError;
    if (error && /duplicate|unique|23505/i.test(`${error.code || ''} ${error.message || ''}`)) {
      const existing = await findTicketByEstimateId(client, estimate.id);
      if (existing) return existing;
    }
    if (error && !/column|schema cache|does not exist/i.test(error.message || '')) {
      throw new Error(error.message);
    }
  }
  throw new Error(lastError);
}

export async function approveEstimateCreatingUnscheduledRequest(
  client: SupabaseClient,
  estimate: any
): Promise<{
  already: boolean;
  ticket: { id: string | number; ticket_number: string | null };
}> {
  const ref = approvedTicketRefFromEstimate(estimate);
  if (ref.id != null) {
    const existing = await findTicketById(client, ref.id);
    if (existing) {
      await persistApprovedTicketOnEstimate(client, estimate, existing, true);
      return { already: true, ticket: existing };
    }
  }

  const byEstimate = estimate?.id != null ? await findTicketByEstimateId(client, estimate.id) : null;
  if (byEstimate) {
    await persistApprovedTicketOnEstimate(client, estimate, byEstimate, true);
    return { already: true, ticket: byEstimate };
  }

  const ticket = await insertUnscheduledTicket(client, estimate);
  await persistApprovedTicketOnEstimate(client, estimate, ticket, false);
  return { already: false, ticket };
}
