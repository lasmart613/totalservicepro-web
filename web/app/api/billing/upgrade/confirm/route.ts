import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { applyPaidCheckoutSession } from '@/lib/billing/apply-org-upgrade';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import { normalizeOrgId } from '@/lib/billing/upgrade-session';
import {
  retrieveCheckoutSession,
  retrieveStripeInvoice,
  StripeSubscriptionError,
} from '@/lib/billing/stripe-subscription';

export const dynamic = 'force-dynamic';

/**
 * After Stripe success_url, verify the paid session and upgrade THIS org.
 * Unpaid / canceled sessions are rejected. No invite email is sent.
 * Idempotent — a second confirm of the same session does not create an account.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadBillingCaller(req);
    if (!('user' in caller) || !caller.user) return caller.error;
    const { user, supabase } = caller;

    const body = (await req.json().catch(() => ({}))) as { session_id?: string; sessionId?: string };
    const sessionId = String(body.session_id || body.sessionId || '').trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    let orgId = normalizeOrgId(profile?.organization_id);
    const writer = hasServiceRole() ? getSupabaseAdmin() : supabase;
    if (!orgId && hasServiceRole()) {
      const { data: adminProfile } = await writer
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      orgId = normalizeOrgId(adminProfile?.organization_id);
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Your account is not linked to an organization.' },
        { status: 409 }
      );
    }

    const session = await retrieveCheckoutSession(sessionId);
    if (typeof session.invoice === 'string' && String(session.invoice).startsWith('in_')) {
      try {
        session.invoice = await retrieveStripeInvoice(String(session.invoice));
      } catch (invoiceErr) {
        console.warn('[billing/upgrade/confirm] invoice expand skipped', invoiceErr);
      }
    }

    const result = await applyPaidCheckoutSession({
      writer,
      session,
      expectedOwner: { userId: user.id, organizationId: orgId },
      userEmail: user.email || null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Checkout was not completed. You were not charged.', reason: result.reason },
        { status: 409 }
      );
    }

    const { data: orgRow } = await writer
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      organizationId: result.applied.organizationId,
      organizationName: orgRow?.name ? String(orgRow.name) : null,
      plan: result.applied.plan,
      sku: result.applied.sku,
      org: result.applied.org,
      ...result.applied.receipt,
    });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Confirm failed';
    console.error('[billing/upgrade/confirm]', e);
    return NextResponse.json({ error: message }, { status });
  }
}
