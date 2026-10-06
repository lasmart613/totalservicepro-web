import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  SIGNED_URL_TTL_SECONDS,
  clampWidth,
  isPrivateImageBucket,
  parseStoredStorageUrl,
  serviceRoleSignable,
  signedThumbnailUrl,
} from '@/lib/storage-display';

export const dynamic = 'force-dynamic';

type Item = { url: string; width: number; bucket: string; path: string };

function bearer(req: NextRequest): string {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

async function signPaths(
  client: SupabaseClient,
  bucket: string,
  paths: string[],
  width: number
): Promise<Record<string, string>> {
  const batch = await client.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (batch.error || !batch.data) {
    console.error('[signed-urls] sign failed', bucket, batch.error?.message || 'empty');
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of batch.data) {
    if (row?.path && row.signedUrl) out[row.path] = signedThumbnailUrl(row.signedUrl, width);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    items?: Array<{ url?: unknown; width?: unknown }>;
  };
  const raw = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
  const items: Item[] = [];
  for (const row of raw) {
    const url = String(row?.url || '').trim();
    const parsed = parseStoredStorageUrl(url);
    if (!parsed || !isPrivateImageBucket(parsed.bucket)) continue;
    items.push({ url, width: clampWidth(Number(row?.width)), bucket: parsed.bucket, path: parsed.path });
  }

  const serviceItems = items.filter((item) => serviceRoleSignable(item.bucket, item.path));
  const memberItems = items.filter(
    (item) => item.bucket === 'equipment-photos' && !serviceRoleSignable(item.bucket, item.path)
  );

  const signedByPath = new Map<string, string>();

  async function apply(client: SupabaseClient, group: Item[]) {
    const byBucketWidth = new Map<string, Item[]>();
    for (const item of group) {
      const key = `${item.bucket}\n${item.width}`;
      const list = byBucketWidth.get(key) || [];
      list.push(item);
      byBucketWidth.set(key, list);
    }
    for (const list of byBucketWidth.values()) {
      const paths = [...new Set(list.map((item) => item.path))];
      const signed = await signPaths(client, list[0].bucket, paths, list[0].width);
      for (const [path, url] of Object.entries(signed)) {
        signedByPath.set(`${list[0].bucket}\n${list[0].width}\n${path}`, url);
      }
    }
  }

  if (serviceItems.length) {
    if (!hasServiceRole()) {
      console.error('[signed-urls] service role unavailable');
    } else {
      try {
        await apply(getSupabaseAdmin(), serviceItems);
      } catch (err) {
        console.error('[signed-urls] service sign failed', err);
      }
    }
  }

  const token = bearer(req);
  if (memberItems.length && token) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (url && anon) {
      const userClient = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      try {
        await apply(userClient, memberItems);
      } catch (err) {
        console.error('[signed-urls] member sign failed', err);
      }
    }
  }

  return NextResponse.json({
    results: items.map((item) => ({
      url: item.url,
      width: item.width,
      signedUrl: signedByPath.get(`${item.bucket}\n${item.width}\n${item.path}`) || null,
    })),
  });
}
