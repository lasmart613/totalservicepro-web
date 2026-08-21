import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { canAccessCompanyProfile, isOwnerish } from '@/lib/roles';
import { isOwnerOrgType } from '@/lib/org-types';

/**
 * POST /api/org/profile
 * Body: profile fields for the caller's linked organization only.
 *
 * Client PATCH on organizations is a no-op under live RLS for claimed
 * owners (HTTP 204, 0 rows) because created_by is the service company.
 * Same pattern as /api/customers/claim and /api/team/claim: verify the
 * session, then write with service role. Never updates another org.
 */

const ALLOWED_FIELDS = [
  'name',
  'address',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'website',
  'contact_name',
  'notes',
  'facility_type',
  'list_in_directory',
  'supported_brands',
  'logo_url',
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function pickAllowed(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out;
}

function missingColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
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
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (!hasServiceRole()) {
      return NextResponse.json(
        {
          error:
            'Server cannot save facility profile (SUPABASE_SERVICE_ROLE_KEY missing). Same key used for invite emails.',
        },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();
    const { data: prof } = await admin
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    const linkedId = prof?.organization_id;
    if (linkedId == null) {
      return NextResponse.json({ error: 'You are not linked to an organization' }, { status: 403 });
    }

    const { data: org } = await admin
      .from('organizations')
      .select('id, type, name')
      .eq('id', linkedId)
      .maybeSingle();

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (prof?.role && !canAccessCompanyProfile(prof.role) && !isOwnerish(prof.role, org.type)) {
      return NextResponse.json({ error: 'You cannot edit this organization profile' }, { status: 403 });
    }

    if (isOwnerish(prof?.role, org.type) || isOwnerOrgType(org.type)) {
      const t = String(org.type || '').toLowerCase();
      if (t && !isOwnerOrgType(t) && t !== 'customer') {
        return NextResponse.json({ error: 'Not a facility profile' }, { status: 403 });
      }
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedId = body.id ?? body.organization_id ?? body.orgId ?? null;
    if (requestedId != null && requestedId !== '' && String(requestedId) !== String(linkedId)) {
      return NextResponse.json({ error: 'You can only edit your own facility profile.' }, { status: 403 });
    }

    const payload = pickAllowed(body);
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'No profile fields to save' }, { status: 400 });
    }
    payload.updated_at = new Date().toISOString();

    let lastError: { message?: string } | null = null;
    let saved: Record<string, unknown> | null = null;

    for (let attempt = 0; attempt < 12; attempt++) {
      const { data, error } = await admin
        .from('organizations')
        .update(payload)
        .eq('id', linkedId)
        .select('*')
        .maybeSingle();
      if (!error && data?.id != null) {
        saved = data as Record<string, unknown>;
        lastError = null;
        break;
      }
      lastError = error;
      const col = missingColumn(error?.message);
      if (col && col in payload) {
        delete payload[col];
        continue;
      }
      break;
    }

    if (!saved) {
      return NextResponse.json(
        { error: lastError?.message || 'Save did not update your facility. Try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      organizationId: saved.id,
      org: saved,
    });
  } catch (e: any) {
    console.error('org profile save', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
