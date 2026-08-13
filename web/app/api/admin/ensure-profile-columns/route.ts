import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Best-effort schema ensure for profile columns used by onboarding/team.
 * PostgREST cannot run DDL, so this probes and documents the SQL to run.
 * Call once after deploy if you see "additional_roles does not exist".
 */
export async function POST(req: NextRequest) {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Service role not configured' }, { status: 503 });
    }
    const admin = getSupabaseAdmin();

    // Probe: select optional columns
    const probe = await admin
      .from('user_profiles')
      .select('id, additional_roles, onboarding_completed_at')
      .limit(1);

    const missing: string[] = [];
    if (probe.error) {
      const msg = probe.error.message || '';
      if (/additional_roles/i.test(msg)) missing.push('additional_roles');
      if (/onboarding_completed_at/i.test(msg)) missing.push('onboarding_completed_at');
      if (!missing.length) missing.push(msg);
    }

    if (!missing.length) {
      return NextResponse.json({
        ok: true,
        message: 'Profile columns present',
        columns: ['additional_roles', 'onboarding_completed_at'],
      });
    }

    // Cannot run DDL via Supabase JS — return SQL for dashboard
    const sql = `
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS additional_roles jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
NOTIFY pgrst, 'reload schema';
`.trim();

    return NextResponse.json(
      {
        ok: false,
        missing,
        message:
          'Run this SQL in Supabase → SQL Editor (project yljztfajyvjzqikxdddf), then retry onboarding/team load.',
        sql,
      },
      { status: 409 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Probe failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
