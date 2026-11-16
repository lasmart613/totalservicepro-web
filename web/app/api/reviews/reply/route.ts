import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, userScopedClient } from '@/lib/reviews-server';
import { mapReviewWriteError, UNSHARED_CACHE_HEADERS, validateReviewReply } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reviews/reply
 * One public reply. The database allows it only for an owner, company_admin,
 * or admin membership on the rated organization.
 */
export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'Sign in to rate this company.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reply = validateReviewReply(body.body);
  if (!reply.ok) return NextResponse.json({ error: reply.error }, { status: 400 });
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'Only an owner or company admin can reply.' }, { status: 400 });

  const supabase = userScopedClient(token);
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) return NextResponse.json({ error: 'Sign in to rate this company.' }, { status: 401 });

  const { data, error } = await supabase
    .from('service_org_reviews')
    .update({ reply_body: reply.body })
    .eq('id', id)
    .select('id');
  if (error || !data?.length) {
    return NextResponse.json(
      { error: error ? mapReviewWriteError(error.message) : 'Only an owner or company admin can reply.' },
      { status: 403 }
    );
  }
  return NextResponse.json({ ok: true }, { headers: UNSHARED_CACHE_HEADERS });
}
