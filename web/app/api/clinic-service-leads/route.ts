import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { clinicLeadClientIp } from '@/lib/clinic-lead-confirmation';
import { handleClinicLeadPost } from '@/lib/clinic-lead-handler';

export const dynamic = 'force-dynamic';

const recentByIp = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = (recentByIp.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    recentByIp.set(ip, prev);
    return true;
  }
  prev.push(now);
  recentByIp.set(ip, prev);
  return false;
}

/**
 * POST /api/clinic-service-leads
 * Guest clinic lead from the logged-out landing (find-a-rep). Service role
 * only; see lib/clinic-lead-handler.ts for inserts, emails and the
 * one-confirmation claim.
 */
export async function POST(req: NextRequest) {
  // Netlify's client IP first; a client-supplied first XFF hop is never trusted.
  if (rateLimited(clinicLeadClientIp((name) => req.headers.get(name)))) {
    return NextResponse.json(
      { error: 'Too many requests from this network. Try again in a few minutes.' },
      { status: 429 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let admin = null;
  try {
    admin = hasServiceRole() ? getSupabaseAdmin() : null;
  } catch (e) {
    console.error('[clinic-service-leads] admin client', e);
  }
  const res = await handleClinicLeadPost(body, { admin });
  return NextResponse.json(res.body, { status: res.status });
}
