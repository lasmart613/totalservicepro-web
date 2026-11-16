import { NextRequest } from 'next/server';
import { bearerToken, noStoreJson, userScopedClient } from '@/lib/reviews-server';
import { mapReviewWriteError, validateReviewTarget, validateReviewWrite } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/** GET is not a ratings write. 405 stays out of the shared cache. */
export function GET() {
  return noStoreJson({ error: 'Method not allowed' }, 405);
}

/**
 * POST /api/reviews
 * Insert or edit the caller's rating. The user JWT is forwarded so
 * membership RLS and the stars constraint run in the database.
 */
export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return noStoreJson({ error: 'Sign in to rate this company.' }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const stars = validateReviewWrite({ stars: body.stars, body: body.body });
  if (!stars.ok) return noStoreJson({ error: stars.error }, 400);
  const target = validateReviewTarget({
    ticketId: body.ticketId ?? body.ticket_id,
    reportId: body.reportId ?? body.report_id,
    invoiceId: body.invoiceId ?? body.invoice_id,
  });
  if (!target.ok) return noStoreJson({ error: target.error }, 400);

  const serviceOrgId = Number(body.serviceOrganizationId ?? body.service_organization_id);
  const customerOrgId = Number(body.customerOrganizationId ?? body.customer_organization_id);
  if (!Number.isInteger(serviceOrgId) || serviceOrgId <= 0 || !Number.isInteger(customerOrgId) || customerOrgId <= 0) {
    return noStoreJson({ error: 'Pick the completed job you want to rate.' }, 400);
  }
  if (serviceOrgId === customerOrgId) {
    return noStoreJson({ error: 'You cannot rate an organization you belong to.' }, 400);
  }

  const supabase = userScopedClient(token);
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) return noStoreJson({ error: 'Sign in to rate this company.' }, 401);

  const reviewId = typeof body.reviewId === 'string' ? body.reviewId.trim() : '';
  const payload = { stars: stars.stars, body: stars.body };
  const write = reviewId
    ? await supabase
        .from('service_org_reviews')
        .update(payload)
        .eq('id', reviewId)
        .eq('author_user_id', user.id)
        .select('id')
    : await supabase
        .from('service_org_reviews')
        .insert({
          ...payload,
          customer_organization_id: customerOrgId,
          service_organization_id: serviceOrgId,
          author_user_id: user.id,
          ticket_id: target.ticketId,
          report_id: target.reportId,
          invoice_id: target.invoiceId,
        })
        .select('id');

  if (write.error) {
    const status = /duplicate key|23505/i.test(write.error.message || '') ? 409 : 403;
    return noStoreJson({ error: mapReviewWriteError(write.error.message) }, status);
  }
  if (!write.data?.length) return noStoreJson({ error: 'Could not save the rating.' }, 403);
  return noStoreJson({ ok: true });
}
