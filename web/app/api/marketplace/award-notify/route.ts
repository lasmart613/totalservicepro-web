import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

/**
 * POST /api/marketplace/award-notify  { requestId, bidId }
 * The poster already accepted the bid in the client. This writes the
 * winner and poster notifications with the service role. Clients cannot
 * insert notifications for another user.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    if (!hasServiceRole()) {
      return NextResponse.json({ ok: false, error: 'Notifications are unavailable.' }, { status: 503 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      requestId?: string | number;
      bidId?: string | number;
    };
    const requestId = body.requestId;
    const bidId = body.bidId;
    if (requestId == null || bidId == null || requestId === '' || bidId === '') {
      return NextResponse.json({ error: 'requestId and bidId are required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: bid, error: bidErr } = await admin
      .from('bids')
      .select('id, request_id, bidder_id, bidder_user_id, status')
      .eq('id', bidId)
      .maybeSingle();
    if (bidErr || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }
    if (String(bid.request_id) !== String(requestId)) {
      return NextResponse.json({ error: 'Bid is not on that request' }, { status: 403 });
    }

    const { data: request, error: reqErr } = await admin
      .from('service_requests')
      .select('id, title, created_by, posted_by, status')
      .eq('id', requestId)
      .maybeSingle();
    if (reqErr || !request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    const caller = user.id;
    const owners = [request.created_by, request.posted_by].filter(Boolean).map(String);
    if (!owners.includes(caller)) {
      return NextResponse.json({ error: 'Only the request owner can notify on an award' }, { status: 403 });
    }

    const bidStatus = String(bid.status || '').toLowerCase();
    const requestStatus = String(request.status || '').toLowerCase();
    if (bidStatus !== 'accepted' && requestStatus !== 'awarded') {
      return NextResponse.json({ error: 'Accept the bid before notifying' }, { status: 409 });
    }

    const title = request.title || 'Service request';
    const winnerId = bid.bidder_id || bid.bidder_user_id || null;
    const posterId = request.posted_by || request.created_by || null;
    const link = `/accepted-bids?id=${encodeURIComponent(String(requestId))}`;
    const rows: Record<string, unknown>[] = [];
    if (winnerId) {
      rows.push({
        user_id: winnerId,
        type: 'bid_accepted',
        message: `Your bid was accepted on "${title}". Customer contact details are now available.`,
        triggered_by: caller,
        is_read: false,
        link,
        data: { request_id: requestId, bid_id: bidId, event: 'bid_accepted' },
      });
    }
    if (posterId && String(posterId) !== caller) {
      rows.push({
        user_id: posterId,
        type: 'bid_awarded',
        message: `You awarded a bid on "${title}".`,
        triggered_by: caller,
        is_read: false,
        link,
        data: { request_id: requestId, bid_id: bidId, event: 'bid_awarded' },
      });
    }

    for (const row of rows) {
      const { error } = await admin.from('notifications').insert(row);
      if (error) {
        console.warn('award notify', error.message);
      }
    }

    return NextResponse.json({ ok: true, notified: rows.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not send award notifications';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
