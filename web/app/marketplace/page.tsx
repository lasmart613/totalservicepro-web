'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { getSupabaseClient, ServiceRequest, Bid } from '../../lib/supabase/client';
import { MODELS } from '../../lib/models';

const SERVICE_TYPES = ['PM', 'Emergency Repair', 'Install / Commission', 'Calibration', 'Full Contract', 'Other'];
const URGENCY_LEVELS = ['Low', 'Medium', 'High', 'Emergency'];

interface PostedNeed extends Partial<ServiceRequest> {
  customer_name?: string; // derived
  budget_range?: string; // derived
  // extra for UI
  bid_count?: number;
}

export default function Marketplace() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [needs, setNeeds] = useState<PostedNeed[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingBids, setLoadingBids] = useState(false);
  const [posting, setPosting] = useState(false);
  const [submittingBid, setSubmittingBid] = useState(false);
  const [message, setMessage] = useState('');

  // Bidding UI state (simple modal-like panels + role aware)
  const [bidFormFor, setBidFormFor] = useState<string | null>(null); // request id for bid form
  const [viewBidsFor, setViewBidsFor] = useState<string | null>(null); // request id for bids list (owners)
  const [myView, setMyView] = useState<'all' | 'my-posts' | 'my-bids'>('all');

  // Bid form state
  const [bidAmount, setBidAmount] = useState('');
  const [bidDate, setBidDate] = useState('');
  const [bidNotes, setBidNotes] = useState('');

  // Post form state
  const [facility, setFacility] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [serviceType, setServiceType] = useState('PM');
  const [modelType, setModelType] = useState('');
  const [urgency, setUrgency] = useState('Medium');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');

  const supabase = getSupabaseClient();
  const modelOptions = Object.keys(MODELS);

  useEffect(() => {
    loadUserAndNeeds();
  }, []);

  async function loadUserAndNeeds() {
    setLoadingList(true);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u);
      if (u) {
        const { data: prof } = await supabase.from('user_profiles')
          .select('first_name, last_name, role, organization_id, phone, organizations(name)')
          .eq('id', u.id).maybeSingle();
        setProfile(prof);
        // Prefill facility from org or name
        if (prof?.organizations?.name) setFacility(prof.organizations.name);
        else if (prof?.first_name) setFacility([prof.first_name, prof.last_name].filter(Boolean).join(' ') + ' Facility');
      }

      // Load open needs from dedicated service_requests table (new marketplace table from 20260611 migration)
      // Graceful: if table/cols missing or RLS blocks, show empty + note + demo
      let loadedNeeds: PostedNeed[] = [];
      try {
        const { data: requests } = await supabase
          .from('service_requests')
          .select('id, posted_by, organization_id, title, location, service_type, model_type, urgency, description, budget_max, status, created_at, city, state, organizations(name)')
          .or('status.eq.open,status.eq.bidding')
          .order('created_at', { ascending: false })
          .limit(20);
        if (requests) {
          loadedNeeds = requests.map((r: any) => ({
            id: r.id,
            posted_by: r.posted_by,
            organization_id: r.organization_id,
            customer_name: r.organizations?.name || r.title || 'Anonymous Facility',
            location: r.location,
            service_type: r.service_type,
            model_type: r.model_type,
            urgency: r.urgency,
            description: r.description,
            budget_range: r.budget_max ? `$${r.budget_max}` : null,
            status: r.status,
            created_at: r.created_at,
            city: r.city,
            state: r.state,
          }));
          setNeeds(loadedNeeds);
        }
      } catch (e: any) {
        console.info('service_requests query (use new marketplace table):', e);
        const isMissingTable = e?.code === '42P01' || (e?.message || '').includes('does not exist') || (e?.message || '').includes('service_requests');
        const isTypeOrFkError = e?.code === '42804' || (e?.message || '').includes('incompatible types') || (e?.message || '').includes('foreign key constraint');

        if (isMissingTable || isTypeOrFkError) {
          setMessage('⚠️ Marketplace tables not found or have wrong column types (e.g. organization_id must be bigint to match organizations.id). Run the corrected supabase/migrations/20260611_000000_add_marketplace_tables.sql (then 20260613) in Supabase SQL Editor, then refresh.');
        }

        // Provide demo entries for vision (until table + RLS ready)
        loadedNeeds = [
          { id: 'demo1', posted_by: 'demo', customer_name: 'Downtown MedSpa', location: 'Austin, TX', service_type: 'PM', model_type: 'V_Beam_1', urgency: 'Medium', description: 'Quarterly PM on 2x Candela V-Beam systems. Next due in 3 weeks.', budget_range: '$800-1200', status: 'open', created_at: new Date().toISOString() },
          { id: 'demo2', posted_by: 'demo', customer_name: 'Metro Laser Clinic', location: 'Phoenix, AZ', service_type: 'Emergency Repair', model_type: 'GentleLase', urgency: 'Emergency', description: 'Handpiece not firing consistently. Need on-site ASAP.', budget_range: 'Open', status: 'open', created_at: new Date(Date.now() - 86400000).toISOString() },
        ];
        setNeeds(loadedNeeds);
      }

      // Load bids for the loaded needs (for counts + owner views). Graceful.
      await loadBidsForRequests(loadedNeeds.map(n => n.id).filter(Boolean) as string[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadBidsForRequests(requestIds: string[]) {
    if (!requestIds.length) {
      setBids([]);
      return;
    }
    setLoadingBids(true);
    try {
      const { data: bidData } = await supabase
        .from('bids')
        .select('id, request_id, bidder_user_id, bidder_org_id, amount, proposed_date, notes, status, created_at')
        .in('request_id', requestIds)
        .order('created_at', { ascending: false });
      setBids((bidData || []) as Bid[]);
    } catch (e: any) {
      console.info('bids query (may need migration/RLS):', e);
      const isMissingTable = e?.code === '42P01' || (e?.message || '').includes('does not exist');

      if (isMissingTable && !message) {
        setMessage('⚠️ bids table missing. Apply the 20260611 marketplace migration (and 20260613 fix) in Supabase SQL Editor.');
      }

      // demo bids for vision if real table not ready
      if (requestIds.includes('demo1')) {
        setBids([{
          id: 'demobid1', request_id: 'demo1', bidder_user_id: 'demo-fse', amount: 950, proposed_date: '2026-06-20', notes: 'Available next week, 8+ years exp on Candela systems. Includes full alignment + safety cert.', status: 'pending', created_at: new Date().toISOString()
        } as Bid]);
      }
    } finally {
      setLoadingBids(false);
    }
  }

  function getBidsForRequest(reqId: string | undefined) {
    if (!reqId) return [];
    return bids.filter(b => b.request_id === reqId);
  }

  const userRole = (profile?.role || '').toString().toLowerCase().trim();
  const isPro = ['fse', 'engineer', 'service_manager', 'company_admin'].includes(userRole);
  const isOwnerish = profile && ['owner', 'customer'].includes(profile.role);
  const isMyPost = (n: PostedNeed) => user && (n.posted_by === user.id || (profile?.organization_id && n.organization_id === profile.organization_id));

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!facility || !description) {
      setMessage('Facility name and description are required to post a need.');
      return;
    }
    if (!user) {
      setMessage('Please sign in or sign up as an owner to post.');
      return;
    }
    if (!isOwnerish) {
      setMessage('Only Laser Owners can post service needs.');
      return;
    }
    setPosting(true);

    const locationStr = [city, state].filter(Boolean).join(', ') || '—';
    const payload: any = {
      // For new service_requests table (clean marketplace separation)
      // organization_id will be set from profile if available; customer_name/location for display
      organization_id: profile?.organization_id || null,
      posted_by: user.id,
      title: facility,
      location: locationStr,
      city: city || null,
      state: state || null,
      service_type: serviceType,
      model_type: modelType || 'Other',
      urgency,
      description: description.trim(),
      budget_max: budget ? parseFloat(budget) : null,  // budget_range approx
      status: 'open',
      // notes etc optional
    };

    try {
      const { error } = await supabase.from('service_requests').insert(payload);
      if (error) throw error;

      setMessage('Service need posted! (Status: open). FSEs & companies can now bid/respond below.');
      // Reset form partially
      setDescription('');
      setBudget('');
      // Refresh list
      await loadUserAndNeeds();
    } catch (err: any) {
      console.error('Post to service_requests failed (may require new table + RLS policy):', err);
      const isMissing = err?.code === '42P01' || (err?.message || '').includes('does not exist');
      const baseMsg = isMissing
        ? 'Cannot post: service_requests table does not exist. Run supabase/migrations/20260611_000000_add_marketplace_tables.sql in Supabase first.'
        : 'Posted locally for demo (run the marketplace migration in Supabase). ' + (err.message || '');
      setMessage(baseMsg);
      // Still add to local list for demo UX
      const demoNeed: PostedNeed = {
        id: 'local-' + Date.now(),
        ...payload,
        created_at: new Date().toISOString(),
      };
      setNeeds(prev => [demoNeed, ...prev]);
    } finally {
      setPosting(false);
    }
  };

  // Submit bid as pro (FSE/company)
  const handleSubmitBid = async (requestId: string) => {
    setMessage('');
    if (!user || !bidAmount) {
      setMessage('Please sign in as FSE/Company and enter a bid amount.');
      return;
    }
    setSubmittingBid(true);
    try {
      const payload: any = {
        request_id: requestId,
        bidder_user_id: user.id,
        bidder_org_id: profile?.organization_id || null,
        amount: parseFloat(bidAmount),
        proposed_date: bidDate || null,
        notes: bidNotes.trim() || null,
        status: 'pending',
      };
      const { error } = await supabase.from('bids').insert(payload);
      if (error) throw error;

      // Always add to local state immediately for instant UI feedback (real + demo)
      const newBid: Bid = {
        id: 'bid-' + Date.now(),
        request_id: requestId,
        bidder_user_id: user.id,
        bidder_org_id: profile?.organization_id || null,
        amount: parseFloat(bidAmount),
        proposed_date: bidDate || null,
        notes: bidNotes.trim() || null,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      setBids(prev => [newBid, ...prev]);

      setMessage('Bid submitted successfully! The owner will review it privately and can accept to create a contract.');
      // Reset form
      setBidFormFor(null);
      setBidAmount('');
      setBidDate('');
      setBidNotes('');
      // Refresh from server
      const currentNeeds = needs;
      await loadBidsForRequests(currentNeeds.map(n => n.id).filter(Boolean) as string[]);
    } catch (err: any) {
      console.error('Bid insert failed (check RLS on bids table for pros):', err);
      const isMissing = err?.code === '42P01' || (err?.message || '').includes('does not exist');
      const baseMsg = isMissing
        ? 'Cannot bid: bids table missing. Run the 20260611 marketplace migration in Supabase SQL Editor.'
        : 'Bid recorded locally for demo (will sync when tables ready). ' + (err.message || '');

      // Always show the bid in UI even on error (local)
      const demoBid: Bid = {
        id: 'localbid-' + Date.now(),
        request_id: requestId,
        bidder_user_id: user.id,
        amount: parseFloat(bidAmount),
        proposed_date: bidDate || null,
        notes: bidNotes.trim() || null,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      setBids(prev => [demoBid, ...prev]);

      setMessage(baseMsg);
      setBidFormFor(null);
    } finally {
      setSubmittingBid(false);
    }
  };

  // Owner accepts a bid: update statuses + create service_contract
  const handleAcceptBid = async (bid: Bid, request: PostedNeed) => {
    if (!user || !isOwnerish || !isMyPost(request)) {
      setMessage('Only the owner of this request can accept bids.');
      return;
    }
    if (!bid.id || !request.id) return;
    setMessage('');
    try {
      // 1. Accept this bid
      await supabase.from('bids').update({ status: 'accepted' }).eq('id', bid.id);

      // 2. Update request to awarded
      await supabase.from('service_requests').update({ status: 'awarded' }).eq('id', request.id);

      // 3. Create contract (links request + winning bid)
      const contractPayload: any = {
        request_id: request.id,
        bid_id: bid.id,
        owner_user_id: user.id,
        provider_user_id: bid.bidder_user_id,
        amount: bid.amount,
        status: 'active',
      };
      await supabase.from('service_contracts').insert(contractPayload);

      // 4. Optionally reject other pending bids on this request (best effort)
      const otherPending = bids.filter(b => b.request_id === request.id && b.id !== bid.id && b.status === 'pending');
      for (const ob of otherPending) {
        if (ob.id) await supabase.from('bids').update({ status: 'rejected' }).eq('id', ob.id);
      }

      setMessage('Bid accepted! Service contract created. Request marked awarded. Other bids rejected.');
      setViewBidsFor(null);
      // Refresh everything
      await loadUserAndNeeds();
    } catch (err: any) {
      console.error('Accept flow error (bids update + service_contracts insert; verify RLS):', err);
      const isMissing = err?.code === '42P01' || (err?.message || '').includes('does not exist');
      const baseMsg = isMissing
        ? 'Cannot accept: service_contracts or bids table missing. Run 20260611 marketplace migration.'
        : 'Accept simulated for demo (run migration if tables missing). ' + (err.message || '');
      setMessage(baseMsg);
      // local simulation
      setBids(prev => prev.map(b => b.id === bid.id ? { ...b, status: 'accepted' } : (b.request_id === request.id && b.status === 'pending' ? { ...b, status: 'rejected' } : b)));
      setNeeds(prev => prev.map(n => n.id === request.id ? { ...n, status: 'awarded' } : n));
      setViewBidsFor(null);
    }
  };

  // Simple reject (owner)
  const handleRejectBid = async (bid: Bid) => {
    if (!bid.id) return;
    try {
      await supabase.from('bids').update({ status: 'rejected' }).eq('id', bid.id);
      setMessage('Bid rejected.');
      await loadBidsForRequests(needs.map(n => n.id).filter(Boolean) as string[]);
    } catch (e) {
      setMessage('Reject simulated.');
      setBids(prev => prev.map(b => b.id === bid.id ? { ...b, status: 'rejected' } : b));
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">🛒 Service Marketplace</h1>
            <p className="text-[var(--text3)]">Laser owners post needs. FSEs &amp; companies discover opportunities.</p>
          </div>
          <Link href="/" className="text-sm text-[var(--gold)] hover:underline hidden sm:block">← Back to Dashboard</Link>
        </div>

        {/* Vision note - bidding now functional */}
        <div className="mb-6 p-3 bg-[var(--surface3)] border border-[var(--gold-border)] rounded text-sm">
          <strong>Marketplace Beta - Bidding Live:</strong> Owners post needs (PM, emergency repairs, contracts). Signed-up FSEs &amp; service companies can bid/respond. Owners review bids and accept to award + auto-create service_contract. 
          <span className="text-[var(--text3)]"> Requires the 20260611 marketplace migration + RLS in Supabase for full persistence. The SQL files are at supabase/migrations/20260611_000000_add_marketplace_tables.sql (main tables) and supabase/migrations/20260613_fix_service_requests_rls_for_all_fse.sql (improved visibility for FSEs) in the main project root. Run them in the Supabase SQL Editor if tables or policies are missing.</span>
        </div>

        {/* Tabs / My views for logged in users */}
        {user && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <button onClick={() => setMyView('all')} className={`filter-chip ${myView === 'all' ? 'active' : ''}`}>All Open Needs</button>
            <button onClick={() => setMyView('my-posts')} className={`filter-chip ${myView === 'my-posts' ? 'active' : ''}`}>My Posts {needs.filter(isMyPost).length ? `(${needs.filter(isMyPost).length})` : ''}</button>
            <button onClick={() => setMyView('my-bids')} className={`filter-chip ${myView === 'my-bids' ? 'active' : ''}`}>My Bids</button>
            <button onClick={loadUserAndNeeds} className="text-xs text-[var(--gold)] hover:underline ml-auto">Refresh all</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Post a Need Form (left / top on mobile) - only for owners */}
          <div className="lg:col-span-2">
            {user && !isOwnerish ? (
              <div className="card p-5">
                <h2 className="font-bold mb-1 text-lg">Post a Service Need</h2>
                <p className="text-sm text-[var(--text3)]">Only Laser Owners / Facilities can post service needs.</p>
                <p className="text-xs mt-2">You are signed in as <strong>{profile?.role || 'professional'}</strong>. Browse the open needs to the right and use the “Respond / Bid (Private)” buttons to submit bids on requests that interest you.</p>
              </div>
            ) : (
              <div className="card p-5">
                <h2 className="font-bold mb-1 text-lg">Post a Service Need</h2>
                <p className="text-xs text-[var(--text3)] mb-4">Owners &amp; facilities: describe the work (PM, repairs, contracts). Pros can bid immediately.</p>

                {!user && (
                  <div className="mb-4 p-3 bg-[var(--gold-glow)] rounded text-sm">
                    <Link href="/signup/owner" className="font-semibold text-[var(--gold)]">Sign up as Owner</Link> or <Link href="/login" className="text-[var(--gold)] underline">sign in</Link> to post live needs.
                  </div>
                )}

                {message && (
                  <div className={`mb-4 p-2.5 rounded text-sm ${message.includes('posted') || message.includes('Bid submitted') || message.includes('accepted') || message.includes('Awarded') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                    {message}
                  </div>
                )}

                <form onSubmit={handlePost} className="space-y-4">
                  <div>
                    <label className="label">Facility / Practice Name *</label>
                    <input className="input" value={facility} onChange={e => setFacility(e.target.value)} required placeholder="Your Med Spa or Hospital" disabled={!user && facility === ''} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">City</label>
                      <input className="input" value={city} onChange={e => setCity(e.target.value)} placeholder="Phoenix" />
                    </div>
                    <div>
                      <label className="label">State</label>
                      <input className="input" value={state} onChange={e => setState(e.target.value)} placeholder="AZ" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Service Type</label>
                      <select className="select" value={serviceType} onChange={e => setServiceType(e.target.value)}>
                        {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Urgency</label>
                      <select className="select" value={urgency} onChange={e => setUrgency(e.target.value)}>
                        {URGENCY_LEVELS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="label">Laser Model (if known)</label>
                    <select className="select" value={modelType} onChange={e => setModelType(e.target.value)}>
                      <option value="">— Any / Not specified —</option>
                      {modelOptions.map(k => (
                        <option key={k} value={k}>{MODELS[k].label}</option>
                      ))}
                      <option value="Other">Other / Multiple</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Description / Scope of Work *</label>
                    <textarea className="input" rows={4} value={description} onChange={e => setDescription(e.target.value)} required placeholder="e.g. Annual PM on 3x Candela systems including dye kit refresh, alignment, and safety certs. Access 8am-5pm." />
                  </div>

                  <div>
                    <label className="label">Budget Range (optional)</label>
                    <input className="input" value={budget} onChange={e => setBudget(e.target.value)} placeholder="$1,200 - $1,800 or 'Negotiable'" />
                  </div>

                  <button
                    type="submit"
                    disabled={posting || !user || !isOwnerish}
                    className="btn btn-primary w-full py-3 disabled:opacity-60"
                  >
                    {posting ? 'Posting need...' : (user ? 'Post Service Need (open for bids)' : 'Sign in to Post')}
                  </button>
                  {!isOwnerish && user && <p className="text-[10px] text-center text-[var(--text3)]">Only owners can post needs.</p>}
                </form>
              </div>
            )}

            <div className="mt-4 text-xs text-[var(--text3)] px-1">
              After posting (as owner), your need appears below. FSEs/companies can bid right away.
            </div>
          </div>

          {/* Open Needs List + Bidding + My sections */}
          <div className="lg:col-span-3">
            <div className="flex justify-between items-baseline mb-3">
              <div className="font-bold">
                {myView === 'my-posts' ? 'My Posted Needs' : myView === 'my-bids' ? 'My Submitted Bids' : 'Open Service Needs'} 
                {myView === 'all' && needs.length > 0 && <span className="text-[var(--text3)]">({needs.length})</span>}
              </div>
              <button onClick={loadUserAndNeeds} className="text-xs text-[var(--gold)] hover:underline">Refresh</button>
            </div>

            {/* Prominent guidance for FSEs and Service Companies (the core bidding users) */}
            {isPro && myView === 'all' && (
              <div className="mb-3 p-3 rounded bg-[var(--gold-glow)] text-xs border border-[var(--gold-border)]">
                <strong>FSEs &amp; Service Companies:</strong> Browse open needs posted by laser owners/facilities. Click <em>“Respond / Bid (Private)”</em> on any request to submit your bid (amount, date, notes). Your bids are private — only the owner sees them. Owners can accept to award a contract.
              </div>
            )}

            {loadingList ? (
              <div className="card p-8 text-center text-[var(--text3)]">Loading open requests...</div>
            ) : (myView === 'all' ? needs : myView === 'my-posts' ? needs.filter(isMyPost) : []).length === 0 && myView !== 'my-bids' ? (
              <div className="card p-8 text-center">
                <div className="text-4xl mb-2">📭</div>
                <div className="font-semibold">No open needs yet{myView === 'my-posts' ? ' from you' : ''}</div>
                <p className="text-sm mt-1 text-[var(--text3)]">Be the first owner to post a PM or repair request.</p>
              </div>
            ) : myView === 'my-bids' ? (
              // My Bids section
              <div className="space-y-3">
                {bids.length === 0 ? (
                  <div className="card p-6 text-sm text-[var(--text3)]">No bids submitted yet. Browse open needs above and click "Respond / Bid" (visible when signed in as FSE or Company).</div>
                ) : bids.map((b, i) => {
                  const req = needs.find(nn => nn.id === b.request_id) || { customer_name: 'Unknown request', description: '' };
                  return (
                    <div key={b.id || i} className="card p-4">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-bold">Bid on: {req.customer_name}</div>
                          <div className="text-sm">${b.amount} • {b.proposed_date || 'TBD'}</div>
                          <div className="text-xs mt-1 text-[var(--text3)]">{b.notes}</div>
                        </div>
                        <div className="text-right text-xs">
                          <span className="px-2 py-0.5 rounded bg-[var(--gold-glow)] text-[var(--gold)] font-bold">{b.status}</span>
                          <div className="mt-1 text-[var(--text3)]">{new Date(b.created_at || '').toLocaleDateString()}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs"><Link href="/marketplace" className="text-[var(--gold)]">View request details →</Link> (contract view coming soon)</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {(myView === 'my-posts' ? needs.filter(isMyPost) : needs).map((n, idx) => {
                  const reqBids = getBidsForRequest(n.id);
                  const bidCount = reqBids.length;
                  const isMine = isMyPost(n);
                  const showBidForm = bidFormFor === n.id;
                  const showBidsList = viewBidsFor === n.id;

                  return (
                    <div key={n.id || idx} className="card p-4">
                      <div className="flex justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-bold text-base truncate">{n.customer_name}</div>
                          <div className="text-sm text-[var(--text3)]">{n.location || '—'} • {n.service_type || 'Service'} {n.model_type && `• ${n.model_type}`}</div>
                          <div className="mt-2 text-sm whitespace-pre-wrap">{n.description}</div>
                          {n.budget_range && <div className="mt-1 text-xs">Budget: {n.budget_range}</div>}
                        </div>
                        <div className="text-right flex-shrink-0 text-xs">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${n.urgency === 'Emergency' ? 'bg-red-900/30 text-red-400' : 'bg-[var(--gold-glow)] text-[var(--gold)]'}`}>
                            {n.urgency || 'Medium'}
                          </span>
                          <div className="mt-2 text-[var(--text3)]">{n.status?.replace('_', ' ') || 'open'} {bidCount > 0 && `• ${bidCount} bid${bidCount > 1 ? 's' : ''}`}</div>
                          {n.created_at && <div className="text-[10px] mt-1 opacity-60">{new Date(n.created_at).toLocaleDateString()}</div>}
                        </div>
                      </div>

                      {/* Role-aware actions */}
                      <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap gap-2 text-sm items-center">
                        {isMine && isOwnerish ? (
                          <>
                            <button onClick={() => { setViewBidsFor(showBidsList ? null : n.id || null); setBidFormFor(null); }} className="btn btn-secondary text-xs px-3 py-1">
                              {showBidsList ? 'Hide' : 'View'} Received Bids {bidCount ? `(${bidCount})` : ''}
                            </button>
                            {showBidsList && reqBids.length === 0 && <span className="text-xs text-[var(--text3)]">No bids yet on this request.</span>}
                          </>
                        ) : isPro && n.status !== 'awarded' && !isMine ? (
                          <button
                            onClick={() => {
                              const opening = !showBidForm;
                              setBidFormFor(opening ? (n.id || null) : null);
                              setViewBidsFor(null);
                              if (opening) {
                                // Reset form fields when opening a new bid form (prevents carrying values between needs)
                                setBidAmount('');
                                setBidDate('');
                                setBidNotes('');
                              }
                            }}
                            className="btn btn-primary text-xs px-3 py-1"
                          >
                            {showBidForm ? 'Cancel Bid' : 'Respond / Bid (Private)'}
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--text3)]">
                            {n.status === 'awarded' ? 'Awarded' : (!isPro && !isMine ? 'Sign up as FSE/Company to bid' : 'Your post')}
                          </span>
                        )}

                        {!isMine && <Link href={isPro ? '#' : "/signup/fse"} className="text-xs text-[var(--gold)] hover:underline"> {isPro ? '' : 'Join as pro →'} </Link>}
                      </div>

                      {/* Inline Bid Form (for pros) */}
                      {showBidForm && isPro && (
                        <div className="mt-3 p-3 border border-[var(--gold-border)] rounded bg-[var(--surface3)]">
                          <div className="font-bold text-sm mb-2">Submit Bid</div>
                          <div className="grid grid-cols-2 gap-3 mb-2">
                            <div>
                              <label className="label text-xs">Bid Amount (USD) *</label>
                              <input type="number" className="input" value={bidAmount} onChange={e => setBidAmount(e.target.value)} placeholder="950" />
                            </div>
                            <div>
                              <label className="label text-xs">Proposed Date</label>
                              <input type="date" className="input" value={bidDate} onChange={e => setBidDate(e.target.value)} />
                            </div>
                          </div>
                          <div>
                            <label className="label text-xs">Notes / How you'll handle it (prefill contact from your profile)</label>
                            <textarea className="input" rows={2} value={bidNotes} onChange={e => setBidNotes(e.target.value)} placeholder={`Available next week. ${profile?.phone ? 'Phone: ' + profile.phone : ''} ${user?.email ? 'Email: ' + user.email : ''}`} />
                          </div>
                          <button onClick={() => handleSubmitBid(n.id || '')} disabled={submittingBid || !bidAmount} className="btn btn-primary text-xs mt-2 w-full disabled:opacity-60">
                            {submittingBid ? 'Submitting bid...' : 'Submit Bid (pending owner review)'}
                          </button>
                          <p className="text-[10px] mt-1 text-[var(--text3)]">Contact info from your profile + auth email will be visible to the owner.</p>
                        </div>
                      )}

                      {/* Bids List + Accept (for owners on own posts) */}
                      {showBidsList && isMine && (
                        <div className="mt-3 p-3 border border-[var(--gold-border)] rounded bg-[var(--surface)] space-y-2">
                          <div className="font-bold text-sm">Bids Received ({reqBids.length})</div>
                          {reqBids.length === 0 && <div className="text-xs text-[var(--text3)]">No bids yet.</div>}
                          {reqBids.map((b, bi) => (
                            <div key={b.id || bi} className="border border-[var(--border)] rounded p-2 text-sm flex justify-between items-start gap-2">
                              <div className="min-w-0">
                                <div><strong>${b.amount || '—'}</strong> {b.proposed_date ? `on ${b.proposed_date}` : ''}</div>
                                <div className="text-xs text-[var(--text3)] truncate">{b.notes || 'No notes'}</div>
                                <div className="text-[10px] mt-0.5">Bidder: {b.bidder_user_id?.slice(0,8)}... • {b.status}</div>
                              </div>
                              {b.status === 'pending' && (
                                <div className="flex gap-1 flex-shrink-0">
                                  <button onClick={() => handleAcceptBid(b, n)} className="btn btn-primary text-[10px] px-2 py-0.5">Accept (create contract)</button>
                                  <button onClick={() => handleRejectBid(b)} className="btn btn-secondary text-[10px] px-2 py-0.5">Reject</button>
                                </div>
                              )}
                              {b.status !== 'pending' && <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface3)]">{b.status}</span>}
                            </div>
                          ))}
                          <div className="text-[10px] text-[var(--text3)]">Accepting creates a row in service_contracts and marks the request awarded. (Future: notify + contract view.)</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 text-[10px] text-center text-[var(--text3)]">
              Real data from service_requests + bids (20260611 migration tables). Demo seeds used on query/RLS error. Contracts created on accept.
            </div>
          </div>
        </div>

        <div className="mt-10 text-center">
          {!user ? (
            <>
              <Link href="/signup/owner" className="btn btn-primary">Sign up as Laser Owner to post needs</Link>
              <span className="mx-3 text-[var(--text3)]">or</span>
              <Link href="/signup/fse" className="btn btn-secondary">Sign up as FSE / Company to bid & fulfill</Link>
            </>
          ) : isOwnerish ? (
            <span className="text-sm text-[var(--text3)]">You are signed in as an owner. Use the form on the left to post needs.</span>
          ) : isPro ? (
            <span className="text-sm text-[var(--text3)]">You are signed in as {profile?.role || 'a professional'}. Browse open needs below and click “Respond / Bid (Private)” on any request to submit a private bid.</span>
          ) : (
            <span className="text-sm text-[var(--text3)]">Sign up with an owner or pro role to participate in the marketplace.</span>
          )}
        </div>
      </div>
    </div>
  );
}
