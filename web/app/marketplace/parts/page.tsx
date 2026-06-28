'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function PartsMarketplace() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [biddingOn, setBiddingOn] = useState<any>(null);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchListings();
  }, []);

  const fetchListings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('listing_type', 'part')
      .order('created_at', { ascending: false });
    if (!error && data) setListings(data);
    setLoading(false);
  };

  const submitBid = async () => {
    if (!biddingOn || !bidPrice) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Login required');
      return;
    }
    const { error } = await supabase.from('bids').insert({
      listing_id: biddingOn.id,
      bidder_id: user.id,
      price: parseFloat(bidPrice),
      notes: bidNotes,
      question: bidQuestion,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    if (error) {
      toast.error('Failed to submit offer: ' + error.message);
    } else {
      toast.success('Offer submitted!');
      setBiddingOn(null);
      setBidPrice('');
      setBidNotes('');
      setBidQuestion('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading listings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Parts Marketplace</h1>
            <p className="text-[var(--text3)]">Parts currently listed for sale</p>
          </div>
          <Link href="/marketplace/list?type=part" className="btn btn-primary">
            + Create New Listing
          </Link>
        </div>

        <div className="card p-8 text-center">
          {listings.length === 0 ? (
          <p className="text-lg mb-4">No listings yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((l) => {
              const imgs = Array.isArray(l.images) ? l.images : (l.images ? [l.images] : []);
              const featured = imgs[0];
              return (
                <div key={l.id} className="card p-6">
                  {featured && (
                    <Link href={`/marketplace/listing/${l.id}`}>
                      <img src={featured} alt="Featured" className="w-full h-32 object-cover rounded mb-3 cursor-pointer" />
                    </Link>
                  )}
                  <Link href={`/marketplace/listing/${l.id}`}>
                    <h3 className="font-bold text-xl mb-1 hover:text-[var(--gold)] cursor-pointer">{l.title}</h3>
                  </Link>
                  <p className="text-sm text-[var(--text3)] mb-1">{l.description}</p>
                  <p className="text-sm text-[var(--text3)] mb-2">PN: {l.part_number || l.serial_number || 'N/A'}</p>
                  <p className="text-sm mb-1">{l.manufacturer} {l.model} • {l.condition}</p>
                  <div className="font-semibold text-[var(--gold)] mb-2">${l.price}</div>
                  <button 
                    onClick={() => { setBiddingOn(l); setBidPrice(''); setBidNotes(''); setBidQuestion(''); }} 
                    className="btn btn-primary w-full text-sm"
                  >
                    Make Offer / Bid
                  </button>

                  {biddingOn?.id === l.id && (
                    <div className="mt-3 p-3 bg-[var(--surface3)] rounded">
                      <input 
                        type="number" 
                        className="input mb-2" 
                        placeholder="Your offer amount" 
                        value={bidPrice} 
                        onChange={e => setBidPrice(e.target.value)} 
                      />
                      <textarea 
                        className="input mb-2 min-h-[60px]" 
                        placeholder="Notes / offer details" 
                        value={bidNotes} 
                        onChange={e => setBidNotes(e.target.value)} 
                      />
                      <textarea 
                        className="input mb-2 min-h-[60px]" 
                        placeholder="Question for the seller (optional)" 
                        value={bidQuestion} 
                        onChange={e => setBidQuestion(e.target.value)} 
                      />
                      <div className="flex gap-2">
                        <button onClick={submitBid} className="btn btn-primary flex-1 text-sm">Submit Offer</button>
                        <button onClick={() => setBiddingOn(null)} className="btn btn-secondary flex-1 text-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}