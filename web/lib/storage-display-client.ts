'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import {
  LIST_THUMB_WIDTH,
  SIGNED_URL_CACHE_MS,
  immediateDisplayUrl,
  parseStoredStorageUrl,
  signCacheKey,
  snapThumbWidth,
  type CachedSignedUrl,
} from '@/lib/storage-display';

const cache = new Map<string, CachedSignedUrl>();

type Job = { url: string; width: number | null; resolve: (url: string | null) => void };

function widthToken(width: number | null): string {
  return width == null ? 'full' : String(snapThumbWidth(width));
}

let queue: Job[] = [];
let scheduled = false;

async function flushSignQueue(): Promise<void> {
  const batch = queue;
  queue = [];
  scheduled = false;
  if (!batch.length) return;

  const unique = new Map<string, { url: string; width: number | null }>();
  for (const job of batch) {
    unique.set(`${job.url}\n${job.width}`, { url: job.url, width: job.width });
  }

  let results: Array<{ url: string; width: number | null; signedUrl?: string | null }> = [];
  try {
    const supabase = getSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch('/api/storage/signed-urls', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: [...unique.values()] }),
    });
    if (!res.ok) {
      console.error('[storage-display] sign request failed', res.status);
    } else {
      const json = (await res.json().catch(() => ({}))) as {
        results?: Array<{ url: string; width: number | null; signedUrl?: string | null }>;
      };
      results = Array.isArray(json.results) ? json.results : [];
    }
  } catch (err) {
    console.error('[storage-display] sign request failed', err);
  }

  const byKey = new Map<string, string>();
  const now = Date.now();
  for (const row of results) {
    if (!row?.signedUrl) continue;
    const parsed = parseStoredStorageUrl(row.url);
    if (parsed) {
      cache.set(signCacheKey(parsed.bucket, parsed.path, row.width), {
        url: row.signedUrl,
        exp: now + SIGNED_URL_CACHE_MS,
      });
    }
    const width = row.width == null ? null : snapThumbWidth(row.width);
    byKey.set(`${row.url}\n${widthToken(width)}`, row.signedUrl);
  }

  for (const job of batch) {
    job.resolve(byKey.get(`${job.url}\n${widthToken(job.width)}`) || null);
  }
}

/** One network batch for every private image requested in the same turn. */
export function enqueueSignedDisplayUrl(
  url: string | null | undefined,
  width: number | null = LIST_THUMB_WIDTH
): Promise<string | null> {
  const w = width == null ? null : snapThumbWidth(width);
  const immediate = immediateDisplayUrl(url, w);
  if (!immediate.sign) return Promise.resolve(immediate.src);
  const parsed = parseStoredStorageUrl(String(url || ''));
  if (!parsed) return Promise.resolve(null);
  const hit = cache.get(signCacheKey(parsed.bucket, parsed.path, w));
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    queue.push({ url: String(url), width: w, resolve });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        void flushSignQueue();
      });
    }
  });
}
