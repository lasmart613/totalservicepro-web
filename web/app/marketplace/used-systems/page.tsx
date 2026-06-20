'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function UsedSystemsMarketplace() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [biddingOn, setBiddingOn] = useState<any>(null);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchListings();
  }, []);

  const fetchListings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('listing_type', 'used')
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
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Used Laser Systems</h1>
            <p className="text-[var(--text3)]">Buy or sell pre-owned laser equipment</p>
          </div>
          <Link href="/marketplace/list?type=used" className="btn btn-primary">
            + Create New Listing
          </Link>
        </div>

        <div className="card p-8 text-center">
          <p className="text-lg mb-4">Listings and search coming soon.</p>
          <p className="text-sm text-[var(--text3)]">
            Laser Owners will be able to list their used systems here.
          </p>
        </div>
      </div>
    </div>
  );
}