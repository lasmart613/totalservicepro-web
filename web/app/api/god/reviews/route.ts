import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { UNSHARED_CACHE_HEADERS, validateHideReview } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

const REVIEW_COLUMNS =
  'id, service_organization_id, customer_organization_id, stars, body, reply_body, hidden_at, hidden_reason, created_at, job_key';

/**
 * God moderation. requireGodCaller uses the auth allowlist.
 * The service role is the only database role that can change hidden_at.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('service_org_reviews')
    .select(REVIEW_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: 'Directory unavailable' }, { status: 503, headers: UNSHARED_CACHE_HEADERS });
  }
  return NextResponse.json({ reviews: data || [] }, { headers: UNSHARED_CACHE_HEADERS });
}

export async function POST(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) return NextResponse.json({ error: 'Directory unavailable' }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'That review was not found.' }, { status: 404, headers: UNSHARED_CACHE_HEADERS });
  }
  const decision = validateHideReview({ hidden: body.hidden, reason: body.reason });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: 400, headers: UNSHARED_CACHE_HEADERS });
  }
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('service_org_reviews')
    .update({
      hidden_at: decision.hidden ? new Date().toISOString() : null,
      hidden_by: decision.hidden ? gate.caller.userId : null,
      hidden_reason: decision.reason,
    })
    .eq('id', id)
    .select('id');
  if (!error && !data?.length) {
    return NextResponse.json({ error: 'That review was not found.' }, { status: 404, headers: UNSHARED_CACHE_HEADERS });
  }
  if (error || !data?.length) {
    return NextResponse.json(
      { error: 'A reason is required to hide a review.' },
      { status: 403, headers: UNSHARED_CACHE_HEADERS }
    );
  }
  return NextResponse.json({ ok: true, hidden: decision.hidden }, { headers: UNSHARED_CACHE_HEADERS });
}
