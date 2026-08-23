'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ListingDescriptionSnippet } from '@/components/ListingDescription';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  EMPTY_PARTS_FILTERS,
  filterPartsListings,
  formatListingPrice,
  isPartListing,
  listingAvailability,
  listingBrand,
  listingCondition,
  listingImages,
  listingPartCategory,
  listingQuantity,
  partsDetailPath,
  partsFiltersActive,
  uniqueSortedLabels,
  type MarketplaceListingLike,
  type PartsCatalogFilters,
} from '@/lib/marketplace/parts';
import { listingHref } from '@/lib/marketplace/guest';
import { GuestAwarePrice } from '@/components/marketplace/GuestAwarePrice';
import { useSignedIn } from '@/lib/use-signed-in';
import { toast } from 'sonner';

export default function PartsMarketplace() {
  const [listings, setListings] = useState<MarketplaceListingLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<PartsCatalogFilters>(EMPTY_PARTS_FILTERS);
  const [biddingOn, setBiddingOn] = useState<MarketplaceListingLike | null>(null);
  const [bidPrice, setBidPrice] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [bidQuestion, setBidQuestion] = useState('');
  const { signedIn } = useSignedIn();
  const supabase = getSupabaseClient();

  useEffect(() => {
    const fetchListings = async () => {
      setLoading(true);
      let { data, error } = await supabase
        .from('marketplace_listings')
        .select('*')
        .or('listing_type.eq.part,listing_type.eq.parts')
        .order('created_at', { ascending: false });
      if (error) {
        const retry = await supabase
          .from('marketplace_listings')
          .select('*')
          .eq('listing_type', 'part')
          .order('created_at', { ascending: false });
        data = retry.data;
        error = retry.error;
      }
      let rows: MarketplaceListingLike[] = !error && data ? data.filter(isPartListing) : [];
      if (rows.length === 0) {
        try {
          const res = await fetch('/api/marketplace/parts', { cache: 'no-store' });
          const json = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(json?.listings)) {
            rows = json.listings.filter(isPartListing) as MarketplaceListingLike[];
          }
        } catch (e) {
          console.warn('public parts catalog fallback', e);
        }
      }
      setListings(rows);
      setLoading(false);
    };
    void fetchListings();
  }, [supabase]);

  const brands = useMemo(() => uniqueSortedLabels(listings.map(listingBrand)), [listings]);
  const categories = useMemo(() => uniqueSortedLabels(listings.map(listingPartCategory)), [listings]);
  const conditions = useMemo(() => uniqueSortedLabels(listings.map(listingCondition)), [listings]);
  const filtered = useMemo(() => filterPartsListings(listings, filters), [listings, filters]);
  const filtersOn = partsFiltersActive(filters);

  const setFilter = <K extends keyof PartsCatalogFilters>(key: K, value: PartsCatalogFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
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
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">Parts Marketplace</h1>
            <p className="text-[var(--text3)]">Parts currently listed for sale</p>
          </div>
          <Link href="/marketplace/list?type=part" className="btn btn-primary whitespace-nowrap">
            + Create New Listing
          </Link>
        </div>

        <div className="card p-4 md:p-5 mb-6 text-left">
          <label className="label" htmlFor="parts-search">Search</label>
          <input
            id="parts-search"
            className="input mb-4"
            type="search"
            placeholder="Search title, SKU, brand, or description"
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="label" htmlFor="parts-brand">Brand</label>
              <select
                id="parts-brand"
                className="input"
                value={filters.brand}
                onChange={(e) => setFilter('brand', e.target.value)}
              >
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="parts-category">Category</label>
              <select
                id="parts-category"
                className="input"
                value={filters.category}
                onChange={(e) => setFilter('category', e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="parts-condition">Condition</label>
              <select
                id="parts-condition"
                className="input"
                value={filters.condition}
                onChange={(e) => setFilter('condition', e.target.value)}
              >
                <option value="">All conditions</option>
                {conditions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="parts-price">Price</label>
              <select
                id="parts-price"
                className="input"
                value={filters.price}
                onChange={(e) => setFilter('price', e.target.value as PartsCatalogFilters['price'])}
              >
                <option value="all">Any price</option>
                <option value="lt250">Under $250</option>
                <option value="250to1000">$250 – $1,000</option>
                <option value="1000to5000">$1,000 – $5,000</option>
                <option value="gt5000">$5,000+</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="parts-avail">Availability</label>
              <select
                id="parts-avail"
                className="input"
                value={filters.availability}
                onChange={(e) => setFilter('availability', e.target.value as PartsCatalogFilters['availability'])}
              >
                <option value="all">All listings</option>
                <option value="in_stock">In stock</option>
                <option value="sold_out">Sold out</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-sm text-[var(--text3)]">
            <span>
              {listings.length === 0
                ? 'No listings yet'
                : `Showing ${filtered.length} of ${listings.length}`}
            </span>
            {filtersOn && (
              <button type="button" className="btn btn-secondary text-sm py-1 px-3" onClick={() => setFilters(EMPTY_PARTS_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="card p-8 text-center">
          {listings.length === 0 ? (
          <p className="text-lg mb-4">No listings yet.</p>
        ) : filtered.length === 0 ? (
          <p className="text-lg mb-4">No parts match that search or filter.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((l) => {
              const imgs = listingImages(l);
              const featured = imgs[0];
              const href = listingHref(signedIn, partsDetailPath(l.id!));
              const avail = listingAvailability(l);
              const qty = listingQuantity(l);
              const category = listingPartCategory(l);
              return (
                <div key={l.id} className="card p-6 text-left">
                  {featured && (
                    <Link href={href}>
                      <img src={featured} alt={l.title || 'Part'} className="w-full h-40 object-cover rounded mb-3 cursor-pointer" />
                    </Link>
                  )}
                  <Link href={href}>
                    <h3 className="font-bold text-xl mb-1 hover:text-[var(--gold)] cursor-pointer">{l.title}</h3>
                  </Link>
                  {category && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gold)] mb-1">{category}</p>
                  )}
                  <ListingDescriptionSnippet text={l.description} className="mb-1" />
                  <p className="text-sm text-[var(--text3)] mb-2">PN: {l.part_number || l.serial_number || 'N/A'}</p>
                  <p className="text-sm mb-1">{l.manufacturer} {l.model} • {l.condition}</p>
                  <GuestAwarePrice signedIn={signedIn} priceLabel={formatListingPrice(l)} className="font-semibold text-[var(--gold)] mb-1" />
                  {avail.soldOut ? (
                    <div className="text-xs text-red-400 mb-3">Sold out</div>
                  ) : qty != null ? (
                    <div className="text-xs text-[var(--text3)] mb-3">{qty} available</div>
                  ) : (
                    <div className="mb-3" />
                  )}
                  <Link href={href} className="btn btn-primary w-full text-sm mb-2">
                    {signedIn ? 'View details' : 'Sign up to view'}
                  </Link>
                  {signedIn ? (
                  <button 
                    onClick={() => { setBiddingOn(l); setBidPrice(''); setBidNotes(''); setBidQuestion(''); }} 
                    className="btn btn-secondary w-full text-sm"
                  >
                    Make Offer / Bid
                  </button>
                  ) : (
                    <Link href={href} className="btn btn-secondary w-full text-sm">
                      Sign up to offer
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