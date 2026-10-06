/**
 * Finalize & Email for service estimates.
 *
 * The form used to insert a draft, send mail, then insert again to flip status.
 * The second insert collided with service_estimates_org_number_uidx (409) and
 * left the row in draft. Status is now updated on the existing id before mail
 * is sent. A repeat call sees pending/sent and does not send again.
 */

import { customerActionFromEstimate, writeWithColumnRetry } from './save-helpers.ts';

type QueryClient = { from: (table: string) => any };

/** List filters treat both of these as Sent. */
export const ESTIMATE_SENT_STATUS = 'pending';

const SENT_STATUSES = new Set(['pending', 'sent']);

export function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const code = String(err?.code || '');
  const msg = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return code === '23505' || msg.includes('duplicate') || msg.includes('unique');
}

export function isEstimateMarkedSent(status: unknown): boolean {
  return SENT_STATUSES.has(String(status || '').trim().toLowerCase());
}

/**
 * On an update, keep the stored status. Writing "draft" again would reopen a
 * sent estimate and the next Finalize would mail it a second time.
 * Inserts still start as draft.
 */
export function estimateWritePayload(
  payload: Record<string, any>,
  existingId: string | number | null | undefined,
  opts?: { preserveStatus?: boolean }
): Record<string, any> {
  if (opts?.preserveStatus && existingId != null && existingId !== '') {
    const next = { ...payload };
    delete next.status;
    return next;
  }
  return payload;
}

/**
 * Insert, or update when the id is already known.
 * A unique (organization_id, estimate_number) collision adopts that row and
 * updates it instead of surfacing 409.
 */
export async function persistServiceEstimate(
  supabase: QueryClient,
  payload: Record<string, any>,
  existingId: string | number | null
): Promise<{ id: string | number | null; error: any }> {
  const first = await writeWithColumnRetry(supabase, 'service_estimates', payload, existingId);
  if (!first.error || !isUniqueViolation(first.error)) return first;

  const orgId = payload.organization_id;
  const number = payload.estimate_number;
  if (orgId == null || orgId === '' || number == null || String(number).trim() === '') {
    return first;
  }

  const { data, error } = await supabase
    .from('service_estimates')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('estimate_number', number)
    .maybeSingle();
  if (error || data?.id == null) return first;

  const updatePayload = { ...payload };
  delete updatePayload.created_by;
  if (isEstimateMarkedSent(data.status)) delete updatePayload.status;
  const second = await writeWithColumnRetry(
    supabase,
    'service_estimates',
    updatePayload,
    data.id
  );
  if (second.error) return first;
  return second;
}

export function canConvertEstimateToInvoice(est: {
  status?: string | null;
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
  estimate_data?: unknown;
}): boolean {
  const st = String(est.status || '').toLowerCase();
  if (['invoiced', 'cancelled', 'canceled', 'expired', 'completed'].includes(st)) return false;
  return customerActionFromEstimate(est).action !== 'rejected';
}

type ClaimResult =
  | { ok: true; send: boolean; alreadySent: boolean; status: string }
  | { ok: false; error: string };

async function updateServiceEstimate(
  client: QueryClient,
  id: string | number,
  body: Record<string, unknown>,
  matchStatus?: unknown
): Promise<{ updated: boolean; error: { message?: string; code?: string } | null }> {
  let patch = { ...body };
  for (let attempt = 0; attempt < 6; attempt++) {
    let query = client.from('service_estimates').update(patch).eq('id', id);
    if (matchStatus !== undefined) {
      query =
        matchStatus == null || matchStatus === ''
          ? query.is('status', null)
          : query.eq('status', matchStatus);
    }
    const { data, error } = await query.select('id');
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return { updated: row?.id != null, error: null };
    }
    const message = String(error.message || '');
    const col =
      message.match(/Could not find the '([^']+)' column/i)?.[1] ||
      message.match(/column ["']?(\w+)["']? of relation/i)?.[1];
    if (col && col in patch) {
      delete patch[col];
      continue;
    }
    return { updated: false, error };
  }
  return { updated: false, error: { message: 'Could not update estimate' } };
}

async function readEstimateStatus(client: QueryClient, id: string | number): Promise<unknown> {
  const { data, error } = await client
    .from('service_estimates')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data.status;
}

/**
 * Flip the existing row to pending before mail goes out.
 * Never inserts. A concurrent or repeated call that loses the status
 * compare does not send.
 */
export async function claimEstimateForSend(
  client: QueryClient,
  estimateId: string | number,
  row: { status?: unknown }
): Promise<ClaimResult> {
  if (isEstimateMarkedSent(row.status)) {
    return { ok: true, send: false, alreadySent: true, status: String(row.status) };
  }
  const sentAt = new Date().toISOString();
  const result = await updateServiceEstimate(
    client,
    estimateId,
    { status: ESTIMATE_SENT_STATUS, sent_at: sentAt },
    row.status ?? null
  );
  if (result.error) {
    return { ok: false, error: result.error.message || 'Could not mark estimate sent' };
  }
  if (result.updated) {
    return { ok: true, send: true, alreadySent: false, status: ESTIMATE_SENT_STATUS };
  }
  const current = await readEstimateStatus(client, estimateId);
  if (isEstimateMarkedSent(current)) {
    return { ok: true, send: false, alreadySent: true, status: String(current) };
  }
  return { ok: false, error: 'Estimate could not be marked sent.' };
}

export async function revertEstimateSendClaim(
  client: QueryClient,
  estimateId: string | number,
  previousStatus: unknown
): Promise<void> {
  const result = await updateServiceEstimate(client, estimateId, {
    status: previousStatus || 'draft',
    sent_at: null,
  });
  if (result.error) {
    console.warn('revertEstimateSendClaim', result.error.message);
  }
}

export type FinalizeEstimateResult =
  | {
      ok: true;
      emailed: boolean;
      alreadySent: boolean;
      status: string;
      providerId: string | null;
    }
  | { ok: false; error: string };

/**
 * Save the sent status, then send. If the provider rejects the message, the
 * row goes back to its previous status so the user can retry once.
 * If this returns alreadySent, the caller must not send.
 */
export async function finalizeEstimateDelivery(opts: {
  client: QueryClient;
  estimateId: string | number;
  row: { status?: unknown };
  send: () => Promise<{ ok: boolean; error?: string; id?: string | null }>;
}): Promise<FinalizeEstimateResult> {
  const claim = await claimEstimateForSend(opts.client, opts.estimateId, opts.row);
  if (!claim.ok) return claim;
  if (!claim.send) {
    return {
      ok: true,
      emailed: false,
      alreadySent: true,
      status: claim.status,
      providerId: null,
    };
  }

  let sent: { ok: boolean; error?: string; id?: string | null };
  try {
    sent = await opts.send();
  } catch (e: any) {
    sent = { ok: false, error: e?.message || 'Email was not sent' };
  }
  if (!sent.ok) {
    await revertEstimateSendClaim(opts.client, opts.estimateId, opts.row.status || 'draft');
    return { ok: false, error: sent.error || 'Email was not sent' };
  }
  return {
    ok: true,
    emailed: true,
    alreadySent: false,
    status: ESTIMATE_SENT_STATUS,
    providerId: sent.id ?? null,
  };
}
