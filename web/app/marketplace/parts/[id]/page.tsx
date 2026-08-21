'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { ShareButton } from '@/components/ShareButton';
import { getSupabaseClient } from '@/lib/supabase/client';
import { listingShareText } from '@/lib/share';
import { loginHref } from '@/lib/login-next';
import { ListingDescription } from '@/components/ListingDescription';
import {
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingImages,
  listingQuantity,
  listingSellerName,
  partsDetailPath,
} from '@/lib/marketplace/parts';
import { toast } from 'sonner';
import { ArrowLeft, Image as ImageIcon, Package } from 'lucide-react';

export default function PartDetail() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [listing, setListing] = useState<null | (Record<string, unknown> & {
    id?: string;
    title?: string;
    description?: string;
    notes?: string;
    manufacturer?: string;
    model?: string;
    condition?: string;
    price?: number | string | null;
    price_type?: string | null;
    part_number?: string | null;
    serial_number?: string | null;
    city?: string | null;
    state?: string | null;
    listing_type?: string | null;
    category?: string | null;
    views?: number;
    details?: Record<string, unknown> | null;
    seller_name?: string | null;
  })>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const supabase = getSupabaseClient();

  useEffect(() => {
    if (searchParams.get('paid') === '1') {
      toast.success('Payment received. Thank you — the seller will follow up on shipping.');
    } else if (searchParams.get('paid') === '0') {
      toast.message('Checkout canceled. The part is still available if you want to try again.');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!id) return;
    const fetchListing = async () => {
    setLoading(true);
    setListing(null);
    const { data: auth } = await supabase.auth.getUser();
    setUserId(auth.user?.id || null);
    setUserEmail(auth.user?.email || null);

    let data: typeof listing = null;
    try {
      const res = await fetch(`/api/marketplace/parts/${encodeURIComponent(id)}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.listing) data = json.listing;
    } catch (e) {
      console.warn('parts detail API', e);
    }

    if (!data) {
      const { data: direct, error } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!error && direct && isPartListing(direct)) data = direct;
    }

    if (!data) {
      try {
        const res = await fetch(`/api/share/listing/${encodeURIComponent(id)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.listing && isPartListing(json.listing)) data = json.listing;
      } catch (e) {
        console.warn('share listing fallback', e);
      }
    }

    if (data) {
      setListing(data);
      if (auth.user && data.id) {
        const newViews = (data.views || 0) + 1;
        supabase.from('marketplace_listings').update({ views: newViews }).eq('id', id).then(() => {});
      }
      if (listingAvailability(data).purchasable) {
        fetch(`/api/marketplace/parts/${encodeURIComponent(id)}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncOnly: true }),
        }).catch(() => {});
      }
    }
    setLoading(false);
    };
    void fetchListing();
  }, [id, supabase]);

  const images = useMemo(() => (listing ? listingImages(listing) : []), [listing]);
  const mainPhoto = images[selectedPhoto] || images[0];
  const availability = listingAvailability(listing);
  const qty = listingQuantity(listing);
  const seller = listingSellerName(listing);
  const priceLabel = formatListingPrice(listing);
  const detailHref = partsDetailPath(id);

  const startPurchase = async () => {
    if (!listing || buying) return;
    if (!availability.purchasable) {
      toast.error(availability.reason || 'This part cannot be purchased');
      return;
    }
    setBuying(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = auth.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/marketplace/parts/${encodeURIComponent(id)}/checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: userEmail, quantity: 1 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        toast.error(json?.error || 'Could not start Stripe Checkout');
        return;
      }
      window.location.assign(json.url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not start checkout');
    } finally {
      setBuying(false);
    }
  };

  const submitBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidPrice) {
      toast.error('Please enter an offer amount');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.assign(loginHref(detailHref));
      return;
    }
    const { error } = await supabase.from('bids').insert({
      listing_id: id,
      bidder_id: user.id,
      price: parseFloat(bidPrice),
      notes: bidNotes,
      question: bidQuestion,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    if (error) {
      toast.error('Failed to submit: ' + error.message);
    } else {
      toast.success('Offer submitted!');
      setShowBidForm(false);
      setBidPrice('');
      setBidNotes('');
      setBidQuestion('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading part…</div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-4xl mx-auto w-full px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">Part not found</h1>
          <p className="text-[var(--text3)] mb-6">This listing may have been removed or is not a parts listing.</p>
          <Link href="/marketplace/parts" className="btn btn-primary">Back to Parts Marketplace</Link>
        </div>
      </div>
    );
  }

  const details = listing.details && typeof listing.details === 'object' ? listing.details : {};
  const compatible = details.compatible_models != null ? String(details.compatible_models) : listing.model;
  const sku = details.sku != null ? String(details.sku) : listing.part_number || listing.serial_number;
  const warranty = details.warranty != null ? String(details.warranty) : null;
  const oem = details.oem_type != null ? String(details.oem_type) : null;
  const partCategory = details.part_category != null ? String(details.part_category) : null;
  const shipping =
    details.shipping && typeof details.shipping === 'object'
      ? (details.shipping as Record<string, unknown>)
      : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace/parts" className="inline-flex items-center gap-2 text-[var(--gold)] mb-6 hover:underline">
          <ArrowLeft size={18} /> Back to Parts Marketplace
        </Link>

        {searchParams.get('paid') === '1' && (
          <div className="mb-6 p-4 rounded-xl border border-green-500/40 bg-green-900/20 text-green-300">
            Payment received. Check your email for the Stripe receipt. The seller will arrange fulfillment.
          </div>
        )}

        <div className="card p-6 md:p-8">
          <div className="grid md:grid-cols-2 gap-10">
            <div>
              <div className="aspect-square bg-[var(--surface3)] rounded-xl flex items-center justify-center border border-[var(--border)] overflow-hidden">
                {mainPhoto ? (
                  <img src={mainPhoto} alt={listing.title} className="w-full h-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center text-[var(--text3)]">
                    <ImageIcon size={80} />
                    <p className="text-sm mt-3">No photo yet</p>
                  </div>
                )}
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 mt-3 overflow-x-auto">
                  {images.map((url: string, idx: number) => (
                    <button
                      key={`${url}-${idx}`}
                      type="button"
                      onClick={() => setSelectedPhoto(idx)}
                      className={`w-16 h-16 rounded border overflow-hidden shrink-0 ${
                        selectedPhoto === idx ? 'border-[var(--gold)]' : 'border-[var(--border)]'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {sku && <div className="font-mono text-sm text-[var(--text3)]">{sku}</div>}
                  <h1 className="text-3xl font-extrabold mt-1">{listing.title}</h1>
                  {(listing.manufacturer || listing.model) && (
                    <p className="text-[var(--text2)] mt-1">
                      {[listing.manufacturer, listing.model].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <ShareButton
                  {...listingShareText({
                    id,
                    title: listing.title,
                    manufacturer: listing.manufacturer,
                    model: listing.model,
                    price: listing.price,
                    condition: listing.condition,
                    description: listing.description,
                    listingType: listing.listing_type || 'part',
                    category: listing.category,
                  })}
                />
              </div>

              <div className="mt-6 flex flex-wrap items-end gap-4">
                <div className="text-4xl font-extrabold text-[var(--gold)]">{priceLabel}</div>
                {availability.soldOut ? (
                  <div className="px-3 py-1 rounded-full bg-red-900/40 text-red-300 text-sm font-semibold">Sold out</div>
                ) : qty != null ? (
                  <div className="text-sm text-green-400">
                    <Package size={14} className="inline mr-1" />
                    {qty} in stock
                  </div>
                ) : null}
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {listing.condition && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">Condition</div>
                    <div className="inline-block px-3 py-1 bg-green-900/30 text-green-400 rounded-full">{listing.condition}</div>
                  </div>
                )}
                {partCategory && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">Category</div>
                    <div>{partCategory}</div>
                  </div>
                )}
                {compatible && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">Compatible models</div>
                    <div>{compatible}</div>
                  </div>
                )}
                {oem && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">OEM / aftermarket</div>
                    <div className="capitalize">{String(oem).replace(/_/g, ' ')}</div>
                  </div>
                )}
                {warranty && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">Warranty</div>
                    <div>{warranty}</div>
                  </div>
                )}
                {seller && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">Seller</div>
                    <div>{seller}</div>
                  </div>
                )}
                {(listing.city || listing.state) && (
                  <div>
                    <div className="text-[var(--text3)] mb-1">Location</div>
                    <div>{[listing.city, listing.state].filter(Boolean).join(', ')}</div>
                  </div>
                )}
              </div>

              {listing.description && (
                <div className="mt-8">
                  <div className="font-semibold mb-2">Description</div>
                  <ListingDescription text={String(listing.description)} />
                </div>
              )}

              {shipping && (shipping.lead_time || shipping.method || shipping.policy || shipping.cost != null) && (
                <div className="mt-6 text-sm text-[var(--text2)]">
                  <div className="font-semibold text-[var(--text)] mb-1">Shipping</div>
                  {shipping.lead_time != null && shipping.lead_time !== '' && (
                    <div>Lead time: {String(shipping.lead_time)}</div>
                  )}
                  {shipping.method != null && shipping.method !== '' && (
                    <div>Method: {String(shipping.method)}</div>
                  )}
                  {shipping.cost != null && <div>Shipping: ${Number(shipping.cost).toLocaleString()}</div>}
                  {shipping.policy != null && shipping.policy !== '' && (
                    <div className="mt-1 whitespace-pre-wrap">{String(shipping.policy)}</div>
                  )}
                </div>
              )}

              <div className="mt-10 space-y-3">
                {availability.purchasable ? (
                  <button
                    type="button"
                    onClick={startPurchase}
                    disabled={buying}
                    className="btn btn-primary w-full py-4 text-lg"
                  >
                    {buying ? 'Starting checkout…' : `Purchase · ${priceLabel}`}
                  </button>
                ) : (
                  <div className="w-full py-4 text-center rounded-lg border border-[var(--border)] bg-[var(--surface3)] text-[var(--text2)]">
                    {availability.soldOut ? 'Sold out' : availability.reason || 'Unavailable'}
                  </div>
                )}
                <p className="text-xs text-center text-[var(--text3)]">
                  Secure Stripe Checkout on RepairPlanet. Login is not required to buy.
                </p>
              </div>

              <div className="border-t border-[var(--border)] mt-8 pt-6">
                {!userId ? (
                  <Link href={loginHref(detailHref)} className="btn btn-secondary w-full block text-center">
                    Log in to make an offer
                  </Link>
                ) : !showBidForm ? (
                  <button type="button" onClick={() => setShowBidForm(true)} className="btn btn-secondary w-full">
                    Make Offer / Bid
                  </button>
                ) : (
                  <form onSubmit={submitBid} className="space-y-4">
                    <div>
                      <label className="label">Your Offer Amount ($)</label>
                      <input type="number" className="input" value={bidPrice} onChange={(e) => setBidPrice(e.target.value)} required />
                    </div>
                    <div>
                      <label className="label">Notes / Offer Details</label>
                      <textarea className="input min-h-[80px]" value={bidNotes} onChange={(e) => setBidNotes(e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Question for the seller (optional)</label>
                      <textarea
                        className="input min-h-[80px]"
                        value={bidQuestion}
                        onChange={(e) => setBidQuestion(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setShowBidForm(false)} className="btn btn-secondary flex-1">
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary flex-1">
                        Submit Offer
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
