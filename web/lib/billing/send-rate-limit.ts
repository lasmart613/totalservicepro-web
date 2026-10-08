/**
 * Caps invoice, estimate, purchase-order, and service-report email sends.
 *
 * Photo and upload caps in the marketplace are plan slot limits, not request
 * rates, and nothing else stores a per-org send counter. This uses the same
 * in-memory window as the product-issue route. The limit is per warm server
 * instance: a new instance, or several instances behind the load balancer,
 * each have their own counters.
 *
 * The document key includes the document type so invoice 40 and estimate 40
 * do not share one bucket.
 */

export const DOCUMENT_SENDS_PER_ORG_PER_HOUR = 20;
export const DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR = 5;
export const DOCUMENT_SEND_WINDOW_MS = 60 * 60 * 1000;

export type DocumentSendType = 'invoice' | 'estimate' | 'report' | 'purchase_order';

const orgHits = new Map<string, number[]>();
const documentHits = new Map<string, number[]>();

export function documentSendOrgLimitMessage(): string {
  return `This organization has reached the limit of ${DOCUMENT_SENDS_PER_ORG_PER_HOUR} document emails per hour. Try again later.`;
}

export function documentSendDocumentLimitMessage(): string {
  return `This document has reached the limit of ${DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR} emails per hour. Try again later.`;
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

export function takeDocumentSendSlot(input: {
  organizationId: string | number | null | undefined;
  documentId: string | number | null | undefined;
  documentType: DocumentSendType;
  now?: number;
}): { ok: true; stamp: number } | { ok: false; scope: 'organization' | 'document'; message: string } {
  const orgKey = String(input.organizationId ?? '').trim();
  const docId = String(input.documentId ?? '').trim();
  if (!orgKey || !docId || !input.documentType) {
    return {
      ok: false,
      scope: 'organization',
      message: 'Organization and document are required to send email.',
    };
  }

  const now = input.now ?? Date.now();
  const docKey = documentSendKey({
    organizationId: orgKey,
    documentType: input.documentType,
    documentId: docId,
  });
  const orgStamps = prune(orgHits.get(orgKey) || [], now);
  const docStamps = prune(documentHits.get(docKey) || [], now);

  if (orgStamps.length >= DOCUMENT_SENDS_PER_ORG_PER_HOUR) {
    orgHits.set(orgKey, orgStamps);
    return { ok: false, scope: 'organization', message: documentSendOrgLimitMessage() };
  }
  if (docStamps.length >= DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR) {
    documentHits.set(docKey, docStamps);
    return { ok: false, scope: 'document', message: documentSendDocumentLimitMessage() };
  }

  orgStamps.push(now);
  docStamps.push(now);
  orgHits.set(orgKey, orgStamps);
  documentHits.set(docKey, docStamps);
  return { ok: true, stamp: now };
}

/** Drop a slot that was taken for a send the email provider did not accept. */
export function releaseDocumentSendSlot(input: {
  organizationId: string | number | null | undefined;
  documentId: string | number | null | undefined;
  documentType: DocumentSendType;
  stamp: number;
}): void {
  const orgKey = String(input.organizationId ?? '').trim();
  const docId = String(input.documentId ?? '').trim();
  if (!orgKey || !docId || !input.documentType) return;
  removeStamp(orgHits.get(orgKey), input.stamp);
  removeStamp(
    documentHits.get(
      documentSendKey({
        organizationId: orgKey,
        documentType: input.documentType,
        documentId: docId,
      })
    ),
    input.stamp
  );
}
