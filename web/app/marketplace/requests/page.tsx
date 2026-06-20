'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ServiceRequestsMarketplace() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from('marketplace_requests')
      .select(`
        *,
        bids(count)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRequests(data);
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading service requests...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Service Requests</h1>
            <p className="text-[var(--text3)]">Browse open service needs and submit bids</p>
          </div>
          <Link href="/marketplace/list?type=request" className="btn btn-primary">
            + Create New Listing
          </Link>
        </div>

        {requests.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg mb-2">No service requests found yet.</p>
            <p className="text-sm text-[var(--text3)]">Be the first to post a need.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {requests.map((req) => {
              const bidCount = req.bids?.[0]?.count || 0;

              return (
                <div key={req.id} className="card p-6">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-xl line-clamp-2">{req.title || req.description?.substring(0, 80)}</h3>
                      <p className="text-sm text-[var(--text3)] mt-1">
                        Urgency: <span className="font-medium">{req.urgency}</span>
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-[var(--surface3)] text-[var(--text3)]">
                      {new Date(req.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <p className="text-sm line-clamp-3 mb-4">{req.description}</p>

                  {(req.manufacturer || req.model) && (
                    <p className="text-sm mb-3">
                      <span className="text-[var(--text3)]">Equipment:</span> {req.manufacturer} {req.model}
                    </p>
                  )}

                  {/* Bid Count */}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="text-sm">
                      <span className="font-medium text-[var(--gold)]">{bidCount}</span>{' '}
                      <span className="text-[var(--text3)]">bid{bidCount !== 1 ? 's' : ''}</span>
                    </div>

                    <div className="flex gap-3">
                      <Link 
                        href={`/marketplace/requests/${req.id}`} 
                        className="btn btn-secondary text-sm"
                      >
                        View Details
                      </Link>
                      <Link 
                        href={`/marketplace/requests/${req.id}`} 
                        className="btn btn-primary text-sm"
                      >
                        Bid Now
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}