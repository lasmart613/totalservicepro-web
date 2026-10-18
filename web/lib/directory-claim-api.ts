import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { LISTING_CLAIM_REFUSALS, verifyDirectoryListingInvite } from '@/lib/directory-review';


type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export type DirectoryClaimDeps = {
  getUser?: (token: string) => Promise<{ id: string; email?: string | null } | null>;
  rpc?: Rpc;
};

/**
 * POST /api/directory/claim { token }  (Bearer session)
 * First owner of an approved Medical Repair Network listing (service company
 * or parts supplier). The database decides (claim_directory_listing_invite):
 * open invite, confirmed login email = the registered email, the org has no
 * members, the user has no other org. This route never writes memberships.
 */
export async function runDirectoryClaim(req: NextRequest, deps: DirectoryClaimDeps = {}) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const invite = verifyDirectoryListingInvite(body.token);
  if (!invite) return NextResponse.json({ error: LISTING_CLAIM_REFUSALS.invite_invalid.error, code: 'invite_invalid' }, { status: 400 });

  let user: { id: string; email?: string | null } | null = null;
  if (deps.getUser) {
    user = await deps.getUser(bearer);
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await c.auth.getUser(bearer);
    user = data.user ? { id: data.user.id, email: data.user.email } : null;
  }
  if (!user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  if (!deps.rpc && !hasServiceRole()) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

  const args = {
    p_invite_id: invite.inv,
    p_user_id: user.id,
    p_first_name: typeof body.firstName === 'string' ? body.firstName.slice(0, 80) : null,
    p_last_name: typeof body.lastName === 'string' ? body.lastName.slice(0, 80) : null,
  };
  const res = deps.rpc !== undefined
    ? await deps.rpc('claim_directory_listing_invite', args)
    : await getSupabaseAdmin().rpc('claim_directory_listing_invite', args);
  const { data, error } = res;
  if (error) return NextResponse.json({ error: 'Could not claim this listing. Try again.' }, { status: 503 });
  const r = (data || {}) as { ok?: boolean; code?: string; organization_id?: unknown; already_linked?: boolean };
  if (r.ok !== true) {
    const code = String(r.code || 'invite_invalid');
    const refusal = LISTING_CLAIM_REFUSALS[code] ?? LISTING_CLAIM_REFUSALS.invite_invalid;
    return NextResponse.json({ ok: false, code, error: refusal.error }, { status: refusal.status });
  }
  return NextResponse.json({ ok: true, organization_id: r.organization_id, already_linked: r.already_linked === true });
}
