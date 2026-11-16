import { NextRequest } from 'next/server';
import { bearerToken, noStoreJson, userScopedClient } from '@/lib/reviews-server';
import { mapReviewWriteError, validateReviewReply } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/** GET is not a reply. 405 stays out of the shared cache. */
export function GET() {
  return noStoreJson({ error: 'Method not allowed' }, 405);
}

/**
 * POST /api/reviews/reply
 * One public reply. The database allows it only for an owner, company_admin,
 * or admin membership on the rated organization.
 */
export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return noStoreJson({ error: 'Sign in to rate this company.' }, 401);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reply = validateReviewReply(body.body);
  if (!reply.ok) return noStoreJson({ error: reply.error }, 400);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return noStoreJson({ error: 'Only an owner or company admin can reply.' }, 400);

  const supabase = userScopedClient(token);
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) return noStoreJson({ error: 'Sign in to rate this company.' }, 401);

  const { data, error } = await supabase
    .from('service_org_reviews')
    .update({ reply_body: reply.body })
    .eq('id', id)
    .select('id');
  if (error || !data?.length) {
    return noStoreJson(
      { error: error ? mapReviewWriteError(error.message) : 'Only an owner or company admin can reply.' },
      403
    );
  }
  return noStoreJson({ ok: true });
}
