import { NextRequest } from 'next/server';
import { bearerToken, noStoreJson, userScopedClient } from '@/lib/reviews-server';
import { canReplyToReview } from '@/lib/reviews';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reviews/context?serviceOrgId=
 * Eligible jobs for the signed-in customer member, and whether a membership
 * role on the rated org may post the one public reply.
 */
export async function GET(req: NextRequest) {
  const token = bearerToken(req.headers.get('authorization'));
  if (!token) return noStoreJson({ error: 'Sign in to rate this company.' }, 401);
  const serviceOrgId = Number(req.nextUrl.searchParams.get('serviceOrgId'));
  if (!Number.isInteger(serviceOrgId) || serviceOrgId <= 0) {
    return noStoreJson({ error: 'Pick the completed job you want to rate.' }, 400);
  }

  const supabase = userScopedClient(token);
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) return noStoreJson({ error: 'Sign in to rate this company.' }, 401);

  const [jobsRes, memberRes] = await Promise.all([
    supabase.rpc('service_org_review_eligible_jobs', { p_service: serviceOrgId }),
    supabase
      .from('organization_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', serviceOrgId)
      .limit(1),
  ]);

  const jobs = Array.isArray(jobsRes.data) ? jobsRes.data : [];
  const role = Array.isArray(memberRes.data) ? memberRes.data[0]?.role : null;
  return noStoreJson({
    jobs,
    canReply: canReplyToReview(typeof role === 'string' ? role : null),
  });
}
