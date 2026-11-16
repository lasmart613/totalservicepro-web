import { NextRequest } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { isReviewId, validateHideReview } from '@/lib/reviews';
import { noStoreJson } from '@/lib/reviews-server';

export const dynamic = 'force-dynamic';

const REVIEW_COLUMNS =
  'id, service_organization_id, customer_organization_id, stars, body, reply_body, hidden_at, hidden_reason, created_at, job_key';

async function gateOrDeny(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (gate.ok) return gate;
  const payload = await gate.response.json().catch(() => ({ error: 'Not found', god: false }));
  return { ok: false as const, response: noStoreJson(payload, gate.response.status) };
}

/**
 * God moderation. requireGodCaller uses the auth allowlist.
 * The service role is the only database role that can change hidden_at.
 */
export async function GET(req: NextRequest) {
  const gate = await gateOrDeny(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) return noStoreJson({ error: 'Directory unavailable' }, 503);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('service_org_reviews')
    .select(REVIEW_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return noStoreJson({ error: 'Directory unavailable' }, 503);
  return noStoreJson({ reviews: data || [] });
}

export async function POST(req: NextRequest) {
  const gate = await gateOrDeny(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) return noStoreJson({ error: 'Directory unavailable' }, 503);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!isReviewId(id)) return noStoreJson({ error: 'That review was not found.' }, 404);
  const decision = validateHideReview({ hidden: body.hidden, reason: body.reason });
  if (!decision.ok) return noStoreJson({ error: decision.error }, 400);
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
  if (!error && !data?.length) return noStoreJson({ error: 'That review was not found.' }, 404);
  if (error && /22P02|invalid input syntax for type uuid/i.test(error.message || '')) {
    return noStoreJson({ error: 'That review was not found.' }, 404);
  }
  if (error || !data?.length) return noStoreJson({ error: 'A reason is required to hide a review.' }, 403);
  return noStoreJson({ ok: true, hidden: decision.hidden });
}
