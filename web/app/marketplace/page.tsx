'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { canPostMarketplaceNeed, isOwnerish, isPro, isSupplier } from '@/lib/roles';

export default function Marketplace() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [userRole, setUserRole] = useState('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const fetchNotifications = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', user.id)
        .maybeSingle();
      setUserRole(prof?.role || '');
      if (prof?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('type')
          .eq('id', prof.organization_id)
          .maybeSingle();
        setOrgType(org?.type || null);
      }

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

      // Real view counts from your listings (functional counter)
      const { data: myListingsWithViews } = await supabase
        .from('marketplace_listings')
        .select('id, title, views')
        .eq('seller_id', user.id)
        .order('views', { ascending: false })
        .limit(3);

      if (myListingsWithViews) {
        myListingsWithViews.forEach(l => {
          const v = l.views || 0;
          if (v > 0) {
            notifs.push({
              id: `viewed-${l.id}`,
              message: `Your listing "${l.title}" was viewed ${v} time${v === 1 ? '' : 's'}!`,
              time: 'total'
            });
          }
        });
      }

      setNotifications(notifs.slice(0, 5)); // limit
    };

    fetchNotifications();
  }, [supabase]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Marketplace</h1>
            <p className="text-[var(--text3)]">Buy, sell, and connect in the laser service ecosystem</p>
          </div>

          {(isPro(userRole) || isSupplier(userRole, orgType)) && (
            <Link
              href={
                isSupplier(userRole, orgType)
                  ? '/marketplace/list?type=part'
                  : '/marketplace/list'
              }
              className="btn btn-primary whitespace-nowrap"
            >
              + Create New Listing
            </Link>
          )}
          {canPostMarketplaceNeed(userRole, orgType) && !isPro(userRole) && (
            <Link href="/service-requests" className="btn btn-primary whitespace-nowrap">
              Post Service Request
            </Link>
          )}
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

          {/* Service section lives outside marketplace sales lanes */}
          <Link href="/service-requests" className="card p-6 hover:border-[var(--gold)] group flex flex-col">
            <div className="text-4xl mb-4">🛠️</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">Service Requests</h3>
            <p className="text-sm text-[var(--text3)] flex-1">
              Dedicated repair / PM board (not a marketplace listing). Owners post from My Lasers or here.
            </p>
          </Link>

          {!isOwnerish(userRole, orgType) && (
          <Link href="/bids" className="card p-6 hover:border-[var(--gold)] group flex flex-col border-2 border-[var(--gold)]/30">
            <div className="text-4xl mb-4">📋</div>
            <h3 className="font-bold text-xl mb-2 group-hover:text-[var(--gold)]">My Bids</h3>
            <p className="text-sm text-[var(--text3)] flex-1">View and manage all bids you have submitted</p>
          </Link>
          )}

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
        </div>

        <div className="mt-10 text-xs text-[var(--text3)]">
          Only items that have been actively listed for sale appear in the Marketplace.  
          The full Parts Catalog (reference) is available in the Tech Hub.
        </div>
      </div>
    </div>
  );
}