'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { ListingDescriptionSnippet } from '@/components/ListingDescription';
import { GuestAwarePrice } from '@/components/marketplace/GuestAwarePrice';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { listingHref } from '@/lib/marketplace/guest';
import { formatListingPrice, partsDetailPath } from '@/lib/marketplace/parts';
import { GUEST_SIGNUP_HREF } from '@/lib/marketplace/guest';
import { useSignedIn } from '@/lib/use-signed-in';

type Seller = {
  name: string;
  slug: string;
  bio: string;
  logo_url: string | null;
  featured: boolean;
  href: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
};

type ListingCard = {
  id: string;
  title?: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  part_number?: string;
  condition?: string;
  images?: string[];
  quantity?: number | null;
  price_label?: string;
  availability?: { soldOut?: boolean };
};

export default function SellerStorefrontPage() {
  const params = useParams();
  const slug = String(params.slug || '');
  const { signedIn } = useSignedIn();
  const [loading, setLoading] = useState(true);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [listings, setListings] = useState<ListingCard[]>([]);

  useEffect(() => {
    if (!slug) return;
    const load = async () => {
      setLoading(true);
      try {
        const headers = await marketplaceAuthHeaders();
        const res = await fetch(`/api/marketplace/sellers/${encodeURIComponent(slug)}`, {
          cache: 'no-store',
          headers,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSeller(null);
          setListings([]);
          return;
        }
        setSeller(json.seller || null);
        setListings(Array.isArray(json.listings) ? json.listings : []);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading storefront…</div>
      </div>
    );
  }

  if (!seller) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-3xl mx-auto w-full px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-3">Storefront not found</h1>
          <p className="text-[var(--text3)] mb-6">This seller has not published a public storefront.</p>
          <Link href="/marketplace/parts" className="btn btn-primary">
            Back to Parts Marketplace
          </Link>
        </div>
      </div>
    );
  }

  const location = [seller.city, seller.state].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace/parts" className="text-[var(--gold)] hover:underline text-sm">
          ← Parts Marketplace
        </Link>
        <div className="card p-6 md:p-8 mt-4 mb-8 flex flex-col md:flex-row gap-6 items-start">
          {seller.logo_url ? (
            <img
              src={seller.logo_url}
              alt=""
              className="w-24 h-24 object-contain rounded border border-[var(--border)] bg-[var(--surface3)]"
            />
          ) : (
            <div className="w-24 h-24 rounded border border-[var(--border)] bg-[var(--surface3)] flex items-center justify-center text-2xl font-bold">
              {seller.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold">{seller.name}</h1>
              {seller.featured && (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[var(--gold)] text-black">
                  Featured seller
                </span>
              )}
            </div>
            {seller.bio && <p className="text-[var(--text2)] mt-2 whitespace-pre-wrap">{seller.bio}</p>}
            {location && <p className="text-sm text-[var(--text3)] mt-2">{location}</p>}
            <div className="mt-4 text-sm space-y-1">
              {signedIn ? (
                <>
                  {seller.website && (
                    <div>
                      <a
                        href={/^https?:\/\//i.test(seller.website) ? seller.website : `https://${seller.website}`}
                        className="text-[var(--gold)] hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Website
                      </a>
                    </div>
                  )}
                  {seller.email && <div>Email: {seller.email}</div>}
                  {seller.phone && <div>Phone: {seller.phone}</div>}
                  {!seller.website && !seller.email && !seller.phone && (
                    <p className="text-[var(--text3)]">Contact this seller from a listing (offer / checkout).</p>
                  )}
                </>
              ) : (
                <Link href={GUEST_SIGNUP_HREF} className="text-[var(--gold)] hover:underline">
                  Sign up to contact this seller
                </Link>
              )}
            </div>
          </div>
        </div>

        <h2 className="text-xl font-bold mb-4">Active parts</h2>
        {listings.length === 0 ? (
          <div className="card p-8 text-center text-[var(--text3)]">No active parts listings yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((l) => {
              const href = listingHref(signedIn, partsDetailPath(String(l.id)));
              const img = l.images?.[0];
              return (
                <div key={l.id} className="card p-6 text-left">
                  {img && (
                    <Link href={href}>
                      <img src={img} alt={l.title || 'Part'} className="w-full h-40 object-cover rounded mb-3" />
                    </Link>
                  )}
                  <Link href={href}>
                    <h3 className="font-bold text-xl mb-1 hover:text-[var(--gold)]">{l.title}</h3>
                  </Link>
                  <ListingDescriptionSnippet text={l.description} className="mb-1" />
                  <p className="text-sm text-[var(--text3)] mb-2">PN: {l.part_number || 'N/A'}</p>
                  <p className="text-sm mb-1">
                    {[l.manufacturer, l.model].filter(Boolean).join(' ')}
                    {l.condition ? ` • ${l.condition}` : ''}
                  </p>
                  <GuestAwarePrice
                    signedIn={signedIn}
                    priceLabel={l.price_label || formatListingPrice(l)}
                    className="font-semibold text-[var(--gold)] mb-3"
                  />
                  <Link href={href} className="btn btn-primary w-full text-sm">
                    {signedIn ? 'View details' : 'Sign up to view'}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
