/**
 * Shared Grok RAG collection (AI chat), not library search.
 *
 * The only writer of `manuals.xai_collection_id` is grok-assistant
 * `action: 'attach-collection'` (Larry / GOD_ADMIN_EMAILS). God
 * POST /api/god/manuals/reindex?attachCollection proxies that action
 * for one id or, without manualId, every unstamped attachable row.
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

export function sanitizeCollectionFilename(filename: string): string {
  return String(filename || 'manual.pdf').replace(/[^\w.\-]+/g, '_') || 'manual.pdf';
}

export function collectionDocumentNamesMatch(existing: unknown, candidate: unknown): boolean {
  const a = sanitizeCollectionFilename(String(existing ?? '')).toLowerCase();
  const b = sanitizeCollectionFilename(String(candidate ?? '')).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  return String(existing ?? '').trim().toLowerCase() === String(candidate ?? '').trim().toLowerCase();
}

export async function collectionHasDocumentName(opts: {
  managementKey: string;
  filename: string;
  collectionId?: string;
}): Promise<boolean> {
  const collectionId = opts.collectionId || TSP_XAI_COLLECTION_ID;
  const raw = String(opts.filename || '').trim();
  const name = sanitizeCollectionFilename(raw);
  const candidates = [...new Set([name, raw].filter(Boolean))];
  for (const candidate of candidates) {
    const url = new URL(`https://management-api.x.ai/v1/collections/${collectionId}/documents`);
    url.searchParams.set('limit', '20');
    url.searchParams.set('filter', `name:"${candidate.replace(/"/g, '')}"`);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${opts.managementKey}` },
    });
    if (!res.ok) continue;
    const json = (await res.json().catch(() => ({}))) as {
      documents?: Array<{ file_metadata?: { name?: string }; name?: string }>;
    };
    const docs = json.documents || [];
    if (
      docs.some((d) => collectionDocumentNamesMatch(d.file_metadata?.name || d.name || '', candidate))
    ) {
      return true;
    }
  }
  return false;
}

export async function uploadPdfToTspCollection(opts: {
  apiKey: string;
  managementKey?: string | null;
  filename: string;
  bytes: Uint8Array;
  collectionId?: string;
}): Promise<{ ok: boolean; fileId?: string; collectionId: string; skipped?: string; detail?: string }> {
  const collectionId = opts.collectionId || TSP_XAI_COLLECTION_ID;
  const name = sanitizeCollectionFilename(opts.filename);
  const manageKeyEarly = opts.managementKey || opts.apiKey;
  try {
    if (await collectionHasDocumentName({ managementKey: manageKeyEarly, filename: name, collectionId })) {
      return { ok: true, collectionId, skipped: 'already_present' };
    }
  } catch {
    /* list failed — still try upload */
  }
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
