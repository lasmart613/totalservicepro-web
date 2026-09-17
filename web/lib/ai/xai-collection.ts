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
 *   Incomplete rows (including Elite MPX id 721) were never stamped.
 *
 * After this change, Larry can attach a catalog PDF via God → Manuals
 * (“Attach to Grok collection”) which uploads into this collection and
 * stamps `xai_collection_id`. Chat can still work without the stamp once
 * grok-assistant is deployed: it attaches the storage_path PDF and can
 * fall back to manual_search_index.
 */

export const TSP_XAI_COLLECTION_ID = 'collection_4d71cef6-a546-4b8c-9e08-f9c4e77a0c5e';

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
