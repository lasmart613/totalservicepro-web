import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Public share endpoint for marketplace listings (equipment / parts / consumables).
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
          hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Netlify, or run public SELECT policies on marketplace_listings.',
        },
        { status: 503 }
      );
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('marketplace_listings')
      .select(
        'id, title, description, status, condition, price, price_type, manufacturer, model, serial_number, part_number, quantity, listing_type, category, city, state, images, photos, details, created_at, year_manufactured, wavelength'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[share/listing]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const st = String(data.status || 'active').toLowerCase();
    if (!['active', 'open', 'published'].includes(st)) {
      return NextResponse.json(
        { error: 'This listing is no longer available', status: data.status, closed: true },
        { status: 403 }
      );
    }

    // Sanitize details — drop seller contact if present
    let details = data.details;
    if (details && typeof details === 'object') {
      const d = { ...(details as any) };
      delete d.seller_email;
      delete d.seller_phone;
      delete d.contact_email;
      delete d.contact_phone;
      details = d;
    }

    return NextResponse.json({
      listing: {
        ...data,
        details,
        seller_id: undefined,
        created_by: undefined,
        organization_id: undefined,
        _public_share: true,
      },
    });
  } catch (e: any) {
    console.error('[share/listing]', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
