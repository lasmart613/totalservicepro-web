import { NextRequest, NextResponse } from 'next/server';
import {
  bearerToken,
  createMarketplaceAnonClient,
  createMarketplaceUserClient,
  getMarketplaceCaller,
} from '@/lib/marketplace/caller';
import {
  PUBLIC_WANTED_STATUSES,
  WANTED_POSTING_IS_FREE,
  WANTED_PUBLIC_SELECT,
  assertWantedActorCanPost,
  buildWantedInsert,
  isMissingWantedTable,
  resolveWantedOrgId,
  validateWantedWrite,
  wantedBelongsToActor,
  type WantedRecord,
} from '@/lib/marketplace/wanted';

export const dynamic = 'force-dynamic';

function fail(status: number, error: string) {
  return NextResponse.json({ error, free: WANTED_POSTING_IS_FREE }, { status });
}

/**
 * Public Wanted board. ?mine=1 is the caller's organization posts, including closed.
 * Creating a post is free: the insert has no fee and no payment provider fields.
 */
export async function GET(req: NextRequest) {
  const mine = req.nextUrl.searchParams.get('mine') === '1';
  const caller = await getMarketplaceCaller(req);
  if (mine && !caller) return fail(401, 'Sign in required.');

  const token = bearerToken(req);
  const reader = mine && token ? createMarketplaceUserClient(token) : createMarketplaceAnonClient();
  if (!reader) return fail(503, 'Wanted board is unavailable.');

  const base = reader
    .from('marketplace_wanted')
    .select(WANTED_PUBLIC_SELECT)
    .order('created_at', { ascending: false })
    .limit(200);
  const { data, error } = await (mine ? base : base.in('status', [...PUBLIC_WANTED_STATUSES]));
  if (error) {
    if (isMissingWantedTable(error)) return NextResponse.json({ posts: [], free: WANTED_POSTING_IS_FREE });
    return fail(500, 'Could not load wanted posts.');
  }
  const rows = (data || []) as unknown as WantedRecord[];
  const posts = mine && caller ? rows.filter((row) => wantedBelongsToActor(row, caller)) : rows;
  return NextResponse.json({ posts, free: WANTED_POSTING_IS_FREE });
}

export async function POST(req: NextRequest) {
  const caller = await getMarketplaceCaller(req);
  if (!caller) return fail(401, 'Sign in required.');
  const blocked = assertWantedActorCanPost(caller.role, caller.orgType);
  if (blocked) return fail(403, blocked);

  const token = bearerToken(req);
  const client = token ? createMarketplaceUserClient(token) : null;
  if (!client) return fail(503, 'Wanted board is unavailable.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'That wanted post could not be saved.');
  }
  const parsed = validateWantedWrite(body);
  if (!parsed.ok) return fail(400, parsed.error);

  const requestedOrg =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { organization_id?: unknown }).organization_id
      : null;
  const organizationId = resolveWantedOrgId(requestedOrg, caller);
  if (organizationId == null) return fail(403, 'You need an organization membership to post a wanted listing.');

  const payload = buildWantedInsert(parsed.value, { userId: caller.userId, organizationId });
  const { data, error } = await client
    .from('marketplace_wanted')
    .insert(payload)
    .select(WANTED_PUBLIC_SELECT)
    .maybeSingle();
  if (error || !data) {
    if (isMissingWantedTable(error)) return fail(503, 'The Wanted board is not on this database yet.');
    if (/membership/i.test(error?.message || '')) {
      return fail(403, 'You need an organization membership to post a wanted listing.');
    }
    return fail(400, 'That wanted post could not be saved.');
  }
  return NextResponse.json({ post: data, free: true }, { status: 201 });
}
