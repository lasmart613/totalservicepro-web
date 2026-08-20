'use client';

import Link from 'next/link';
import { listingOfferLoginHref } from '@/lib/marketplace-listings';

export function MarketplaceOfferCta({
  listingId,
  isLoggedIn,
  onStart,
}: {
  listingId: string;
  isLoggedIn: boolean;
  onStart: () => void;
}) {
  if (!isLoggedIn) {
    return (
      <Link href={listingOfferLoginHref(listingId)} className="btn btn-primary w-full text-sm">
        Make Offer / Bid
      </Link>
    );
  }

  return (
    <button type="button" onClick={onStart} className="btn btn-primary w-full text-sm">
      Make Offer / Bid
    </button>
  );
}
