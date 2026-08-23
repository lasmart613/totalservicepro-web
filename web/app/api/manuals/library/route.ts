import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { isUnlimitedManualSlots, manualSlotLimit } from '@/lib/org-plan';
import { normalizeOrgId } from '@/lib/billing/upgrade-session';

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

async function ownedManualIds(
  client: { from: (table: string) => any },
  userId: string,
  orgId: string | null
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (orgId) {
    const { data } = await client
      .from('organization_manuals')
      .select('manual_id')
      .eq('organization_id', orgId);
    for (const row of data || []) {
      if (row.manual_id != null) ids.add(String(row.manual_id));
    }
  }
  const { data: userRows } = await client.from('user_manuals').select('manual_id').eq('user_id', userId);
  for (const row of userRows || []) {
    if (row.manual_id != null) ids.add(String(row.manual_id));
  }
  return ids;
}

/**
 * Add a manual to the signed-in org library. Premium is capped at 15.
 * Team / Enterprise are unlimited. Download still requires ownership.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadCaller(req);
    if (!('user' in caller) || !caller.user) return caller.error;
    const { user, supabase } = caller;

    const body = (await req.json().catch(() => ({}))) as { manual_id?: string | number };
    const manualId = body.manual_id;
    if (manualId == null || String(manualId).trim() === '') {
      return NextResponse.json({ error: 'Missing manual_id' }, { status: 400 });
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
        { error: 'No service company on your profile — complete onboarding first.' },
        { status: 409 }
      );
    }

    let orgRes = await writer
      .from('organizations')
      .select('is_premium, subscription_tier, plan, manual_slots')
      .eq('id', orgId)
      .maybeSingle();
    if (orgRes.error && /subscription_tier|plan|manual_slots|column/i.test(orgRes.error.message || '')) {
      orgRes = await writer
        .from('organizations')
        .select('is_premium, subscription_tier, plan')
        .eq('id', orgId)
        .maybeSingle();
    }
    if (orgRes.error && /subscription_tier|plan|column/i.test(orgRes.error.message || '')) {
      orgRes = await writer.from('organizations').select('is_premium').eq('id', orgId).maybeSingle();
    }

    const limit = manualSlotLimit(orgRes.data);
    const owned = await ownedManualIds(writer, user.id, orgId);
    if (owned.has(String(manualId))) {
      return NextResponse.json({ ok: true, already: true, slot_limit: limit, used: owned.size });
    }
    if (!isUnlimitedManualSlots(limit) && owned.size >= limit) {
      return NextResponse.json(
        {
          error: `Company library is full (${owned.size}/${limit}). Upgrade for more slots.`,
          slot_limit: limit,
          used: owned.size,
        },
        { status: 409 }
      );
    }

    let { error } = await writer.from('organization_manuals').insert({
      organization_id: orgId,
      manual_id: manualId,
      added_by: user.id,
    });
    if (error && /duplicate|unique|23505/i.test(error.message || '')) {
      return NextResponse.json({ ok: true, already: true, slot_limit: limit, used: owned.size });
    }
    if (error && /schema cache|does not exist|relation/i.test(error.message || '')) {
      const um = await writer.from('user_manuals').insert({
        user_id: user.id,
        manual_id: manualId,
      });
      if (um.error && !/duplicate|unique|23505/i.test(um.error.message || '')) {
        return NextResponse.json({ error: um.error.message || 'Could not add manual' }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        personal: true,
        slot_limit: limit,
        used: owned.size + 1,
      });
    }
    if (error) {
      return NextResponse.json({ error: error.message || 'Could not add to company library' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, slot_limit: limit, used: owned.size + 1 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not add manual';
    console.error('[manuals/library]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
