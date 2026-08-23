import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getPlanOffer, isPlanSku } from '@/lib/billing/plan-catalog';
import { orgIsPaid } from '@/lib/org-plan';
import { normalizeOrgId } from '@/lib/billing/upgrade-session';
import {
  createOrgUpgradeCheckoutSession,
  StripeSubscriptionError,
} from '@/lib/billing/stripe-subscription';

export const dynamic = 'force-dynamic';

async function loadCaller(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { error: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }
  return { user, supabase };
}

/**
 * Start Stripe Checkout for the signed-in user's existing organization.
 * Does not create a user or org. Does not send email.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadCaller(req);
    if ('error' in caller && caller.error) return caller.error;
    const { user, supabase } = caller;

    const body = (await req.json().catch(() => ({}))) as { sku?: string };
    const sku = String(body.sku || '').trim();
    if (!isPlanSku(sku) || !getPlanOffer(sku)) {
      return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();

    let orgId = normalizeOrgId(profile?.organization_id);
    if (!orgId && hasServiceRole()) {
      const admin = getSupabaseAdmin();
      const { data: adminProfile } = await admin
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      orgId = normalizeOrgId(adminProfile?.organization_id);
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Your account is not linked to an organization to upgrade.' },
        { status: 409 }
      );
    }

    let org: { is_premium?: boolean | null; subscription_tier?: string | null; plan?: string | null } | null =
      null;
    const orgSelect = async (client: typeof supabase, columns: string) =>
      client.from('organizations').select(columns).eq('id', orgId).maybeSingle();

    let orgRes = await orgSelect(supabase, 'is_premium, subscription_tier, plan');
    if (orgRes.error && /subscription_tier|plan|column/i.test(orgRes.error.message || '')) {
      orgRes = await orgSelect(supabase, 'is_premium, subscription_tier');
    }
    if (orgRes.error && /subscription_tier|column/i.test(orgRes.error.message || '')) {
      orgRes = await orgSelect(supabase, 'is_premium');
    }
    org = orgRes.data as typeof org;
    if (orgIsPaid(org)) {
      return NextResponse.json({ error: 'This organization is already on a paid plan.' }, { status: 409 });
    }

    let customerId: string | null = null;
    const { data: stripeRow } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (stripeRow?.stripe_customer_id) customerId = String(stripeRow.stripe_customer_id);

    const session = await createOrgUpgradeCheckoutSession({
      sku,
      owner: { userId: user.id, organizationId: orgId },
      customerId,
      customerEmail: user.email || null,
    });

    return NextResponse.json({
      url: session.url,
      sessionId: session.sessionId,
      livemode: session.livemode,
      sku: session.sku,
      organizationId: session.organizationId,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Checkout failed';
    console.error('[billing/upgrade/checkout]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
