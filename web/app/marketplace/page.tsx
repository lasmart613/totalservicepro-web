'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function Marketplace() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const fetchNotifications = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const notifs: any[] = [];

      // Recent bids on my listings
      const { data: myListings } = await supabase
        .from('marketplace_listings')
        .select('id, title')
        .eq('seller_id', user.id)
        .limit(5);

      if (myListings && myListings.length > 0) {
        const ids = myListings.map(l => l.id);
        const { data: recentBids } = await supabase
          .from('bids')
          .select('id, price, created_at, listing_id')
          .in('listing_id', ids)
          .order('created_at', { ascending: false })
          .limit(3);

        if (recentBids) {
          recentBids.forEach(bid => {
            const listing = myListings.find(l => l.id === bid.listing_id);
            notifs.push({
              id: `bid-${bid.id}`,
              message: `You received a bid of $${bid.price} on "${listing?.title || 'your listing'}"!`,
              time: new Date(bid.created_at).toLocaleDateString()
            });
          });
        }
      }

      // Example static notifications (easy to extend)
      notifs.push({
        id: 'posted',
        message: 'Your listing was posted successfully.',
        time: 'just now'
      });
      notifs.push({
        id: 'viewed',
        message: 'Your listing was viewed 5 times today!',
        time: 'today'
      });

      setNotifications(notifs.slice(0, 5)); // limit
    };

    fetchNotifications();
  }, [supabase]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Marketplace</h1>
            <p className="text-[var(--text3)]">Buy, sell, and connect in the laser service ecosystem</p>
          </div>

          <Link 
            href="/marketplace/list" 
            className="btn btn-primary whitespace-nowrap"
          >
            + Create New Listing
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {/* Parts */}
          <Link href="/marketplace/parts" className="card p-6 hover:border-[var(--gold)] group flex flex-col">
            <div className="text-4xl mb-4">🔩</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">Parts</h3>
            <p className="text-sm text-[var(--text3)] flex-1">Parts listed for sale by suppliers and companies</p>
          </Link>

          {/* Used Laser Systems */}
          <Link href="/marketplace/used-systems" className="card p-6 hover:border-[var(--gold)] group flex flex-col">
            <div className="text-4xl mb-4">🖥️</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">Used Laser Systems</h3>
            <p className="text-sm text-[var(--text3)] flex-1">Buy or sell pre-owned laser equipment</p>
          </Link>

          {/* Consumables */}
          <Link href="/marketplace/consumables" className="card p-6 hover:border-[var(--gold)] group flex flex-col">
            <div className="text-4xl mb-4">🧴</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">Consumables</h3>
            <p className="text-sm text-[var(--text3)] flex-1">Handpieces, fibers, tips, gels, and common consumables</p>
          </Link>

          {/* Service Requests */}
          <Link href="/marketplace/requests" className="card p-6 hover:border-[var(--gold)] group flex flex-col">
            <div className="text-4xl mb-4">🛠️</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">Service Requests</h3>
            <p className="text-sm text-[var(--text3)] flex-1">Post or browse service needs and emergency repairs</p>
          </Link>

          {/* My Bids - New */}
          <Link href="/bids" className="card p-6 hover:border-[var(--gold)] group flex flex-col border-2 border-[var(--gold)]/30">
            <div className="text-4xl mb-4">📋</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">My Bids</h3>
            <p className="text-sm text-[var(--text3)] flex-1">View and manage all bids you have submitted</p>
          </Link>

          {/* My Listings */}
          <Link href="/marketplace/my-listings" className="card p-6 hover:border-[var(--gold)] group flex flex-col">
            <div className="text-4xl mb-4">📝</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">My Listings</h3>
            <p className="text-sm text-[var(--text3)] flex-1">View and manage your own listings</p>
          </Link>
        </div>

        {/* Notifications Area under the cards. Easy to extend new ones. */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-3">Notifications</h2>
          {notifications.length === 0 ? (
            <p className="text-sm text-[var(--text3)]">No notifications yet.</p>
          ) : (
            <ul className="space-y-2">
              {notifications.map((n, idx) => (
                <li key={idx} className="text-sm bg-[var(--surface3)] p-3 rounded border-l-4 border-[var(--gold)]">
                  {n.message} <span className="text-xs text-[var(--text3)] ml-2">({n.time})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs mt-2 text-[var(--text3)]">To add new notification types in the future, extend the fetchNotifications logic or add a notifications table.</p>
        </div>

        <div className="mt-10 text-xs text-[var(--text3)]">
          Only items that have been actively listed for sale appear in the Marketplace.  
          The full Parts Catalog (reference) is available in the Tech Hub.
        </div>
      </div>
    </div>
  );
}