'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function MyBidsPage() {
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchMyBids();
  }, []);

  const fetchMyBids = async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('bids')
      .select(`
        id,
        price,
        notes,
        status,
        created_at,
        request_id,
        marketplace_requests (
          title,
          description,
          urgency
        )
      `)
      .eq('bidder_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setBids(data);
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading your bids...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">My Bids</h1>
            <p className="text-[var(--text3)]">Bids you have submitted on service requests</p>
          </div>
          <Link href="/marketplace/requests" className="btn btn-secondary">
            Browse Service Requests
          </Link>
        </div>

        {bids.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg mb-2">You haven’t placed any bids yet.</p>
            <Link href="/marketplace/requests" className="btn btn-primary mt-4">
              Browse Open Requests
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bids.map((bid) => (
              <div key={bid.id} className="card p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-xl mb-1">
                      {bid.marketplace_requests?.title || 'Service Request'}
                    </h3>
                    <p className="text-sm text-[var(--text3)] line-clamp-2 mb-3">
                      {bid.marketplace_requests?.description}
                    </p>

                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <div>
                        <span className="text-[var(--text3)]">Bid Amount:</span>{' '}
                        <span className="font-semibold text-[var(--gold)]">${bid.price}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text3)]">Status:</span>{' '}
                        <span className="capitalize font-medium">{bid.status}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text3)]">Submitted:</span>{' '}
                        {new Date(bid.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <Link 
                    href={`/marketplace/requests/${bid.request_id}`} 
                    className="btn btn-secondary text-sm whitespace-nowrap"
                  >
                    View Request
                  </Link>
                </div>

                {bid.notes && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm text-[var(--text3)] mb-1">Your Notes:</p>
                    <p className="text-sm">{bid.notes}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}