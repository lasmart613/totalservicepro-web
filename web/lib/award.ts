import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Accept a bid on a service_request: award job, reject other bids,
 * snapshot contacts, notify winner (and optionally owner confirmation).
 */
export async function acceptServiceBid(
  supabase: SupabaseClient,
  opts: {
    requestId: string;
    bidId: string;
    actorUserId: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { requestId, bidId, actorUserId } = opts;

  // Load bid + request
  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select('*')
    .eq('id', bidId)
    .maybeSingle();
  if (bidErr || !bid) return { ok: false, error: bidErr?.message || 'Bid not found' };

  const { data: req, error: reqErr } = await supabase
    .from('service_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (reqErr || !req) return { ok: false, error: reqErr?.message || 'Request not found' };

  // Accept + reject others
  const { error: accErr } = await supabase.from('bids').update({ status: 'accepted' }).eq('id', bidId);
  if (accErr) return { ok: false, error: accErr.message };

  await supabase
    .from('bids')
    .update({ status: 'rejected' })
    .eq('request_id', requestId)
    .neq('id', bidId)
    .eq('status', 'pending');

  // Facility contact snapshot (revealed to winning service co)
  let facility_contact: Record<string, unknown> = {
    organization_id: req.organization_id,
    city: req.city || null,
    state: req.state || null,
    location: req.location || null,
  };
  if (req.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, address, city, state, zip, phone, alt_phone, email, contact_name, website')
      .eq('id', req.organization_id)
      .maybeSingle();
    if (org) {
      facility_contact = {
        ...facility_contact,
        name: org.name,
        address: org.address,
        city: org.city || req.city,
        state: org.state || req.state,
        zip: org.zip,
        phone: org.phone || org.alt_phone,
        email: org.email,
        contact_name: org.contact_name,
        website: org.website,
      };
    }
  }
  // Poster profile as secondary contact
  const posterId = req.posted_by || req.created_by;
  if (posterId) {
    const { data: poster } = await supabase
      .from('user_profiles')
      .select('first_name, last_name, phone, email')
      .eq('id', posterId)
      .maybeSingle();
    if (poster) {
      facility_contact.contact_person = [poster.first_name, poster.last_name].filter(Boolean).join(' ');
      if (poster.phone) facility_contact.contact_phone = poster.phone;
      if (poster.email) facility_contact.contact_email = poster.email;
    }
  }

  // Provider (winning bidder) contact for facility
  let provider_contact: Record<string, unknown> = {
    user_id: bid.bidder_id || bid.bidder_user_id,
    organization_id: bid.bidder_org_id || null,
  };
  const winnerId = bid.bidder_id || bid.bidder_user_id;
  if (winnerId) {
    const { data: winner } = await supabase
      .from('user_profiles')
      .select('first_name, last_name, phone, email, organization_id, organizations(name, phone, email, address, city, state, zip, contact_name)')
      .eq('id', winnerId)
      .maybeSingle();
    if (winner) {
      provider_contact = {
        ...provider_contact,
        contact_person: [winner.first_name, winner.last_name].filter(Boolean).join(' '),
        phone: winner.phone,
        email: winner.email,
        organization_id: winner.organization_id || bid.bidder_org_id,
      };
      const worg = (winner as any).organizations;
      if (worg) {
        provider_contact.company_name = worg.name;
        provider_contact.company_phone = worg.phone;
        provider_contact.company_email = worg.email;
        provider_contact.address = worg.address;
        provider_contact.city = worg.city;
        provider_contact.state = worg.state;
        provider_contact.zip = worg.zip;
        provider_contact.contact_name = worg.contact_name;
      }
    }
  }

  const { error: awErr } = await supabase
    .from('service_requests')
    .update({
      status: 'awarded',
      awarded_bid_id: bidId,
      awarded_at: new Date().toISOString(),
      facility_contact,
      provider_contact,
    })
    .eq('id', requestId);
  if (awErr) {
    // Still ok if columns missing — try minimal award
    await supabase.from('service_requests').update({ status: 'awarded' }).eq('id', requestId);
  }

  // Best-effort contract row
  try {
    await supabase.from('service_contracts').insert({
      request_id: requestId,
      bid_id: bidId,
      owner_user_id: posterId || actorUserId,
      provider_user_id: winnerId,
      amount: bid.price ?? bid.amount ?? null,
      status: 'active',
    });
  } catch {
    /* optional table */
  }

  // Notify winning bidder
  if (winnerId) {
    const title = req.title || 'Service request';
    try {
      await supabase.from('notifications').insert({
        user_id: winnerId,
        type: 'bid_accepted',
        message: `Your bid was accepted on "${title}". Customer contact details are now available.`,
        triggered_by: actorUserId,
        is_read: false,
        // Winners land on Accepted Bids (contacts). RFQ detail share URL is 403 once awarded.
        link: `/accepted-bids?id=${encodeURIComponent(requestId)}`,
        data: {
          request_id: requestId,
          bid_id: bidId,
          event: 'bid_accepted',
        },
      });
    } catch {
      /* ignore */
    }
  }

  // Confirm to owner
  if (posterId && posterId !== actorUserId) {
    try {
      await supabase.from('notifications').insert({
        user_id: posterId,
        type: 'bid_awarded',
        message: `You awarded a bid on "${req.title || 'Service request'}".`,
        triggered_by: actorUserId,
        is_read: false,
        link: `/accepted-bids?id=${encodeURIComponent(requestId)}`,
        data: { request_id: requestId, bid_id: bidId, event: 'bid_awarded' },
      });
    } catch {
      /* ignore */
    }
  }

  return { ok: true };
}
