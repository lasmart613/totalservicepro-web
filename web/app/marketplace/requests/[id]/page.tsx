'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { canBidMarketplace, canAcceptBids, isPro } from '@/lib/roles';

export default function ServiceRequestDetail() {
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const [submittingBid, setSubmittingBid] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<any>(null);
  const [bids, setBids] = useState<any[]>([]);

  const supabase = getSupabaseClient();

  useEffect(() => {
    if (id) fetchRequest();
  }, [id]);

  const fetchRequest = async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', user.id)
        .maybeSingle();
      setUserRole(prof?.role || '');
      setOrgId(prof?.organization_id || null);
    }

    const { data: reqData, error } = await supabase
      .from('marketplace_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !reqData) {
      toast.error('Request not found');
      setLoading(false);
      return;
    }

    setRequest(reqData);

    if (reqData.location_id) {
      const { data: locData } = await supabase
        .from('locations')
        .select('name, city, state')
        .eq('id', reqData.location_id)
        .single();

      if (locData) setLocation(locData);
    }

    // Load bids for post owners (owners + suppliers accepting on own posts)
    try {
      const { data: bidRows } = await supabase
        .from('bids')
        .select('id, price, notes, status, bidder_id, created_at')
        .eq('request_id', id)
        .order('created_at', { ascending: false });
      setBids(bidRows || []);
    } catch {
      setBids([]);
    }

    setLoading(false);
  };

  const isMinePost =
    !!userId &&
    (request?.created_by === userId ||
      (orgId != null && request?.organization_id != null && String(request.organization_id) === String(orgId)));

  const canBid = canBidMarketplace(userRole) || isPro(userRole);
  const canAccept = canAcceptBids(userRole) && isMinePost;

  const handleSubmitBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidPrice) {
      toast.error('Please enter a bid amount');
      return;
    }
    if (!canBid) {
      toast.error('Only service professionals can bid on requests.');
      return;
    }
    if (isMinePost) {
      toast.error('You cannot bid on your own post.');
      return;
    }

    setSubmittingBid(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('You must be logged in to bid');
        return;
      }

      const { error } = await supabase.from('bids').insert({
        request_id: id,
        bidder_id: user.id,
        price: parseFloat(bidPrice),
        notes: bidNotes,
        question: bidQuestion,
        status: 'pending',
        created_at: new Date().toISOString(),
      });

      if (error) throw error;

      toast.success('Bid submitted successfully!');
      setShowBidForm(false);
      setBidPrice('');
      setBidNotes('');
      setBidQuestion('');
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
    try {
      const { error } = await supabase.from('bids').update({ status: 'accepted' }).eq('id', bidId);
      if (error) throw error;
      // Best-effort: mark other bids rejected
      try {
        await supabase
          .from('bids')
          .update({ status: 'rejected' })
          .eq('request_id', id)
          .neq('id', bidId)
          .eq('status', 'pending');
      } catch { /* ignore */ }
      toast.success('Bid accepted.');
      await fetchRequest();
    } catch (e: any) {
      toast.error(e.message || 'Failed to accept bid');
    }
  };

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
          <h1 className="text-2xl font-bold mb-4">Request Not Found</h1>
          <Link href="/marketplace/requests" className="btn btn-primary">
            Back to Service Requests
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <div className="mb-6">
          <Link href="/marketplace/requests" className="text-[var(--gold)] hover:underline">
            ← Back to Service Requests
          </Link>
        </div>

        <div className="card p-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-3xl font-extrabold mb-2">{request.title || 'Service Request'}</h1>
              <div className="flex items-center gap-4 text-sm text-[var(--text3)]">
                <span>Urgency: <span className="font-medium text-white">{request.urgency}</span></span>
                {request.preferred_date && (
                  <span>Preferred: {new Date(request.preferred_date).toLocaleDateString()}</span>
                )}
                {isMinePost && (
                  <span className="text-[var(--gold)] font-medium">Your Post</span>
                )}
              </div>
            </div>
            <span className="text-xs px-3 py-1 rounded-full bg-[var(--surface3)] text-[var(--text3)]">
              {new Date(request.created_at).toLocaleDateString()}
            </span>
          </div>

          {location && (
            <div className="mb-6">
              <h3 className="font-semibold mb-1">Location</h3>
              <p className="text-lg">
                {location.name}
                {(location.city || location.state) && (
                  <span className="text-[var(--text3)]"> — {location.city}{location.city && location.state ? ', ' : ''}{location.state}</span>
                )}
              </p>
            </div>
          )}

          <div className="prose max-w-none mb-8">
            <h3 className="font-semibold mb-2">Problem Description</h3>
            <p className="whitespace-pre-wrap">{request.description}</p>
          </div>

          {(request.manufacturer || request.model || request.serial_number) && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3">Equipment</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {request.manufacturer && <div><span className="text-[var(--text3)]">Manufacturer:</span> {request.manufacturer}</div>}
                {request.model && <div><span className="text-[var(--text3)]">Model:</span> {request.model}</div>}
                {request.serial_number && <div><span className="text-[var(--text3)]">Serial Number:</span> {request.serial_number}</div>}
              </div>
            </div>
          )}

          {request.error_codes && (
            <div className="mb-8">
              <h3 className="font-semibold mb-2">Error / Fault Codes</h3>
              <p className="text-sm bg-[var(--surface3)] p-3 rounded">{request.error_codes}</p>
            </div>
          )}

          {request.images && request.images.length > 0 && (
            <div className="mb-8">
              <h3 className="font-semibold mb-3">Photos</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {request.images.map((url: string, index: number) => (
                  <img key={index} src={url} alt={`Request photo ${index + 1}`} className="rounded-lg border object-cover w-full h-40" />
                ))}
              </div>
            </div>
          )}

          {/* Owner/supplier: view & accept bids on own posts */}
          {isMinePost && (
            <div className="border-t pt-6 mt-6 mb-6">
              <h3 className="font-semibold mb-3">Bids received ({bids.length})</h3>
              {bids.length === 0 ? (
                <p className="text-sm text-[var(--text3)]">No bids yet.</p>
              ) : (
                <ul className="space-y-3">
                  {bids.map((b) => (
                    <li key={b.id} className="card p-4 flex justify-between items-start gap-3">
                      <div>
                        <div className="font-bold text-[var(--gold)]">${b.price}</div>
                        <div className="text-xs text-[var(--text3)]">Status: {b.status || 'pending'}</div>
                        {b.notes && <p className="text-sm mt-1">{b.notes}</p>}
                      </div>
                      {canAccept && (b.status === 'pending' || !b.status) && (
                        <button
                          type="button"
                          className="btn btn-primary text-sm"
                          onClick={() => handleAcceptBid(b.id)}
                        >
                          Accept
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Bid Section — pros only, not on own post */}
          {!isMinePost && (
            <div className="border-t pt-6 mt-6">
              {!canBid ? (
                <p className="text-sm text-[var(--text3)]">
                  Sign in as a service professional (FSE / company admin) to submit bids.
                </p>
              ) : !showBidForm ? (
                <button
                  onClick={() => setShowBidForm(true)}
                  className="btn btn-primary w-full"
                >
                  Submit Bid
                </button>
              ) : (
                <form onSubmit={handleSubmitBid} className="space-y-4">
                  <div>
                    <label className="label">Your Bid Amount ($)</label>
                    <input
                      type="number"
                      className="input"
                      value={bidPrice}
                      onChange={(e) => setBidPrice(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Notes / Comments (optional)</label>
                    <textarea
                      className="input min-h-[100px]"
                      value={bidNotes}
                      onChange={(e) => setBidNotes(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Question for the seller (optional)</label>
                    <textarea
                      className="input min-h-[80px]"
                      placeholder="Ask any questions about the request..."
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
                      disabled={submittingBid}
                      className="btn btn-primary flex-1"
                    >
                      {submittingBid ? 'Submitting...' : 'Submit Bid'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
