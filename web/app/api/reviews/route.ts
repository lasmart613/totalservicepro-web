import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, userScopedClient } from '@/lib/reviews-server';
import { mapReviewWriteError, validateReviewTarget, validateReviewWrite } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reviews
 * Insert or edit the caller's rating. The user JWT is forwarded so
 * membership RLS and the stars constraint run in the database.
 */
export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'Sign in to rate this company.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const stars = validateReviewWrite({ stars: body.stars, body: body.body });
  if (!stars.ok) return NextResponse.json({ error: stars.error }, { status: 400 });
  const target = validateReviewTarget({
    ticketId: body.ticketId ?? body.ticket_id,
    reportId: body.reportId ?? body.report_id,
    invoiceId: body.invoiceId ?? body.invoice_id,
  });
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });

  const serviceOrgId = Number(body.serviceOrganizationId ?? body.service_organization_id);
  const customerOrgId = Number(body.customerOrganizationId ?? body.customer_organization_id);
  if (!Number.isInteger(serviceOrgId) || serviceOrgId <= 0 || !Number.isInteger(customerOrgId) || customerOrgId <= 0) {
    return NextResponse.json({ error: 'Pick the completed job you want to rate.' }, { status: 400 });
  }
  if (serviceOrgId === customerOrgId) {
    return NextResponse.json({ error: 'You cannot rate an organization you belong to.' }, { status: 400 });
  }

  const supabase = userScopedClient(token);
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) return NextResponse.json({ error: 'Sign in to rate this company.' }, { status: 401 });

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
    return NextResponse.json({ error: mapReviewWriteError(write.error.message) }, { status });
  }
  if (!write.data?.length) {
    return NextResponse.json({ error: 'Could not save the rating.' }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
