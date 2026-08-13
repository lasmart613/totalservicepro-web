import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Public share endpoint for RFQs.
 * Returns safe fields for open/bidding requests so logged-out invitees can preview
 * and get a signup CTA. Bids and private contacts are never included.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const raw = await Promise.resolve(ctx.params);
    const id = raw?.id;
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    if (!hasServiceRole()) {
      return NextResponse.json(
        {
          error: 'Share preview unavailable',
          hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Netlify, or run public SELECT policies on service_requests.',
        },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('service_requests')
      .select(
        'id, title, description, status, urgency, manufacturer, model, serial_number, service_type, preferred_date, error_codes, city, state, location, category, created_at, organization_id, budget_max'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[share/request]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const st = String(data.status || 'open').toLowerCase();
    if (!['open', 'bidding'].includes(st)) {
      // Don't leak closed/awarded private jobs via share
      return NextResponse.json(
        {
          error: 'This request is no longer open for bidding',
          status: data.status,
          closed: true,
        },
        { status: 403 }
      );
    }

    let orgName: string | null = null;
    if (data.organization_id != null) {
      try {
        const { data: org } = await admin
          .from('organizations')
          .select('name, city, state')
          .eq('id', data.organization_id)
          .maybeSingle();
        if (org) {
          orgName = org.name || null;
          if (!data.city && org.city) (data as any).city = org.city;
          if (!data.state && org.state) (data as any).state = org.state;
        }
      } catch {
        /* ignore */
      }
    }

    // Strip anything that shouldn't be public
    const publicRow = {
      id: data.id,
      title: data.title,
      description: data.description,
      status: data.status,
      urgency: data.urgency,
      manufacturer: data.manufacturer,
      model: data.model,
      serial_number: data.serial_number,
      service_type: data.service_type,
      preferred_date: data.preferred_date,
      error_codes: data.error_codes,
      city: data.city,
      state: data.state,
      location: data.location,
      category: data.category,
      created_at: data.created_at,
      budget_max: data.budget_max,
      organization_name: orgName,
      // Never expose posted_by, contacts, awarded_bid, etc.
      _public_share: true,
    };

    return NextResponse.json({ request: publicRow });
  } catch (e: any) {
    console.error('[share/request]', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
