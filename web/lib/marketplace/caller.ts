/**
 * Resolve the signed-in marketplace actor from an Authorization Bearer token.
 */

import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { ListingActor } from './ownership.ts';

export type MarketplaceCaller = ListingActor & {
  userId: string;
  email: string | null;
};

function supabasePublicEnv(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!url || !anon) return null;
  return { url, anon };
}

export function bearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

export async function getMarketplaceCaller(req: NextRequest): Promise<MarketplaceCaller | null> {
  const token = bearerToken(req);
  const env = supabasePublicEnv();
  if (!token || !env) return null;

  const supabase = createClient(env.url, env.anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user?.id) return null;

  let orgId: string | number | null = null;
  let role: string | null = null;
  let orgType: string | null = null;
  const membershipOrgIds: Array<string | number> = [];

  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id, role, organizations(type)')
      .eq('id', user.id)
      .maybeSingle();
    orgId = (profile as { organization_id?: string | number | null } | null)?.organization_id ?? null;
    role = (profile as { role?: string | null } | null)?.role ?? null;
    const orgs = (profile as { organizations?: { type?: string | null } | { type?: string | null }[] | null } | null)
      ?.organizations;
    const org = Array.isArray(orgs) ? orgs[0] : orgs;
    orgType = org?.type ?? null;
  } catch {
    /* profile optional — owner check still works via userId */
  }

  try {
    const { data: memberships } = await supabase
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', user.id);
    for (const row of memberships || []) {
      if (row?.organization_id != null) membershipOrgIds.push(row.organization_id);
    }
  } catch {
    /* memberships table may be missing locally */
  }

  return {
    userId: user.id,
    email: user.email || null,
    orgId,
    role,
    orgType,
    membershipOrgIds,
  };
}
