import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  libraryAddBlocked,
  libraryFullMessage,
  manualSlotLimit,
  MANUAL_UPGRADE_PATH,
  orgIsPaid,
} from '@/lib/org-plan';
import { normalizeOrgId } from '@/lib/billing/upgrade-session';
import { canAccessServiceManuals } from '@/lib/roles';
import { mayOpenManual, manualsAccess, manualsForbiddenMessage } from '@/lib/manuals-access';
import { libraryRowIsFree, manualIsIncomplete, slotCountedManuals } from '@/lib/manual-incomplete';
import { MANUAL_LIBRARY_SELECT_MINIMAL, MANUAL_LIBRARY_SELECT_WITH_KIND } from '@/lib/manual-library-filter';
import { isPublishedColumnMissing, wherePublished } from '@/lib/manual-published';
import { normalizeLibrarySource } from '@/lib/manual-library-refund';

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

async function lookupManual(
  client: { from: (table: string) => any },
  manualId: string | number
): Promise<{
  id?: unknown;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
  doc_kind?: string | null;
} | null> {
  const full = await wherePublished(
    client.from('manuals').select(MANUAL_LIBRARY_SELECT_WITH_KIND).eq('id', manualId),
  ).maybeSingle();
  if (!full.error) return full.data || null;
  if (isPublishedColumnMissing(full.error)) {
    const again = await client
      .from('manuals')
      .select(MANUAL_LIBRARY_SELECT_WITH_KIND)
      .eq('id', manualId)
      .maybeSingle();
    if (!again.error) return again.data || null;
  }
  const slim = await wherePublished(
    client.from('manuals').select(MANUAL_LIBRARY_SELECT_MINIMAL).eq('id', manualId),
  ).maybeSingle();
  if (!slim.error) return slim.data || null;
  if (isPublishedColumnMissing(slim.error)) {
    const plain = await client.from('manuals').select(MANUAL_LIBRARY_SELECT_MINIMAL).eq('id', manualId).maybeSingle();
    return plain.data || null;
  }
  return null;
}

type OwnedManuals = { ids: Set<string>; /** Slots used: incomplete manuals are free. */ counted: number };

async function ownedManualIds(
  client: { from: (table: string) => any },
  userId: string,
  orgId: string | null
): Promise<OwnedManuals> {
  const rows = new Map<string, { is_incomplete?: unknown }>();
  const load = async (table: string, col: string, val: string) => {
    // Row '*' includes free_at_add once 000942 is applied (sticky free add).
    let res = await client.from(table).select('*, manuals(is_incomplete)').eq(col, val);
    // Column or embed missing: count every row (old behavior).
    if (res.error) res = await client.from(table).select('manual_id').eq(col, val);
    for (const row of res.data || []) {
      if (row.manual_id == null) continue;
      const m = Array.isArray(row.manuals) ? row.manuals[0] : row.manuals;
      const key = String(row.manual_id);
      const prev = rows.get(key);
      // Same manual in both tables counts once; free if added free or flagged now.
      rows.set(key, { is_incomplete: prev?.is_incomplete === true || libraryRowIsFree(row, m) });
    }
  };
  if (orgId) await load('organization_manuals', 'organization_id', orgId);
  await load('user_manuals', 'user_id', userId);
  return { ids: new Set(rows.keys()), counted: slotCountedManuals(rows.values()) };
}

function isMissingSourceColumn(error: { message?: string } | null | undefined): boolean {
  const msg = String(error?.message || '');
  return /source/i.test(msg) && /column|schema cache/i.test(msg);
}

