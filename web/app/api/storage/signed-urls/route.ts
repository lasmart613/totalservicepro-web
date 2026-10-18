import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { signImagePaths } from '@/lib/signed-image-urls';
import { isPublicListingObject, listingPathOwner, publicListingObjectKeys } from '@/lib/public-listing-sign';
import {
  isPrivateImageBucket,
  parseStoredStorageUrl,
  serviceRoleSignable,
  snapThumbWidth,
} from '@/lib/storage-display';

export const dynamic = 'force-dynamic';

type Item = { url: string; width: number | null; bucket: string; path: string };

function bearer(req: NextRequest): string {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

/** null means the original object (no transform). Any number snaps to a thumbnail width. */
function itemWidth(value: unknown): number | null {
  if (value == null) return null;
  return snapThumbWidth(Number(value));
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
    items.push({ url, width: itemWidth(row?.width), bucket: parsed.bucket, path: parsed.path });
  }

  // Service role signs only photos of a public listing (referenced by an
  // active listing's images/photos, under its seller's {uid}/listings/).
  // Everything else is signed with the caller's JWT (storage RLS) or not at all.
  const candidates = items.filter(
    (item) => serviceRoleSignable(item.bucket, item.path) && listingPathOwner(item.path) != null
  );
  let publicKeys = new Set<string>();
  if (candidates.length && hasServiceRole()) {
    const owners = [...new Set(candidates.map((item) => listingPathOwner(item.path) as string))];
    try {
      const admin = getSupabaseAdmin();
      const list = owners.join(',');
      const { data, error } = await admin
        .from('marketplace_listings')
        .select('status, seller_id, created_by, images, photos')
        .or(`seller_id.in.(${list}),created_by.in.(${list})`)
        .limit(500);
      if (error) console.error('[signed-urls] listing lookup failed', error.message);
      publicKeys = publicListingObjectKeys((data as any[]) || []);
    } catch (err) {
      console.error('[signed-urls] listing lookup failed', err);
    }
  }
  const serviceItems = candidates.filter((item) => isPublicListingObject(publicKeys, item.bucket, item.path));
  const serviceSet = new Set(serviceItems);
  const memberItems = items.filter((item) => item.bucket === 'equipment-photos' && !serviceSet.has(item));

  const signedByPath = new Map<string, string>();

  async function apply(client: SupabaseClient, group: Item[]) {
    const byBucketWidth = new Map<string, Item[]>();
    for (const item of group) {
      const key = `${item.bucket}\n${item.width == null ? 'full' : item.width}`;
      const list = byBucketWidth.get(key) || [];
      list.push(item);
      byBucketWidth.set(key, list);
    }
    for (const list of byBucketWidth.values()) {
      const paths = [...new Set(list.map((item) => item.path))];
      const signed = await signImagePaths(client.storage.from(list[0].bucket), list[0].bucket, paths, list[0].width);
      for (const [path, url] of Object.entries(signed)) {
        signedByPath.set(`${list[0].bucket}\n${list[0].width == null ? 'full' : list[0].width}\n${path}`, url);
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
      signedUrl:
        signedByPath.get(`${item.bucket}\n${item.width == null ? 'full' : item.width}\n${item.path}`) || null,
    })),
  });
}
