import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, createMarketplaceUserClient, getMarketplaceCaller } from '@/lib/marketplace/caller';
import {
  WANTED_MESSAGE_SELECT,
  WANTED_POSTING_IS_FREE,
  isMissingWantedTable,
  validateWantedMessage,
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
  const caller = await getMarketplaceCaller(req);
  if (!caller) return fail(401, 'Sign in to message the buyer.');
  const token = bearerToken(req);
  const client = token ? createMarketplaceUserClient(token) : null;
  if (!client) return fail(503, 'Wanted board is unavailable.');

  const { data, error } = await client
    .from('marketplace_wanted_messages')
    .select(WANTED_MESSAGE_SELECT)
    .eq('wanted_id', id)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    if (isMissingWantedTable(error)) return NextResponse.json({ messages: [], free: true });
    return fail(400, 'Could not load messages.');
  }
  return NextResponse.json({ messages: data || [], free: true });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const id = await wantedId(ctx);
  if (!id) return fail(404, 'That wanted post was not found.');
  const caller = await getMarketplaceCaller(req);
  if (!caller) return fail(401, 'Sign in to message the buyer.');
  const token = bearerToken(req);
  const client = token ? createMarketplaceUserClient(token) : null;
  if (!client) return fail(503, 'Wanted board is unavailable.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Write a message before sending.');
  }
  const parsed = validateWantedMessage(body);
  if (!parsed.ok) return fail(400, parsed.error);

  const { data, error } = await client
    .from('marketplace_wanted_messages')
    .insert({ wanted_id: id, sender_id: caller.userId, body: parsed.body })
    .select(WANTED_MESSAGE_SELECT)
    .maybeSingle();
  if (error || !data) {
    if (/closed|status|row-level|42501|permission/i.test(error?.message || '')) {
      return fail(403, 'This wanted post is closed.');
    }
    return fail(400, 'Could not send that message.');
  }
  return NextResponse.json({ message: data, free: true }, { status: 201 });
}
