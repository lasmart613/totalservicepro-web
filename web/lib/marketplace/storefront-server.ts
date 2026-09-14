/**
 * Server helpers for optional parts-seller storefronts.
 * Do not import from client components.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadOrgPlanRow } from '../org-plan-load.ts';
import { getSupabaseAdmin, hasServiceRole } from '../supabase/admin.ts';
import { getMarketplaceCaller, type MarketplaceCaller } from './caller.ts';
import {
  canBulkUploadSupplierInventory,
  canEnableSupplierStorefront,
  canManageSupplierStorefront,
  clipStorefrontBio,
  isPublicStorefront,
  isValidStorefrontSlug,
  slugifyStorefront,
  toPublicSellerCard,
  uniqueStorefrontSlug,
  type SellerStorefrontFields,
} from './storefront.ts';

export const STOREFRONT_ORG_SELECTS = [
  'id, name, type, logo_url, website, email, phone, city, state, notes, is_premium, subscription_tier, plan, premium_until, premium_grant, storefront_enabled, storefront_slug, storefront_bio',
  'id, name, type, logo_url, website, email, phone, city, state, notes, is_premium, subscription_tier, plan, premium_until, storefront_enabled, storefront_slug, storefront_bio',
  'id, name, type, logo_url, website, email, phone, city, state, notes, is_premium, subscription_tier, plan, storefront_enabled, storefront_slug, storefront_bio',
  'id, name, type, logo_url, website, email, phone, city, state, notes, is_premium, storefront_enabled, storefront_slug, storefront_bio',
  'id, name, type, logo_url, website, email, phone, city, state, notes, is_premium',
] as const;

function missingColumn(message?: string): boolean {
  return /storefront_|subscription_tier|premium_until|premium_grant|\bplan\b|column|does not exist|schema cache/i.test(
    message || ''
  );
}

export async function loadSellerOrg(orgId: string | number): Promise<SellerStorefrontFields | null> {
  if (!hasServiceRole()) return null;
  const admin = getSupabaseAdmin();
  for (const columns of STOREFRONT_ORG_SELECTS) {
    const { data, error } = await admin.from('organizations').select(columns).eq('id', orgId).maybeSingle();
    if (!error) {
      const plan = await loadOrgPlanRow(admin, orgId);
      return { ...(data as SellerStorefrontFields), ...(plan || {}) };
    }
    if (!missingColumn(error.message)) break;
  }
  return null;
}

export async function loadPublicStorefrontBySlug(slug: string): Promise<SellerStorefrontFields | null> {
  if (!hasServiceRole()) return null;
  const admin = getSupabaseAdmin();
  const normalized = String(slug || '')
    .trim()
    .toLowerCase();
  if (!isValidStorefrontSlug(normalized)) return null;
  for (const columns of STOREFRONT_ORG_SELECTS) {
    const { data, error } = await admin
      .from('organizations')
      .select(columns)
      .eq('storefront_slug', normalized)
      .eq('storefront_enabled', true)
      .maybeSingle();
    if (!error) return (data as SellerStorefrontFields) || null;
    if (!missingColumn(error.message)) break;
  }
  return null;
}

export async function loadEnabledStorefronts(): Promise<SellerStorefrontFields[]> {
  if (!hasServiceRole()) return [];
  const admin = getSupabaseAdmin();
  for (const columns of STOREFRONT_ORG_SELECTS) {
    const { data, error } = await admin
      .from('organizations')
      .select(columns)
      .eq('storefront_enabled', true)
      .order('name');
    if (!error) return (data || []) as SellerStorefrontFields[];
    if (!missingColumn(error.message)) break;
  }
  return [];
}

export async function resolveStorefrontSlug(
  desired: string | null | undefined,
  name: string | null | undefined,
  orgId: string | number
): Promise<string> {
  const wanted = isValidStorefrontSlug(desired) ? String(desired).trim().toLowerCase() : uniqueStorefrontSlug(name, orgId);
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('organizations')
    .select('id, storefront_slug')
    .eq('storefront_slug', wanted)
    .maybeSingle();
  if (!data || String(data.id) === String(orgId)) return wanted;
  const fallback = `${slugifyStorefront(wanted).slice(0, 40)}-${orgId}`.toLowerCase();
  return isValidStorefrontSlug(fallback) ? fallback : `seller-${orgId}`;
}

export async function requireStorefrontSeller(
  req: NextRequest,
  opts: { bulk?: boolean } = {}
): Promise<
  | { ok: true; caller: MarketplaceCaller; org: SellerStorefrontFields; orgId: string | number }
  | { ok: false; response: NextResponse }
> {
  const caller = await getMarketplaceCaller(req);
  if (!caller) {
    return { ok: false, response: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  }
  if (!hasServiceRole()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Storefront unavailable. Add SUPABASE_SERVICE_ROLE_KEY on Netlify.' },
        { status: 503 }
      ),
    };
  }
  if (caller.orgId == null) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Your profile is not linked to an organization yet.' }, { status: 403 }),
    };
  }
  const org = await loadSellerOrg(caller.orgId);
  if (!org) {
    return { ok: false, response: NextResponse.json({ error: 'Organization not found' }, { status: 404 }) };
  }
  if (!canManageSupplierStorefront(caller, org.type)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Only parts-supplier team members can manage a storefront.' }, { status: 403 }),
    };
  }
  const eligible = opts.bulk
    ? canBulkUploadSupplierInventory(caller.role, org.type, org)
    : canEnableSupplierStorefront(caller.role, org.type, org);
  if (!eligible) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: opts.bulk
            ? 'Bulk inventory upload is for Premium and Team parts suppliers.'
            : 'Supplier storefronts are a Premium / Team option. Upgrade on /plans?role=supplier.',
          upgrade: '/plans?role=supplier',
        },
        { status: 403 }
      ),
    };
  }
  return { ok: true, caller, org, orgId: caller.orgId };
}

export async function resolveListingStorefront(organizationId?: string | number | null) {
  if (organizationId == null) return null;
  const org = await loadSellerOrg(organizationId);
  if (!org || !isPublicStorefront(org)) return null;
  const card = toPublicSellerCard(org);
  if (!card) return null;
  return { name: card.name, slug: card.slug, href: card.href, featured: card.featured };
}

export function normalizeStorefrontWrite(input: {
  enabled?: unknown;
  slug?: unknown;
  bio?: unknown;
  name?: unknown;
}): { storefront_enabled?: boolean; storefront_slug?: string | null; storefront_bio?: string | null; name?: string } {
  const out: {
    storefront_enabled?: boolean;
    storefront_slug?: string | null;
    storefront_bio?: string | null;
    name?: string;
  } = {};
  if (typeof input.enabled === 'boolean') out.storefront_enabled = input.enabled;
  if (input.slug !== undefined) {
    const slug = String(input.slug || '')
      .trim()
      .toLowerCase();
    out.storefront_slug = slug ? slugifyStorefront(slug) : null;
  }
  if (input.bio !== undefined) out.storefront_bio = clipStorefrontBio(input.bio) || null;
  if (input.name !== undefined) {
    const name = String(input.name || '').trim();
    if (name) out.name = name.slice(0, 120);
  }
  return out;
}
