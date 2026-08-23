'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { GuestAwarePrice } from '@/components/marketplace/GuestAwarePrice';
import { getSupabaseClient } from '@/lib/supabase/client';
import { listingHref } from '@/lib/marketplace/guest';
import {
  formatListingPrice,
  isConsumableListing,
  listingImages,
  listingPartCategory,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import { useSignedIn } from '@/lib/use-signed-in';
import { toast } from 'sonner';


export default function ConsumablesMarketplace() {
  const [listings, setListings] = useState<MarketplaceListingLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [biddingOn, setBiddingOn] = useState<MarketplaceListingLike | null>(null);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const { signedIn } = useSignedIn();
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchListings();
  }, []);

  const fetchListings = async () => {
    setLoading(true);
    let { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .or('listing_type.eq.consumable,listing_type.eq.consumables,listing_type.eq.part,listing_type.eq.parts')
      .order('created_at', { ascending: false });
    if (error) {
      const retry = await supabase
        .from('marketplace_listings')
        .select('*')
        .order('created_at', { ascending: false });
      data = retry.data;
      error = retry.error;
    }
    if (!error && data) setListings(data.filter(isConsumableListing));
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
            <h1 className="text-3xl font-extrabold">Consumables Marketplace</h1>
            <p className="text-[var(--text3)]">Dye kits, cryogen, filters, windows, tips, and other used-up items</p>
          </div>
          <Link href="/marketplace/list?type=consumable" className="btn btn-primary">
            + Create New Listing
          </Link>
        </div>

        <div className="card p-8 text-center">
          {listings.length === 0 ? (
          <p className="text-lg mb-4">No listings yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((l) => {
              const imgs = listingImages(l);
              const featured = imgs[0];
              const href = listingHref(signedIn, `/marketplace/listing/${l.id}`);
              const category = listingPartCategory(l);
              return (
                <div key={l.id} className="card p-6 text-left">
                  {featured && (
                    <Link href={href}>
                      <img src={featured} alt="" className="w-full h-32 object-cover rounded mb-3 cursor-pointer" />
                    </Link>
                  )}
                  <Link href={href}>
                    <h3 className="font-bold text-xl mb-1 hover:text-[var(--gold)] cursor-pointer">{l.title}</h3>
                  </Link>
                  {category && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gold)] mb-1">{category}</p>
                  )}
                  <p className="text-sm text-[var(--text3)] mb-1">{l.description || l.notes}</p>
                  <p className="text-sm text-[var(--text3)] mb-2">PN: {l.part_number || l.serial_number || 'N/A'}</p>
                  <p className="text-sm mb-2">{l.manufacturer} {l.model} • {l.condition}</p>
                  <GuestAwarePrice signedIn={signedIn} priceLabel={formatListingPrice(l)} className="font-semibold text-[var(--gold)] mb-2" />
                  {signedIn ? (
                  <button 
                    onClick={() => { setBiddingOn(l); setBidPrice(''); setBidNotes(''); setBidQuestion(''); }} 
                    className="btn btn-primary w-full text-sm"
                  >
                    Make Offer / Bid
                  </button>
                  ) : (
                    <Link href={href} className="btn btn-primary w-full text-sm">
                      Sign up to view
                    </Link>
                  )}

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
