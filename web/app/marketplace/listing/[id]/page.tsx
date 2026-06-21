'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function ListingDetail() {
  const params = useParams();
  const id = params.id as string;
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const supabase = getSupabaseClient();

  useEffect(() => {
    if (id) fetchListing();
  }, [id]);

  const fetchListing = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      toast.error('Listing not found');
    } else {
      setListing(data);
      // Increment views (make counter functional). Fire and forget; ignore errors for UX.
      if (data) {
        const newViews = (data.views || 0) + 1;
        supabase.from('marketplace_listings').update({ views: newViews }).eq('id', id).then(() => {});
      }
    }
    setLoading(false);
  };

  const submitBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidPrice) {
      toast.error('Please enter an offer amount');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('You must be logged in');
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
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-4xl mx-auto w-full px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">Listing Not Found</h1>
          <Link href="/marketplace" className="btn btn-primary">Back to Marketplace</Link>
        </div>
      </div>
    );
  }

  const images = Array.isArray(listing.images) ? listing.images : (listing.images ? [listing.images] : []);
  const mainPhoto = images[selectedPhoto] || images[0];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace" className="text-[var(--gold)] hover:underline mb-6 inline-block">← Back to Marketplace</Link>

        <div className="card p-8">
          {/* Featured Photo */}
          {mainPhoto && (
            <div className="mb-6">
              <img src={mainPhoto} alt={listing.title} className="w-full max-h-[400px] object-contain rounded-lg border" />
              {images.length > 1 && (
                <div className="flex gap-2 mt-3 justify-center">
                  {images.map((url: string, idx: number) => (
                    <img
                      key={idx}
                      src={url}
                      alt=""
                      onClick={() => setSelectedPhoto(idx)}
                      className={`w-16 h-16 object-cover rounded cursor-pointer border ${selectedPhoto === idx ? 'border-[var(--gold)]' : 'border-transparent'}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <h1 className="text-3xl font-extrabold mb-2">{listing.title}</h1>
          {listing.description && <p className="text-[var(--text3)] mb-4 whitespace-pre-wrap">{listing.description}</p>}

          {/* PN below name */}
          {(listing.part_number || listing.serial_number) && (
            <p className="text-sm text-[var(--text3)] mb-4">
              Part/Serial Number: {listing.part_number || listing.serial_number}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-sm">
            {listing.manufacturer && <div><span className="text-[var(--text3)]">Manufacturer:</span> {listing.manufacturer}</div>}
            {listing.model && <div><span className="text-[var(--text3)]">Model:</span> {listing.model}</div>}
            {listing.condition && <div><span className="text-[var(--text3)]">Condition:</span> {listing.condition}</div>}
            {listing.year_manufactured && <div><span className="text-[var(--text3)]">Year:</span> {listing.year_manufactured}</div>}
            {listing.price && <div><span className="text-[var(--text3)]">Price:</span> <span className="font-semibold text-[var(--gold)]">${listing.price}</span></div>}
            {typeof listing.views === 'number' && <div><span className="text-[var(--text3)]">Views:</span> {listing.views}</div>}
          </div>

          {listing.details && (
            <div className="mb-6">
              <h3 className="font-semibold mb-2">Details</h3>
              <pre className="text-sm bg-[var(--surface3)] p-3 rounded overflow-auto whitespace-pre-wrap">{JSON.stringify(listing.details, null, 2)}</pre>
            </div>
          )}

          {/* Bid Form */}
          <div className="border-t pt-6">
            {!showBidForm ? (
              <button onClick={() => setShowBidForm(true)} className="btn btn-primary w-full">
                Make Offer / Bid
              </button>
            ) : (
              <form onSubmit={submitBid} className="space-y-4">
                <div>
                  <label className="label">Your Offer Amount ($)</label>
                  <input type="number" className="input" value={bidPrice} onChange={e => setBidPrice(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Notes / Offer Details</label>
                  <textarea className="input min-h-[80px]" value={bidNotes} onChange={e => setBidNotes(e.target.value)} />
                </div>
                <div>
                  <label className="label">Question for the seller (optional)</label>
                  <textarea 
                    className="input min-h-[80px] whitespace-pre-wrap" 
                    value={bidQuestion} 
                    onChange={e => setBidQuestion(e.target.value)} 
                    placeholder="Ask any questions about the listing..."
                  />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowBidForm(false)} className="btn btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn btn-primary flex-1">Submit Offer</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
