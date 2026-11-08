import { NextRequest, NextResponse } from 'next/server';
import {
  bearerToken,
  createMarketplaceAnonClient,
  createMarketplaceUserClient,
  getMarketplaceCaller,
} from '@/lib/marketplace/caller';
import {
  WANTED_POSTING_IS_FREE,
  WANTED_PUBLIC_SELECT,
  buildWantedContentUpdate,
  buildWantedStatusPatch,
  canManageWanted,
  isMissingWantedTable,
  validateWantedStatus,
  validateWantedWrite,
  type WantedRecord,
} from '@/lib/marketplace/wanted';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(status: number, error: string) {
  return NextResponse.json({ error, free: WANTED_POSTING_IS_FREE }, { status });
}

async function wantedId(ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const raw = await Promise.resolve(ctx.params);
  const id = raw?.id || '';
  return UUID.test(id) ? id : '';
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const id = await wantedId(ctx);
  if (!id) return fail(404, 'That wanted post was not found.');
  const token = bearerToken(req);
  const client = token ? createMarketplaceUserClient(token) : createMarketplaceAnonClient();
  if (!client) return fail(503, 'Wanted board is unavailable.');
  const caller = token ? await getMarketplaceCaller(req) : null;
  const { data, error } = await client.from('marketplace_wanted').select(WANTED_PUBLIC_SELECT).eq('id', id).maybeSingle();
  if (error) {
    if (isMissingWantedTable(error)) return fail(404, 'That wanted post was not found.');
    return fail(500, 'Could not load wanted posts.');
  }
  const post = data as WantedRecord | null;
  if (!post) return fail(404, 'That wanted post was not found.');
  return NextResponse.json({
    post,
    free: true,
    can_manage: canManageWanted(post, caller || {}),
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const id = await wantedId(ctx);
  if (!id) return fail(404, 'That wanted post was not found.');
  const caller = await getMarketplaceCaller(req);
  if (!caller) return fail(401, 'Sign in required.');
  const token = bearerToken(req);
  const client = token ? createMarketplaceUserClient(token) : null;
  if (!client) return fail(503, 'Wanted board is unavailable.');

  const { data: existing, error: loadError } = await client
    .from('marketplace_wanted')
    .select(WANTED_PUBLIC_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (loadError) {
    if (isMissingWantedTable(loadError)) return fail(503, 'The Wanted board is not on this database yet.');
    return fail(400, 'That wanted post could not be saved.');
  }
  const post = existing as WantedRecord | null;
  if (!post) return fail(404, 'That wanted post was not found.');
  if (!canManageWanted(post, caller)) return fail(403, 'You cannot change this wanted post.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'That wanted post could not be saved.');
  }
  const rec = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!rec) return fail(400, 'That wanted post could not be saved.');

  const keys = Object.keys(rec);
  const statusOnly = keys.length > 0 && keys.every((key) => key === 'status');
  const patch: Record<string, unknown> = {};
  if (!statusOnly) {
    const parsed = validateWantedWrite({ ...post, ...rec });
    if (!parsed.ok) return fail(400, parsed.error);
    Object.assign(patch, buildWantedContentUpdate(parsed.value));
  }
  if (Object.prototype.hasOwnProperty.call(rec, 'status')) {
    const status = validateWantedStatus(rec.status);
    if (!status) return fail(400, 'Choose open, filled, or closed.');
    Object.assign(patch, buildWantedStatusPatch(status));
  }
  if (!Object.keys(patch).length) return fail(400, 'That wanted post could not be saved.');

  const { data, error } = await client
    .from('marketplace_wanted')
    .update(patch)
    .eq('id', id)
    .select(WANTED_PUBLIC_SELECT)
    .maybeSingle();
  if (error || !data) return fail(400, 'That wanted post could not be saved.');
  return NextResponse.json({ post: data, free: true, can_manage: true });
}
