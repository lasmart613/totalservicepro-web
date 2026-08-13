'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  canAcceptBids,
  canBidMarketplace,
  isPro,
  isServiceCompany,
} from '@/lib/roles';
import { acceptServiceBid } from '@/lib/award';
import { ShareButton } from '@/components/ShareButton';
import { serviceRequestShareText } from '@/lib/share';

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function parseAmt(s: string): number {
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export default function ServiceRequestDetail() {
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<any>(null);
  const [orgLoc, setOrgLoc] = useState<{ city?: string; state?: string; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBidForm, setShowBidForm] = useState(false);
  const [labor, setLabor] = useState('');
  const [parts, setParts] = useState('');
  const [travel, setTravel] = useState('');
  const [perDiem, setPerDiem] = useState('');
  const [otherAmt, setOtherAmt] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [submittingBid, setSubmittingBid] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<any>(null);
  const [bids, setBids] = useState<any[]>([]);

  const supabase = getSupabaseClient();

  const total = useMemo(() => {
    return parseAmt(labor) + parseAmt(parts) + parseAmt(travel) + parseAmt(perDiem) + parseAmt(otherAmt);
  }, [labor, parts, travel, perDiem, otherAmt]);

  useEffect(() => {
    if (id) fetchRequest();
  }, [id]);

  const fetchRequest = async () => {
    setLoading(true);
    setRequest(null);
    setBids([]);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('role, organization_id, organizations(type)')
        .eq('id', user.id)
        .maybeSingle();
      setUserRole(prof?.role || '');
      setOrgId(prof?.organization_id || null);
      setOrgType((prof?.organizations as any)?.type || null);
    } else {
      setUserId(null);
    }

    // Load strategy:
    // - Guests: public share API first (bypasses RLS via service role on server)
    // - Signed-in: client Supabase first, then share API fallback
    let reqData: any = null;

    async function loadViaShareApi(): Promise<'ok' | 'closed' | 'miss'> {
      try {
        const res = await fetch(`/api/share/request/${encodeURIComponent(id)}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const json = await res.json().catch(() => ({} as any));
        if (res.ok && json?.request) {
          reqData = json.request;
          if (json.request.organization_name) {
            setOrgLoc({
              name: json.request.organization_name,
              city: json.request.city,
              state: json.request.state,
            });
          }
          return 'ok';
        }
        if (res.status === 403 && json?.closed) {
          // Awarded RFQs are not public — send parties to Accepted Bids (never a 404)
          if (typeof window !== 'undefined') {
            window.location.replace(`/accepted-bids?id=${encodeURIComponent(id)}`);
          }
          return 'closed';
        }
        console.warn('[RFQ share] API miss', res.status, json);
        return 'miss';
      } catch (e) {
        console.warn('[RFQ share] API failed', e);
        return 'miss';
      }
    }

    if (!user) {
      const shareResult = await loadViaShareApi();
      if (shareResult === 'closed') {
        setLoading(false);
        return;
      }
    } else {
      const { data: direct, error: directErr } = await supabase
        .from('service_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!directErr && direct) {
        reqData = direct;
      } else {
        const shareResult = await loadViaShareApi();
        if (shareResult === 'closed') {
          setLoading(false);
          return;
        }
      }
    }

    if (!reqData) {
      // Guests: no red toast — friendly empty state below. Signed-in: show error.
      if (user) toast.error('Request not found');
      setLoading(false);
      return;
    }

    setRequest(reqData);

    // Prefer city/state on request; fallback to posting org profile (auth only)
    if (user && reqData.organization_id && !(reqData.city || reqData.state || reqData.location)) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, city, state')
        .eq('id', reqData.organization_id)
        .maybeSingle();
      if (org) setOrgLoc(org);
    } else if (user && reqData.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, city, state')
        .eq('id', reqData.organization_id)
        .maybeSingle();
      if (org) setOrgLoc(org);
    }

    // Bids only for signed-in users (RLS)
    if (user) {
      try {
        const { data: bidRows } = await supabase
          .from('bids')
          .select(
            'id, price, amount, labor_amount, parts_amount, travel_amount, per_diem_amount, other_amount, notes, question, status, bidder_id, bidder_user_id, proposed_date, created_at'
          )
          .eq('request_id', id)
          .order('created_at', { ascending: false });
        setBids(bidRows || []);
      } catch {
        setBids([]);
      }
    }

    setLoading(false);
  };

  const isMinePost =
    !!userId &&
    (request?.created_by === userId ||
      request?.posted_by === userId ||
      (orgId != null &&
        request?.organization_id != null &&
        String(request.organization_id) === String(orgId)));

  const canBid =
    (canBidMarketplace(userRole) ||
      isPro(userRole) ||
      isServiceCompany(userRole, orgType)) &&
    !isMinePost;
  const canAccept = canAcceptBids(userRole) && isMinePost;

  const regionLabel = (() => {
    if (!request) return '';
    const fromReq = [request.city, request.state].filter(Boolean).join(', ');
    if (fromReq) return fromReq;
    if (request.location) return request.location;
    if (orgLoc) return [orgLoc.city, orgLoc.state].filter(Boolean).join(', ');
    return '';
  })();

  const handleSubmitBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (total <= 0) {
      toast.error('Enter at least one amount (labor, parts, travel, etc.)');
      return;
    }
    if (!canBid) {
      toast.error('Only service professionals can bid on requests.');
      return;
    }

    setSubmittingBid(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('You must be logged in to bid');
        return;
      }

      const laborN = parseAmt(labor);
      const partsN = parseAmt(parts);
      const travelN = parseAmt(travel);
      const perDiemN = parseAmt(perDiem);
      const otherN = parseAmt(otherAmt);

      const payload: any = {
        request_id: id,
        bidder_id: user.id,
        bidder_user_id: user.id,
        bidder_org_id: orgId,
        price: total,
        amount: total,
        labor_amount: laborN || null,
        parts_amount: partsN || null,
        travel_amount: travelN || null,
        per_diem_amount: perDiemN || null,
        other_amount: otherN || null,
        currency: 'USD',
        notes: bidNotes || null,
        question: bidQuestion || null,
        proposed_date: proposedDate || null,
        status: 'pending',
      };

      let { error } = await supabase.from('bids').insert(payload);
      if (error) {
        // Fallback without new columns
        const slim = {
          request_id: id,
          bidder_id: user.id,
          price: total,
          notes: bidNotes || null,
          question: bidQuestion || null,
          status: 'pending',
        };
        const r2 = await supabase.from('bids').insert(slim);
        if (r2.error) throw r2.error;
      }

      toast.success('Bid submitted! View or edit it anytime under My Bids.', {
        action: {
          label: 'My Bids',
          onClick: () => {
            window.location.href = '/bids';
          },
        },
      });
      setShowBidForm(false);
      setLabor('');
      setParts('');
      setTravel('');
      setPerDiem('');
      setOtherAmt('');
      setBidNotes('');
      setBidQuestion('');
      setProposedDate('');
      await fetchRequest();
    } catch (err: any) {
      toast.error('Failed to submit bid: ' + err.message);
    } finally {
      setSubmittingBid(false);
    }
  };

  const handleAcceptBid = async (bidId: string) => {
    if (!canAccept) {
      toast.error('Only the post owner can accept bids.');
      return;
    }
    if (!userId) {
      toast.error('You must be logged in');
      return;
    }
    if (!confirm('Accept this bid? Other bids will be declined and contact info will be shared with the winner.')) {
      return;
    }
    try {
      const result = await acceptServiceBid(supabase, {
        requestId: id,
        bidId,
        actorUserId: userId,
      });
      if (!result.ok) throw new Error(result.error);
      toast.success('Bid accepted — winner notified and contacts shared.');
      await fetchRequest();
    } catch (e: any) {
      toast.error(e.message || 'Failed to accept bid');
    }
  };

  const isAwarded = (request?.status || '').toLowerCase() === 'awarded';
  const myWinningBid =
    !!userId &&
    bids.some(
      (b) =>
        (b.status || '').toLowerCase() === 'accepted' &&
        (b.bidder_id === userId || b.bidder_user_id === userId)
    );
  const showFacilityContact =
    isAwarded &&
    (myWinningBid ||
      (userId &&
        (request?.awarded_bid_id
          ? bids.some(
              (b) =>
                b.id === request.awarded_bid_id &&
                (b.bidder_id === userId || b.bidder_user_id === userId)
            )
          : false)));
  const showProviderContact = isAwarded && isMinePost;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading request details...</div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-4xl mx-auto w-full px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">Request not available</h1>
          <p className="text-sm text-[var(--text3)] mb-6 max-w-md mx-auto">
            This RFQ may be closed, the link may be wrong, or public share preview is not enabled yet.
            If you were invited, try logging in — or ask the sender to share again after share access is enabled.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <Link href={`/login?next=${encodeURIComponent(`/marketplace/requests/${id}`)}`} className="btn btn-primary">
              Log in
            </Link>
            <Link href={`/signup?next=${encodeURIComponent(`/marketplace/requests/${id}`)}`} className="btn btn-secondary">
              Sign up free
            </Link>
            <Link href="/service-requests" className="btn btn-secondary">
              Service Requests
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <div className="mb-6">
          <Link href="/service-requests" className="text-[var(--gold)] hover:underline">
            ← Back to Service Requests
          </Link>
        </div>

        <div className="card p-8">
          <div className="flex justify-between items-start mb-6 gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold mb-2">{request.title || 'Service Request'}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text3)]">
                <span>
                  Urgency:{' '}
                  <span className="font-medium text-[var(--text)]">{request.urgency || '—'}</span>
                </span>
                {request.preferred_date && (
                  <span>Preferred: {new Date(request.preferred_date).toLocaleDateString()}</span>
                )}
                {regionLabel && (
                  <span>
                    Region:{' '}
                    <span className="font-medium text-[var(--text)]">{regionLabel}</span>
                  </span>
                )}
                {orgLoc?.name && (
                  <span className="text-[var(--text3)]">Facility: {orgLoc.name}</span>
                )}
                {isMinePost && (
                  <span className="text-[var(--gold)] font-medium">Your Post</span>
                )}
                {isAwarded && (
                  <span className="text-green-400 font-bold uppercase text-xs tracking-wide">
                    Awarded
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ShareButton
                {...serviceRequestShareText({
                  id,
                  title: request.title,
                  manufacturer: request.manufacturer,
                  model: request.model,
                  urgency: request.urgency,
                  region: regionLabel,
                  description: request.description,
                })}
              />
              <span className="text-xs px-3 py-1 rounded-full bg-[var(--surface3)] text-[var(--text3)]">
                {request.created_at ? new Date(request.created_at).toLocaleDateString() : ''}
              </span>
            </div>
          </div>

          {/* Guest invite CTA — shared link for people not yet on TSP */}
          {!userId && (
            <div className="mb-6 p-5 rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10">
              <div className="font-extrabold text-[var(--gold)] mb-1">You&apos;ve been invited to this RFQ</div>
              <p className="text-sm text-[var(--text2)] mb-4">
                Create a free Total Service Pro account to submit a bid, message the poster, or manage jobs from the web and Android app.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/signup?next=${encodeURIComponent(`/marketplace/requests/${id}`)}`}
                  className="btn btn-primary"
                >
                  Sign up free to bid
                </Link>
                <Link
                  href={`/login?next=${encodeURIComponent(`/marketplace/requests/${id}`)}`}
                  className="btn btn-secondary"
                >
                  Log in
                </Link>
              </div>
            </div>
          )}

          {isAwarded && (
            <div className="mb-6 p-4 rounded-xl border border-green-500/40 bg-green-500/10">
              <div className="font-bold text-green-400">This job has been awarded</div>
              <p className="text-sm text-[var(--text2)] mt-1">
                {isMinePost
                  ? 'You accepted a bid. Service company contact details are below. They can now see your facility contact info.'
                  : myWinningBid
                    ? 'Congratulations — your bid was accepted. Customer contact details are revealed below.'
                    : 'A winning bid has been selected for this request.'}
              </p>
              <Link href="/accepted-bids" className="text-sm text-[var(--gold)] hover:underline mt-2 inline-block">
                View all accepted bids →
              </Link>
            </div>
          )}

          {(regionLabel || request.location) && (
            <div className="mb-6 p-4 rounded-xl bg-[var(--surface3)] border border-[var(--border2)]">
              <h3 className="font-semibold mb-1 text-[var(--gold)] text-sm uppercase tracking-wide">
                Service area
              </h3>
              <p className="text-lg font-bold">{regionLabel || request.location}</p>
            </div>
          )}

          <div className="mb-8">
            <h3 className="font-semibold mb-2">Problem Description</h3>
            <p className="whitespace-pre-wrap text-[var(--text2)]">{request.description}</p>
          </div>

          {(request.manufacturer || request.model || request.serial_number) && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3">Equipment</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {request.manufacturer && (
                  <div>
                    <span className="text-[var(--text3)]">Manufacturer:</span> {request.manufacturer}
                  </div>
                )}
                {request.model && (
                  <div>
                    <span className="text-[var(--text3)]">Model:</span> {request.model}
                  </div>
                )}
                {request.serial_number && (
                  <div>
                    <span className="text-[var(--text3)]">Serial Number:</span>{' '}
                    {request.serial_number}
                  </div>
                )}
              </div>
            </div>
          )}

          {request.error_codes && (
            <div className="mb-8">
              <h3 className="font-semibold mb-2">Error / Fault Codes</h3>
              <p className="text-sm bg-[var(--surface3)] p-3 rounded">{request.error_codes}</p>
            </div>
          )}

          {/* Contact reveal after award */}
          {showFacilityContact && request.facility_contact && (
            <div className="mb-8 p-5 rounded-xl border border-green-500/40 bg-green-500/10">
              <h3 className="font-bold text-green-400 mb-2">Customer contact (revealed after award)</h3>
              <ContactBlock contact={request.facility_contact} />
            </div>
          )}
          {showProviderContact && request.provider_contact && (
            <div className="mb-8 p-5 rounded-xl border border-[var(--gold-border)] bg-[var(--gold-glow)]">
              <h3 className="font-bold text-[var(--gold)] mb-2">Service company contact</h3>
              <ContactBlock contact={request.provider_contact} />
            </div>
          )}

          {(isMinePost || isAwarded) && (
            <div className="border-t border-[var(--border2)] pt-6 mt-6 mb-6">
              <h3 className="font-semibold mb-3">
                Bids received ({bids.length})
                {isAwarded && (
                  <span className="text-green-400 text-sm font-normal ml-2">— job awarded</span>
                )}
              </h3>
              {bids.length === 0 ? (
                <p className="text-sm text-[var(--text3)]">No bids yet.</p>
              ) : (
                <ul className="space-y-3">
                  {bids.map((b) => {
                    const totalBid = b.price ?? b.amount ?? 0;
                    const st = (b.status || 'pending').toLowerCase();
                    const won = st === 'accepted';
                    const lost = st === 'rejected';
                    return (
                      <li
                        key={b.id}
                        className={
                          'card p-4 flex justify-between items-start gap-3 ' +
                          (won
                            ? 'border-2 border-green-500 bg-green-500/10'
                            : lost
                              ? 'opacity-50 grayscale'
                              : '')
                        }
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div
                              className={
                                'font-bold text-xl ' + (won ? 'text-green-400' : 'text-[var(--gold)]')
                              }
                            >
                              {money(totalBid)}
                            </div>
                            {won && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-green-500 text-black">
                                Accepted
                              </span>
                            )}
                            {lost && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[var(--surface3)] text-[var(--text3)]">
                                Not selected
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--text3)] mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                            {b.labor_amount != null && <span>Labor: {money(b.labor_amount)}</span>}
                            {b.parts_amount != null && <span>Parts: {money(b.parts_amount)}</span>}
                            {b.travel_amount != null && <span>Travel: {money(b.travel_amount)}</span>}
                            {b.per_diem_amount != null && (
                              <span>Per diem: {money(b.per_diem_amount)}</span>
                            )}
                            {b.other_amount != null && <span>Other: {money(b.other_amount)}</span>}
                          </div>
                          <div className="text-xs text-[var(--text3)] mt-1">
                            Status: {b.status || 'pending'}
                            {b.proposed_date
                              ? ` · Proposed: ${new Date(b.proposed_date).toLocaleDateString()}`
                              : ''}
                          </div>
                          {b.notes && <p className="text-sm mt-2">{b.notes}</p>}
                        </div>
                        {canAccept && !isAwarded && (st === 'pending' || !b.status) && (
                          <button
                            type="button"
                            className="btn btn-primary text-sm shrink-0"
                            onClick={() => handleAcceptBid(b.id)}
                          >
                            Accept
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Bid Section — pros only when job still open */}
          {!isMinePost && !isAwarded && (
            <div className="border-t border-[var(--border2)] pt-6 mt-6">
              <h3 className="font-semibold mb-3 text-lg">Submit a bid</h3>
              {!userId ? (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--text3)]">
                    Create a free account to bid on this RFQ. After signup, choose a service company role to submit bids.
                  </p>
                  <Link
                    href={`/signup?next=${encodeURIComponent(`/marketplace/requests/${id}`)}`}
                    className="btn btn-primary w-full block text-center"
                  >
                    Sign up free to bid
                  </Link>
                  <Link
                    href={`/login?next=${encodeURIComponent(`/marketplace/requests/${id}`)}`}
                    className="btn btn-secondary w-full block text-center"
                  >
                    Already have an account? Log in
                  </Link>
                </div>
              ) : !canBid ? (
                <p className="text-sm text-[var(--text3)]">
                  Sign in with a service company account to submit bids on this repair request.
                </p>
              ) : !showBidForm ? (
                <button
                  type="button"
                  onClick={() => setShowBidForm(true)}
                  className="btn btn-primary w-full"
                >
                  Submit Bid
                </button>
              ) : (
                <form onSubmit={handleSubmitBid} className="space-y-4">
                  <p className="text-xs text-[var(--text3)]">
                    Enter USD amounts for each category that applies. Total updates automatically.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Labor ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input"
                        placeholder="0.00"
                        value={labor}
                        onChange={(e) => setLabor(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">Parts ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input"
                        placeholder="0.00"
                        value={parts}
                        onChange={(e) => setParts(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">Travel ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input"
                        placeholder="0.00"
                        value={travel}
                        onChange={(e) => setTravel(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">Per Diem ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input"
                        placeholder="0.00"
                        value={perDiem}
                        onChange={(e) => setPerDiem(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Other ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input"
                        placeholder="0.00"
                        value={otherAmt}
                        onChange={(e) => setOtherAmt(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="card p-4 flex justify-between items-center border-[var(--gold-border)]">
                    <span className="font-semibold">Bid total</span>
                    <span className="text-2xl font-extrabold text-[var(--gold)]">{money(total)}</span>
                  </div>

                  <div>
                    <label className="label">Proposed service date</label>
                    <input
                      type="date"
                      className="input"
                      value={proposedDate}
                      onChange={(e) => setProposedDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Notes / scope (optional)</label>
                    <textarea
                      className="input min-h-[90px]"
                      value={bidNotes}
                      onChange={(e) => setBidNotes(e.target.value)}
                      placeholder="What is included, ETA, parts assumptions…"
                    />
                  </div>
                  <div>
                    <label className="label">Question for the facility (optional)</label>
                    <textarea
                      className="input min-h-[70px]"
                      placeholder="Access, codes, parts on site…"
                      value={bidQuestion}
                      onChange={(e) => setBidQuestion(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowBidForm(false)}
                      className="btn btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingBid || total <= 0}
                      className="btn btn-primary flex-1"
                    >
                      {submittingBid ? 'Submitting…' : `Submit Bid · ${money(total)}`}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {!isMinePost && isAwarded && !myWinningBid && (
            <div className="border-t border-[var(--border2)] pt-6 mt-6 text-sm text-[var(--text3)]">
              This job has already been awarded to another service company.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactBlock({ contact }: { contact: Record<string, any> }) {
  const name = contact.name || contact.company_name || contact.contact_person || '—';
  const person = contact.contact_person || contact.contact_name;
  const phone = contact.phone || contact.company_phone || contact.contact_phone;
  const email = contact.email || contact.company_email || contact.contact_email;
  const addr = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ');
  return (
    <div className="text-sm space-y-1">
      <div className="font-bold text-lg">{name}</div>
      {person && person !== name && <div>Contact: {person}</div>}
      {phone && (
        <div>
          Phone:{' '}
          <a className="text-[var(--gold)] hover:underline" href={`tel:${phone}`}>
            {phone}
          </a>
        </div>
      )}
      {email && (
        <div>
          Email:{' '}
          <a className="text-[var(--gold)] hover:underline" href={`mailto:${email}`}>
            {email}
          </a>
        </div>
      )}
      {addr && <div>Address: {addr}</div>}
      {contact.website && (
        <div>
          Web:{' '}
          <a className="text-[var(--gold)] hover:underline" href={contact.website} target="_blank" rel="noreferrer">
            {contact.website}
          </a>
        </div>
      )}
    </div>
  );
}
