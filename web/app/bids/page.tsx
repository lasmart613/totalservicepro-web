'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isOwnerish } from '@/lib/roles';
import { toast } from 'sonner';

type BidRow = {
  id: string;
  price?: number | null;
  amount?: number | null;
  labor_amount?: number | null;
  parts_amount?: number | null;
  travel_amount?: number | null;
  per_diem_amount?: number | null;
  other_amount?: number | null;
  notes?: string | null;
  question?: string | null;
  status?: string | null;
  created_at?: string | null;
  proposed_date?: string | null;
  request_id?: string | null;
  listing_id?: string | null;
  bidder_id?: string | null;
  bidder_user_id?: string | null;
  bidder_org_id?: number | null;
  service_requests?: any;
  marketplace_listings?: any;
};

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function parseAmt(s: string) {
  const n = parseFloat(String(s || '').replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : 0;
}

export default function MyBidsPage() {
  const [bids, setBids] = useState<BidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    labor: '',
    parts: '',
    travel: '',
    perDiem: '',
    other: '',
    notes: '',
    question: '',
    proposed_date: '',
  });
  const [saving, setSaving] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchMyBids();
  }, []);

  const fetchMyBids = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);

    const { data: prof } = await supabase
      .from('user_profiles')
      .select('role, organization_id, organizations(type)')
      .eq('id', user.id)
      .maybeSingle();
    const oId = prof?.organization_id ?? null;
    setOrgId(oId);
    const orgType =
      (prof?.organizations as { type?: string | null } | null)?.type ||
      user.user_metadata?.organization_type ||
      null;
    if (isOwnerish(prof?.role || user.user_metadata?.role, orgType)) {
      setBlocked(true);
      setBids([]);
      setLoading(false);
      return;
    }

    // Include bids by user id (both columns) and by company org
    let query = supabase
      .from('bids')
      .select(
        `
        id, price, amount, labor_amount, parts_amount, travel_amount, per_diem_amount, other_amount,
        notes, question, status, created_at, proposed_date, request_id, listing_id,
        bidder_id, bidder_user_id, bidder_org_id,
        service_requests ( id, title, description, urgency, manufacturer, model, status ),
        marketplace_listings ( id, title, description, manufacturer, model )
      `
      )
      .order('created_at', { ascending: false });

    // PostgREST or() for ownership
    const orParts = [`bidder_id.eq.${user.id}`, `bidder_user_id.eq.${user.id}`];
    if (oId != null) orParts.push(`bidder_org_id.eq.${oId}`);
    query = query.or(orParts.join(','));

    const { data, error } = await query;
    if (!error && data) {
      setBids(data as BidRow[]);
    } else {
      // Fallback without joins
      let q2 = supabase
        .from('bids')
        .select(
          'id, price, amount, labor_amount, parts_amount, travel_amount, per_diem_amount, other_amount, notes, question, status, created_at, proposed_date, request_id, listing_id, bidder_id, bidder_user_id, bidder_org_id'
        )
        .order('created_at', { ascending: false });
      q2 = q2.or(orParts.join(','));
      const { data: bidRows, error: e2 } = await q2;
      if (e2) toast.error(e2.message);
      const list = (bidRows || []) as BidRow[];
      // Attach request titles
      for (const b of list) {
        if (b.request_id) {
          const { data: req } = await supabase
            .from('service_requests')
            .select('id, title, description, urgency, manufacturer, model, status')
            .eq('id', b.request_id)
            .maybeSingle();
          if (req) b.service_requests = req;
        }
      }
      setBids(list);
    }
    setLoading(false);
  };

  function openEdit(bid: BidRow) {
    const st = (bid.status || 'pending').toLowerCase();
    if (st !== 'pending') {
      toast.error('Only pending bids can be edited.');
      return;
    }
    setEditId(bid.id);
    setForm({
      labor: bid.labor_amount != null ? String(bid.labor_amount) : '',
      parts: bid.parts_amount != null ? String(bid.parts_amount) : '',
      travel: bid.travel_amount != null ? String(bid.travel_amount) : '',
      perDiem: bid.per_diem_amount != null ? String(bid.per_diem_amount) : '',
      other: bid.other_amount != null ? String(bid.other_amount) : '',
      notes: bid.notes || '',
      question: bid.question || '',
      proposed_date: bid.proposed_date || '',
    });
  }

  function totalFromForm() {
    return (
      parseAmt(form.labor) +
      parseAmt(form.parts) +
      parseAmt(form.travel) +
      parseAmt(form.perDiem) +
      parseAmt(form.other)
    );
  }

  async function saveEdit() {
    if (!editId) return;
    const total = totalFromForm();
    // If no line items, keep existing total if form empty
    const bid = bids.find((b) => b.id === editId);
    const price =
      total > 0 ? total : bid?.price ?? bid?.amount ?? 0;
    if (price <= 0) {
      toast.error('Enter at least one amount.');
      return;
    }
    setSaving(true);
    const payload: any = {
      price,
      amount: price,
      labor_amount: parseAmt(form.labor) || null,
      parts_amount: parseAmt(form.parts) || null,
      travel_amount: parseAmt(form.travel) || null,
      per_diem_amount: parseAmt(form.perDiem) || null,
      other_amount: parseAmt(form.other) || null,
      notes: form.notes.trim() || null,
      question: form.question.trim() || null,
      proposed_date: form.proposed_date || null,
      updated_at: new Date().toISOString(),
    };
    try {
      let { error } = await supabase.from('bids').update(payload).eq('id', editId).eq('status', 'pending');
      if (error) {
        // slim update if some columns missing
        const slim = {
          price,
          amount: price,
          notes: payload.notes,
          status: 'pending',
        };
        const r2 = await supabase.from('bids').update(slim).eq('id', editId);
        if (r2.error) throw r2.error;
      }
      toast.success('Bid updated');
      setEditId(null);
      await fetchMyBids();
    } catch (e: any) {
      toast.error(e.message || 'Could not update bid');
    } finally {
      setSaving(false);
    }
  }

  async function withdrawBid(bidId: string) {
    if (!confirm('Withdraw this pending bid? The facility will no longer see it as active.')) return;
    const { error } = await supabase
      .from('bids')
      .update({ status: 'withdrawn' })
      .eq('id', bidId)
      .eq('status', 'pending');
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Bid withdrawn');
    await fetchMyBids();
  }

  function statusClass(st: string) {
    const s = st.toLowerCase();
    if (s === 'accepted') return 'bg-green-500/20 text-green-400 border-green-500/40';
    if (s === 'rejected' || s === 'withdrawn') return 'bg-[var(--surface3)] text-[var(--text3)]';
    return 'bg-[var(--gold-glow)] text-[var(--gold)] border-[var(--gold-border)]';
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading your bids...</div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-4xl mx-auto w-full px-4 py-8">
          <Link href="/" className="text-sm text-[var(--gold)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-3xl font-extrabold mt-1">My Bids</h1>
          <div className="card p-8 text-center mt-6">
            <p className="text-lg mb-2">Not available</p>
            <p className="text-sm text-[var(--text3)] mb-4">
              My Bids is for repair companies that submit offers on jobs. Bids on your own service
              requests stay on each request.
            </p>
            <Link href="/service-requests" className="btn btn-primary">
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
        <div className="flex flex-wrap justify-between items-start gap-3 mb-8">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">
              ← Dashboard
            </Link>
            <h1 className="text-3xl font-extrabold mt-1">My Bids</h1>
            <p className="text-[var(--text3)] text-sm">
              Bids your company submitted on repair jobs. Pending bids can be edited or withdrawn.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/service-requests" className="btn btn-secondary text-sm">
              Repair Jobs
            </Link>
            <Link href="/accepted-bids" className="btn btn-primary text-sm">
              Accepted Bids
            </Link>
          </div>
        </div>

        {bids.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg mb-2">No bids yet.</p>
            <p className="text-sm text-[var(--text3)] mb-4">
              Open repair jobs and submit a bid from the request detail page.
            </p>
            <Link href="/service-requests" className="btn btn-primary">
              Browse Repair Jobs
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bids.map((bid) => {
              const total = bid.price ?? bid.amount;
              const st = (bid.status || 'pending').toLowerCase();
              const pending = st === 'pending';
              const title =
                bid.service_requests?.title ||
                bid.marketplace_listings?.title ||
                'Service request';
              const desc =
                bid.service_requests?.description || bid.marketplace_listings?.description || '';
              return (
                <div key={bid.id} className="card p-6">
                  <div className="flex justify-between items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-bold text-xl text-[var(--gold)]">{title}</h3>
                        <span
                          className={
                            'text-[10px] font-bold uppercase px-2 py-0.5 rounded border ' +
                            statusClass(st)
                          }
                        >
                          {st}
                        </span>
                      </div>
                      {(bid.service_requests?.manufacturer || bid.service_requests?.model) && (
                        <p className="text-xs text-[var(--text3)]">
                          {[bid.service_requests?.manufacturer, bid.service_requests?.model]
                            .filter(Boolean)
                            .join(' ')}
                          {bid.service_requests?.urgency
                            ? ` · Urgency: ${bid.service_requests.urgency}`
                            : ''}
                        </p>
                      )}
                      {desc && (
                        <p className="text-sm text-[var(--text2)] line-clamp-2 mt-2">{desc}</p>
                      )}
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm mt-3">
                        <div>
                          <span className="text-[var(--text3)]">Total:</span>{' '}
                          <span className="font-extrabold text-[var(--gold)] text-lg">
                            {money(total)}
                          </span>
                        </div>
                        {bid.labor_amount != null && (
                          <div className="text-[var(--text3)]">Labor {money(bid.labor_amount)}</div>
                        )}
                        {bid.parts_amount != null && (
                          <div className="text-[var(--text3)]">Parts {money(bid.parts_amount)}</div>
                        )}
                        {bid.travel_amount != null && (
                          <div className="text-[var(--text3)]">Travel {money(bid.travel_amount)}</div>
                        )}
                        {bid.proposed_date && (
                          <div className="text-[var(--text3)]">
                            Proposed {new Date(bid.proposed_date).toLocaleDateString()}
                          </div>
                        )}
                        <div className="text-[var(--text3)]">
                          Submitted{' '}
                          {bid.created_at
                            ? new Date(bid.created_at).toLocaleDateString()
                            : '—'}
                        </div>
                      </div>
                      {bid.notes && (
                        <p className="text-sm mt-3">
                          <span className="text-[var(--text3)]">Notes:</span> {bid.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {bid.request_id && (
                        <Link
                          href={`/marketplace/requests/${bid.request_id}`}
                          className="btn btn-secondary text-sm"
                        >
                          View job
                        </Link>
                      )}
                      {pending && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary text-sm"
                            onClick={() => openEdit(bid)}
                          >
                            Edit bid
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary text-sm text-red-400"
                            onClick={() => withdrawBid(bid.id)}
                          >
                            Withdraw
                          </button>
                        </>
                      )}
                      {st === 'accepted' && (
                        <Link href="/accepted-bids" className="btn btn-primary text-sm">
                          Accepted details
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="card w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between mb-3">
              <h2 className="font-bold text-lg text-[var(--gold)]">Edit pending bid</h2>
              <button type="button" className="text-[var(--text3)]" onClick={() => setEditId(null)}>
                ✕
              </button>
            </div>
            <p className="text-xs text-[var(--text3)] mb-3">
              Update USD line items. Total: <strong className="text-[var(--gold)]">{money(totalFromForm())}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['labor', 'Labor ($)'],
                  ['parts', 'Parts ($)'],
                  ['travel', 'Travel ($)'],
                  ['perDiem', 'Per diem ($)'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="label">Other ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={form.other}
                onChange={(e) => setForm({ ...form, other: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <label className="label">Proposed date</label>
              <input
                type="date"
                className="input"
                value={form.proposed_date}
                onChange={(e) => setForm({ ...form, proposed_date: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <label className="label">Notes / scope</label>
              <textarea
                className="input"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="mt-3">
              <label className="label">Question for facility</label>
              <textarea
                className="input"
                rows={2}
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setEditId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                disabled={saving}
                onClick={saveEdit}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
