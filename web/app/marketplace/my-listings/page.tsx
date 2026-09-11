'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import {
  formatListingPrice,
  isPartListing,
  listingImages,
  partsDetailPath,
  partsEditPath,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import { toast } from 'sonner';

type SellerListing = MarketplaceListingLike & {
  id: string;
  created_at?: string;
  images?: unknown;
  data?: Record<string, unknown>;
};

function listingTitle(listing: SellerListing): string {
  return (
    listing.title ||
    (listing.details && typeof listing.details === 'object'
      ? String((listing.details as { partNumber?: unknown }).partNumber || '')
      : '') ||
    listing.part_number ||
    'Untitled Listing'
  );
}

export default function MyListings() {
  const [listings, setListings] = useState<SellerListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  useEffect(() => {
    void fetchMyListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchMyListings = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const orgId = profile?.organization_id;

      let query = supabase
        .from('marketplace_listings')
        .select('*')
        .order('created_at', { ascending: false });
      if (orgId != null) {
        query = query.or(`seller_id.eq.${user.id},created_by.eq.${user.id},organization_id.eq.${orgId}`);
      } else {
        query = query.or(`seller_id.eq.${user.id},created_by.eq.${user.id}`);
      }
      const { data, error } = await query;
      let rows: SellerListing[] = !error && data ? (data as SellerListing[]) : [];

      if (!rows.length) {
        const headers = await marketplaceAuthHeaders();
        const res = await fetch('/api/marketplace/parts?mine=1', { cache: 'no-store', headers });
        const json = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(json?.listings)) {
          rows = json.listings as SellerListing[];
        }
      }

      setListings(rows);
    } catch {
      toast.error('Failed to load listings');
    } finally {
      setLoading(false);
    }
  };

  const removeListing = async (listing: SellerListing) => {
    if (!confirm('Remove this listing from the public marketplace? Past orders stay in history.')) {
      return;
    }
    setRemovingId(listing.id);
    try {
      if (isPartListing(listing)) {
        const headers = await marketplaceAuthHeaders();
        const res = await fetch(`/api/marketplace/parts/${encodeURIComponent(listing.id)}`, {
          method: 'DELETE',
          headers,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'Could not remove listing');
      } else {
        const { error } = await supabase
          .from('marketplace_listings')
          .update({ status: 'removed', updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        if (error) throw error;
      }
      setListings((prev) =>
        prev.map((item) => (item.id === listing.id ? { ...item, status: 'removed' } : item))
      );
      toast.success('Listing removed from the marketplace');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove listing');
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading your listings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">My Marketplace Listings</h1>
            <p className="text-sm text-[var(--text3)] mt-1">
              Edit or remove listings you posted, plus parts listed under your supplier organization.
            </p>
          </div>
          <Link href="/marketplace/list" className="btn btn-primary">
            + Create New Listing
          </Link>
        </div>

        {listings.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg mb-4">You don’t have any listings yet.</p>
            <Link href="/marketplace/list" className="btn btn-primary">
              Create Your First Listing
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {listings.map((listing) => {
              const photos = listingImages(listing);
              const removed = String(listing.status || '').toLowerCase() === 'removed';
              const viewHref = isPartListing(listing)
                ? partsDetailPath(listing.id)
                : `/marketplace/listing/${listing.id}`;
              return (
                <div key={listing.id} className="card p-6">
                  <div className="flex justify-between items-start mb-4 gap-4">
                    <div>
                      <span className="text-xs uppercase tracking-widest text-[var(--text3)]">
                        {(listing.listing_type || 'listing').toString().toUpperCase()}
                        {removed ? ' · REMOVED' : listing.status ? ` · ${String(listing.status).toUpperCase()}` : ''}
                      </span>
                      <h3 className="font-bold text-xl">{listingTitle(listing)}</h3>
                      {listing.part_number && (
                        <div className="font-mono text-sm text-[var(--text3)] mt-1">{listing.part_number}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Link href={viewHref} className="btn btn-primary text-sm px-4">
                        View
                      </Link>
                      {isPartListing(listing) && (
                        <Link href={partsEditPath(listing.id)} className="btn btn-secondary text-sm px-4">
                          Edit
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => removeListing(listing)}
                        disabled={removingId === listing.id || removed}
                        className="btn btn-secondary text-sm px-4 text-red-400"
                      >
                        {removingId === listing.id ? 'Removing…' : removed ? 'Removed' : 'Remove'}
                      </button>
                    </div>
                  </div>

                  <div className="text-sm text-[var(--text3)]">
                    {listing.description || 'No description provided.'}
                  </div>
                  <div className="text-sm font-semibold mt-2">{formatListingPrice(listing)}</div>

                  {photos.length > 0 && (
                    <div className="flex gap-3 mt-4">
                      {photos.slice(0, 4).map((url, idx) => (
                        <img key={`${url}-${idx}`} src={url} alt="listing" className="w-20 h-20 object-cover rounded border" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
