/**
 * Caps invoice, estimate, purchase-order, and service-report email sends.
 *
 * Photo and upload caps in the marketplace are plan slot limits, not request
 * rates. These sends are 20 per organization and 5 per document per hour.
 * The document key includes the document type so invoice 40 and estimate 40
 * do not share one bucket.
 *
 * Counters live in public.document_send_slots. take_document_send_slot and
 * release_document_send_slot are SECURITY DEFINER and executable by
 * service_role only. Callers pass the service-role client (not the user JWT).
 *
 * Deploy order: the migration may land after this code. When the function is
 * not in the schema yet (42883 or PostgREST PGRST202), this falls back to the
 * in-memory window so sends keep working under the old per-instance cap.
 * Any other database error fails closed: takeDocumentSendSlot returns
 * scope 'unavailable' and the route answers 503 without sending. A missing
 * service-role client also uses the in-memory window (there is no database
 * call to fail).
 *
 * A slot is released when the email provider does not accept the send.
 * Invoice sends keep the slot once a Checkout session has been created.
 */

export const DOCUMENT_SENDS_PER_ORG_PER_HOUR = 20;
export const DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR = 5;
export const DOCUMENT_SEND_WINDOW_MS = 60 * 60 * 1000;

export const TAKE_DOCUMENT_SEND_SLOT = 'take_document_send_slot';
export const RELEASE_DOCUMENT_SEND_SLOT = 'release_document_send_slot';

export type DocumentSendType = 'invoice' | 'estimate' | 'report' | 'purchase_order';

export type DocumentSendBackend = 'memory' | 'database';

export type HeldDocumentSendSlot = {
  organizationId: string | number | null;
  documentId: string | number;
  stamp: number;
  slotId: number | null;
  backend: DocumentSendBackend;
};

export type DocumentSendSlotTaken = {
  ok: true;
  stamp: number;
  slotId: number | null;
  backend: DocumentSendBackend;
};

export type DocumentSendSlotRefusal = {
  ok: false;
  scope: 'organization' | 'document' | 'unavailable';
  message: string;
};

export type DocumentSendSlotResult = DocumentSendSlotTaken | DocumentSendSlotRefusal;

type RpcError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type DocumentSendLimitClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

const orgHits = new Map<string, number[]>();
const documentHits = new Map<string, number[]>();

export function documentSendOrgLimitMessage(): string {
  return `This organization has reached the limit of ${DOCUMENT_SENDS_PER_ORG_PER_HOUR} document emails per hour. Try again later.`;
}

export function documentSendDocumentLimitMessage(): string {
  return `This document has reached the limit of ${DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR} emails per hour. Try again later.`;
}

export function documentSendUnavailableMessage(): string {
  return 'Document email is temporarily unavailable. Try again later.';
}

export function resetDocumentSendRateLimit(): void {
  orgHits.clear();
  documentHits.clear();
}

export function documentSendKey(input: {
  organizationId: string | number;
  documentType: DocumentSendType;
  documentId: string | number;
}): string {
  return `${String(input.organizationId).trim()}:${input.documentType}:${String(input.documentId).trim()}`;
}

function prune(stamps: number[], now: number): number[] {
  return stamps.filter((stamp) => now - stamp < DOCUMENT_SEND_WINDOW_MS);
}

function removeStamp(stamps: number[] | undefined, stamp: number): void {
  if (!stamps) return;
  const index = stamps.lastIndexOf(stamp);
  if (index >= 0) stamps.splice(index, 1);
}

function limitClient(client: unknown): DocumentSendLimitClient | null {
  if (!client || typeof client !== 'object') return null;
  if (typeof (client as { rpc?: unknown }).rpc !== 'function') return null;
  return client as DocumentSendLimitClient;
}

