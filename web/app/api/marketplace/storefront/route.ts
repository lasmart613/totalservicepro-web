import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import {
  canEnableSupplierStorefront,
  isPublicStorefront,
  isValidStorefrontSlug,
  namedPlanForCopy,
  storefrontAbout,
  storefrontDisplayName,
  storefrontPath,
  supplierGetsFeaturedPlacement,
} from '@/lib/marketplace/storefront';
import {
  loadSellerOrg,
  normalizeStorefrontWrite,
  requireStorefrontSeller,
  resolveStorefrontSlug,
} from '@/lib/marketplace/storefront-server';

export const dynamic = 'force-dynamic';

function payload(org: NonNullable<Awaited<ReturnType<typeof loadSellerOrg>>>, eligible: boolean) {
  const slug = org.storefront_slug && isValidStorefrontSlug(org.storefront_slug) ? org.storefront_slug : null;
  return {
    eligible,
    enabled: !!org.storefront_enabled,
    public: isPublicStorefront(org),
    featured: supplierGetsFeaturedPlacement(org.type, org),
    plan: namedPlanForCopy(org),
    name: storefrontDisplayName(org),
    slug,
    bio: storefrontAbout(org),
    logo_url: org.logo_url || null,
    href: slug ? storefrontPath(slug) : null,
    website: org.website || null,
    upgrade: '/plans?role=supplier',
  };
}

export async function GET(req: NextRequest) {
  try {
    const caller = await getMarketplaceCaller(req);
    if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    if (caller.orgId == null) {
      return NextResponse.json({ error: 'Your profile is not linked to an organization yet.' }, { status: 403 });
    }
    const org = await loadSellerOrg(caller.orgId);
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    const eligible = canEnableSupplierStorefront(caller.role, org.type, org);
    return NextResponse.json({ ...payload(org, eligible), orgType: org.type, organizationId: org.id ?? caller.orgId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireStorefrontSeller(req);
    if (!gate.ok) return gate.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = normalizeStorefrontWrite({
      enabled: body.enabled ?? body.storefront_enabled,
      slug: body.slug ?? body.storefront_slug,
      bio: body.bio ?? body.storefront_bio,
      name: body.name,
    });
    if (fields.storefront_enabled && !fields.storefront_slug && !gate.org.storefront_slug) {
      fields.storefront_slug = await resolveStorefrontSlug(null, fields.name || gate.org.name, gate.orgId);
    } else if (fields.storefront_slug) {
      if (!isValidStorefrontSlug(fields.storefront_slug)) {
        return NextResponse.json(
          { error: 'Use a short lowercase slug with letters, numbers, and hyphens.' },
          { status: 400 }
        );
      }
      fields.storefront_slug = await resolveStorefrontSlug(fields.storefront_slug, gate.org.name, gate.orgId);
    }
    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Storefront save unavailable' }, { status: 503 });
    }
    const admin = getSupabaseAdmin();
    const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    let saved = gate.org;
    const { data, error } = await admin.from('organizations').update(update).eq('id', gate.orgId).select('*').maybeSingle();
    if (error) {
      if (/storefront_|column|does not exist/i.test(error.message || '')) {
        return NextResponse.json(
          {
            error:
              'Storefront columns are not on organizations yet. Apply web/supabase/migrations/20260914_000004_parts_seller_storefronts.sql in the Supabase SQL editor.',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (data) {
      saved = { ...gate.org, ...(data as typeof gate.org) };
    }
    return NextResponse.json({
      ok: true,
      ...payload(saved, true),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
