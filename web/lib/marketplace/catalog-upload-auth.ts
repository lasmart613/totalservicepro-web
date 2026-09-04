/**
 * Server-only session + org gate for catalog uploads.
 * Do not import from client components.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { canBulkUploadCatalog } from '@/lib/roles';

export type CatalogUploadCaller = {
  user: User;
  userId: string;
  email: string | null;
  organizationId: number;
  organizationName: string | null;
  organizationType: string | null;
  role: string;
};

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get('authorization') || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

export async function requireCatalogUploadCaller(
  req: NextRequest
): Promise<{ ok: true; caller: CatalogUploadCaller } | { ok: false; response: NextResponse }> {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }

  if (!hasServiceRole()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      ),
    };
  }

  const admin = getSupabaseAdmin();
  const resolved = await resolveCallerOrg(admin, user);
  if (!resolved.ok) {
    return { ok: false, response: NextResponse.json({ error: resolved.error }, { status: resolved.status }) };
  }
  return { ok: true, caller: resolved.caller };
}

export async function resolveCallerOrg(
  admin: SupabaseClient,
  user: User
): Promise<
  | { ok: true; caller: CatalogUploadCaller }
  | { ok: false; error: string; status: 403 | 404 }
> {
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, organization_id, active_organization_id, email, organizations(id, name, type)')
    .eq('id', user.id)
    .maybeSingle();

  const orgId = Number(profile?.organization_id ?? profile?.active_organization_id ?? 0);
  let org = (profile as { organizations?: { id?: number; name?: string | null; type?: string | null } | null })
    ?.organizations;
  if ((!org || !org.id) && orgId) {
    const { data } = await admin.from('organizations').select('id, name, type').eq('id', orgId).maybeSingle();
    org = data;
  }

  const role = String(profile?.role || user.user_metadata?.role || '').trim();
  const orgType = org?.type || user.user_metadata?.organization_type || null;
  if (!orgId || !org?.id) {
    return { ok: false, error: 'Your profile is not linked to an organization yet.', status: 403 };
  }
  if (!canBulkUploadCatalog(role, orgType)) {
    return {
      ok: false,
      error:
        'Bulk catalog upload is for Parts Suppliers and laser marketplace sellers (reseller / clinic / rental) with owner or supplier permission.',
      status: 403,
    };
  }

  return {
    ok: true,
    caller: {
      user,
      userId: user.id,
      email: user.email || profile?.email || null,
      organizationId: orgId,
      organizationName: org?.name || null,
      organizationType: orgType,
      role,
    },
  };
}

export function sameOrg(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  return String(a ?? '') !== '' && String(a) === String(b);
}
