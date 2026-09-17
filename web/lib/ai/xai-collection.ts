/**
 * Shared Grok RAG collection (AI chat), not library search.
 *
 * QA + live function (v33) confirmed:
 * - `manual_search_index` is written by God POST /api/god/manuals/reindex
 *   and on catalog insert. That is library search only.
 * - `manuals.xai_collection_id` is NOT written anywhere else in this repo
 *   (types + God table list only). Live grok-assistant never reads or writes
 *   the column. It always searches this one hardcoded collection, then
 *   filters hits by the selected manual’s filename tokens.
 * - The first ~40 catalog rows (Elite SM id 16 included) share this id as a
 *   stamp that their PDFs were uploaded in an out-of-repo / console ingest.
 *   Incomplete rows (including Elite MPX id 721) were never stamped. Live
 *   catalog (~2026-09) had ~749 unstamped rows and ~782 missing search-index.
 *
 * After this change, Larry (God only) can:
 * - Attach one catalog PDF via “Attach to Grok collection” (catalog id).
 * - Catch up every unstamped file/folder with a PDF via
 *   “Attach missing Grok collections” → POST attachCollection without
 *   manualId (cursor afterId, one PDF upload per request).
 * Chat can still work without the stamp once grok-assistant is deployed:
 * it attaches the storage_path PDF and can fall back to manual_search_index.
 */

import { asManualId, hasAttachablePdfHint } from './manual-scope.ts';

export const TSP_XAI_COLLECTION_ID = 'collection_4d71cef6-a546-4b8c-9e08-f9c4e77a0c5e';

/** One PDF upload per God request — xAI + 60s function budget. */
export const MANUAL_XAI_ATTACH_BATCH = 1;

export function needsXaiCollectionStamp(manual: { xai_collection_id?: unknown }): boolean {
  return !String(manual.xai_collection_id ?? '').trim();
}

export type AttachableManual = {
  id?: unknown;
  xai_collection_id?: unknown;
  storage_path?: string | null;
  entry_file_path?: string | null;
  chapter_metadata?: unknown;
  is_folder?: unknown;
};

/**
 * Unstamped catalog rows that look like they have a PDF (file, chapters,
 * entry file, or folder prefix). Ordered by id. afterId skips already
 * attempted rows in this catch-up pass so empty folders cannot block the queue.
 */
export function manualsNeedingXaiAttach<T extends AttachableManual>(
  manuals: T[],
  opts: { targetId?: unknown; afterId?: unknown } = {}
): T[] {
  const targetId = asManualId(opts.targetId);
  const afterId = asManualId(opts.afterId) ?? 0;
  return manuals
    .filter((m) => {
      const id = asManualId(m.id);
      if (id == null) return false;
      if (targetId != null) return id === targetId;
      if (id <= afterId) return false;
      return needsXaiCollectionStamp(m) && hasAttachablePdfHint(m);
    })
    .sort((a, b) => (asManualId(a.id) || 0) - (asManualId(b.id) || 0));
}

export function grokAssistantUrl(base?: string | null): string {
  const url = String(base || '').replace(/\/$/, '');
  if (!url) return '';
  return `${url}/functions/v1/grok-assistant`;
}

export function xaiKeysFromEnv(env: Record<string, string | undefined> = {}): {
  apiKey: string | null;
  managementKey: string | null;
} {
  const apiKey = String(env.XAI_API_KEY || env.XAI_KEY || '').trim() || null;
  const managementKey =
    String(env.XAI_MANAGEMENT_API_KEY || env.XAI_MANAGEMENT_KEY || '').trim() || apiKey;
  return { apiKey, managementKey };
}

export async function uploadPdfToTspCollection(opts: {
  apiKey: string;
  managementKey?: string | null;
  filename: string;
  bytes: Uint8Array;
  collectionId?: string;
}): Promise<{ ok: boolean; fileId?: string; collectionId: string; skipped?: string; detail?: string }> {
  const collectionId = opts.collectionId || TSP_XAI_COLLECTION_ID;
  const name = String(opts.filename || 'manual.pdf').replace(/[^\w.\-]+/g, '_') || 'manual.pdf';
  const fileRes = await fetch('https://api.x.ai/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: (() => {
      const form = new FormData();
      form.append('file', new Blob([opts.bytes], { type: 'application/pdf' }), name);
      return form;
    })(),
  });
  const fileJson = (await fileRes.json().catch(() => ({}))) as { id?: string; error?: unknown };
  if (!fileRes.ok || !fileJson.id) {
    return {
      ok: false,
      collectionId,
      skipped: 'xai_file_upload_failed',
      detail: String(fileJson.error || fileRes.status),
    };
  }

  const manageKey = opts.managementKey || opts.apiKey;
  const addRes = await fetch(
    `https://management-api.x.ai/v1/collections/${collectionId}/documents/${fileJson.id}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${manageKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  if (!addRes.ok) {
    const err = await addRes.text().catch(() => '');
    return {
      ok: false,
      fileId: fileJson.id,
      collectionId,
      skipped: 'xai_collection_add_failed',
      detail: err.slice(0, 240) || String(addRes.status),
    };
  }
  return { ok: true, fileId: fileJson.id, collectionId };
}