function isMissingLimiterFunction(error: RpcError): boolean {
  const code = String(error.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  const text = `${error.message || ''}\n${error.details || ''}\n${error.hint || ''}`;
  return (
    (/could not find the function/i.test(text) && /document_send_slot/i.test(text)) ||
    /function .*document_send_slot.* does not exist/i.test(text)
  );
}

function requiredSlotMessage(): DocumentSendSlotRefusal {
  return {
    ok: false,
    scope: 'organization',
    message: 'Organization and document are required to send email.',
  };
}

function unavailableSlot(): DocumentSendSlotRefusal {
  return { ok: false, scope: 'unavailable', message: documentSendUnavailableMessage() };
}

function positiveId(value: unknown): number | null {
  const id = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

function parseDbTake(data: unknown): DocumentSendSlotResult | null {
  let payload = data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (Array.isArray(payload)) {
    if (payload.length !== 1) return null;
    payload = payload[0];
  }
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as { ok?: unknown; scope?: unknown; message?: unknown; id?: unknown; stamp?: unknown };
  if (row.ok === true) {
    const slotId = positiveId(row.id);
    if (slotId == null) return null;
    const stamp = positiveId(row.stamp) ?? slotId;
    return { ok: true, stamp, slotId, backend: 'database' };
  }
  if (
    row.ok === false &&
    (row.scope === 'organization' || row.scope === 'document') &&
    typeof row.message === 'string' &&
    row.message.trim() !== ''
  ) {
    return { ok: false, scope: row.scope, message: row.message };
  }
  return null;
}

function takeMemorySlot(input: {
  organizationId: string;
  documentId: string;
  documentType: DocumentSendType;
  now?: number;
}): DocumentSendSlotResult {
  const now = input.now ?? Date.now();
  const docKey = documentSendKey({
    organizationId: input.organizationId,
    documentType: input.documentType,
    documentId: input.documentId,
  });
  const orgStamps = prune(orgHits.get(input.organizationId) || [], now);
  const docStamps = prune(documentHits.get(docKey) || [], now);

  if (orgStamps.length >= DOCUMENT_SENDS_PER_ORG_PER_HOUR) {
    orgHits.set(input.organizationId, orgStamps);
    return { ok: false, scope: 'organization', message: documentSendOrgLimitMessage() };
  }
  if (docStamps.length >= DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR) {
    documentHits.set(docKey, docStamps);
    return { ok: false, scope: 'document', message: documentSendDocumentLimitMessage() };
  }

  orgStamps.push(now);
  docStamps.push(now);
  orgHits.set(input.organizationId, orgStamps);
  documentHits.set(docKey, docStamps);
  return { ok: true, stamp: now, slotId: null, backend: 'memory' };
}

function releaseMemorySlot(input: {
  organizationId: string;
  documentId: string;
  documentType: DocumentSendType;
  stamp: number;
}): void {
  removeStamp(orgHits.get(input.organizationId), input.stamp);
  removeStamp(
    documentHits.get(
      documentSendKey({
        organizationId: input.organizationId,
        documentType: input.documentType,
        documentId: input.documentId,
      })
    ),
    input.stamp
  );
}

export async function takeDocumentSendSlot(input: {
  organizationId: string | number | null | undefined;
  documentId: string | number | null | undefined;
  documentType: DocumentSendType;
  now?: number;
  client?: unknown;
}): Promise<DocumentSendSlotResult> {
  const orgKey = String(input.organizationId ?? '').trim();
  const docId = String(input.documentId ?? '').trim();
  if (!orgKey || !docId || !input.documentType) return requiredSlotMessage();

  const db = limitClient(input.client);
  if (!db) {
    return takeMemorySlot({
      organizationId: orgKey,
      documentId: docId,
      documentType: input.documentType,
      now: input.now,
    });
  }

  try {
    const { data, error } = await db.rpc(TAKE_DOCUMENT_SEND_SLOT, {
      p_organization_id: orgKey,
      p_document_type: input.documentType,
      p_document_id: docId,
    });
    if (error) {
      if (isMissingLimiterFunction(error)) {
        return takeMemorySlot({
          organizationId: orgKey,
          documentId: docId,
          documentType: input.documentType,
          now: input.now,
        });
      }
      console.error('take_document_send_slot failed', error.code || '', error.message || '');
      return unavailableSlot();
    }
    const parsed = parseDbTake(data);
    if (!parsed) {
      console.error('take_document_send_slot returned an unexpected payload');
      return unavailableSlot();
    }
    return parsed;
  } catch (e) {
    console.error('take_document_send_slot failed', e);
    return unavailableSlot();
  }
}

/** Drop a slot that was taken for a send the email provider did not accept. */
export async function releaseDocumentSendSlot(input: {
  organizationId: string | number | null | undefined;
  documentId: string | number | null | undefined;
  documentType: DocumentSendType;
  stamp: number;
  slotId?: number | null;
  backend?: DocumentSendBackend;
  client?: unknown;
}): Promise<void> {
  const orgKey = String(input.organizationId ?? '').trim();
  const docId = String(input.documentId ?? '').trim();
  if (!orgKey || !docId || !input.documentType) return;

  if (input.backend === 'database') {
    const db = limitClient(input.client);
    const slotId = positiveId(input.slotId);
    if (!db || slotId == null) {
      console.error('release_document_send_slot skipped: database slot has no service-role client or id');
      return;
    }
    try {
      const { error } = await db.rpc(RELEASE_DOCUMENT_SEND_SLOT, {
        p_organization_id: orgKey,
        p_document_type: input.documentType,
        p_document_id: docId,
        p_slot_id: slotId,
      });
      if (error && !isMissingLimiterFunction(error)) {
        console.error('release_document_send_slot failed', error.code || '', error.message || '');
      }
    } catch (e) {
      console.error('release_document_send_slot failed', e);
    }
    return;
  }

  releaseMemorySlot({
    organizationId: orgKey,
    documentId: docId,
    documentType: input.documentType,
    stamp: input.stamp,
  });
}