/** Slots held by non-refunded removals this month (000936). 0 before 000936. */
async function slotsHeld(client: { rpc: (fn: string, args: Record<string, unknown>) => any }, orgId: string | number) {
  try {
    const { data, error } = await client.rpc('manual_slots_held', { p_org: Number(orgId) });
    if (error) return 0;
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

async function slotIsHeld(
  client: { rpc: (fn: string, args: Record<string, unknown>) => any },
  orgId: string | number,
  manualId: string | number,
) {
  try {
    const { data, error } = await client.rpc('manual_slot_is_held', { p_org: Number(orgId), p_manual_id: Number(manualId) });
    return !error && data === true;
  } catch {
    return false;
  }
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

    const body = (await req.json().catch(() => ({}))) as { manual_id?: string | number; source?: unknown };
    const source = normalizeLibrarySource(body.source);
    const manualId = body.manual_id;
    if (manualId == null || String(manualId).trim() === '') {
      return NextResponse.json({ error: 'Missing manual_id' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, organization_id, organizations(type)')
      .eq('id', user.id)
      .maybeSingle();
    const orgJoin = profile?.organizations as { type?: string } | { type?: string }[] | null;
    const orgType = Array.isArray(orgJoin) ? orgJoin[0]?.type : orgJoin?.type;
    const access = manualsAccess(profile?.role, orgType);
    if (!access.page) {
      return NextResponse.json(
        { error: manualsForbiddenMessage(profile?.role, orgType) },
        { status: 403 }
      );
    }
    const catalog = await lookupManual(supabase, manualId);
    if (!catalog) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!mayOpenManual(profile?.role, orgType, catalog) || (!access.service && !canAccessServiceManuals(profile?.role, orgType) && !catalog)) {
      return NextResponse.json(
        { error: manualsForbiddenMessage(profile?.role, orgType) },
        { status: 403 }
      );
    }
    let orgId = normalizeOrgId(profile?.organization_id);
    // 000936 revoked INSERT for signed-in users: fail closed without the service role.
    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 });
    }
    const writer = getSupabaseAdmin();
    if (!orgId) {
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
      .select('is_premium, subscription_tier, plan, manual_slots, premium_until')
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
    const ownedRes = await ownedManualIds(writer, user.id, orgId);
    const owned = ownedRes.ids;
    const free = manualIsIncomplete(catalog);
    if (owned.has(String(manualId))) {
      return NextResponse.json({ ok: true, already: true, slot_limit: limit, used: ownedRes.counted });
    }
    // 000936: removals that were not refunded keep holding their slot this month.
    const held = await slotsHeld(writer, orgId);
    const usedNow = ownedRes.counted + held;
    // Re-adding a manual whose slot is held nets zero, so it is allowed when full.
    const reAddHeld = held > 0 && (await slotIsHeld(writer, orgId, manualId));
    // Incomplete manuals are free: they never use a slot, so the cap does not apply.
    // Over the cap after a downgrade: saved manuals stay and still open; only new adds stop.
    if (!free && libraryAddBlocked(usedNow, limit) && !reAddHeld) {
      return NextResponse.json(
        {
          error: libraryFullMessage(usedNow, limit, !orgIsPaid(orgRes.data)),
          upgrade_url: MANUAL_UPGRADE_PATH,
          library_full: true,
          slot_limit: limit,
          used: usedNow,
          held,
        },
        { status: 409 }
      );
    }

    let { error } = await writer.from('organization_manuals').insert({
      organization_id: orgId,
      manual_id: manualId,
      added_by: user.id,
      source,
    });
    if (error && isMissingSourceColumn(error)) {
      // 000936 not applied yet.
      ({ error } = await writer.from('organization_manuals').insert({
        organization_id: orgId,
        manual_id: manualId,
        added_by: user.id,
      }));
    }
    if (error && /duplicate|unique|23505/i.test(error.message || '')) {
      return NextResponse.json({ ok: true, already: true, slot_limit: limit, used: ownedRes.counted });
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
        used: free ? ownedRes.counted : ownedRes.counted + 1,
      });
    }
    if (error) {
      return NextResponse.json({ error: error.message || 'Could not add to company library' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, slot_limit: limit, used: reAddHeld || free ? usedNow : usedNow + 1, ...(free ? { free_incomplete: true } : {}) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not add manual';
    console.error('[manuals/library]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
