import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

interface MarketplacePageProps {
  searchParams: {
    type?: 'part' | 'used' | 'request';
  };
}

export default function MarketplacePage({ searchParams }: MarketplacePageProps) {
  const preselectedType = searchParams.type || null;

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
            href={`/marketplace/list${preselectedType ? `?type=${preselectedType}` : ''}`} 
            className="btn btn-primary whitespace-nowrap"
          >
            + Create New Listing
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link href="/marketplace/parts" className="card p-6 hover:border-[var(--gold)] group">
            <div className="flex items-start gap-4">
              <div className="text-4xl">🔩</div>
              <div className="flex-1">
                <h3 className="font-bold text-xl mb-1 group-hover:text-[var(--gold)]">Parts</h3>
                <p className="text-sm text-[var(--text3)]">Parts listed for sale by suppliers and companies</p>
              </div>
            </div>
          </Link>

          <Link href="/marketplace/used-systems" className="card p-6 hover:border-[var(--gold)] group">
            <div className="flex items-start gap-4">
              <div className="text-4xl">🖥️</div>
              <div className="flex-1">
                <h3 className="font-bold text-xl mb-1 group-hover:text-[var(--gold)]">Used Laser Systems</h3>
                <p className="text-sm text-[var(--text3)]">Buy or sell pre-owned laser equipment</p>
              </div>
            </div>
          </Link>

          <Link href="/marketplace/consumables" className="card p-6 hover:border-[var(--gold)] group">
            <div className="flex items-start gap-4">
              <div className="text-4xl">🧴</div>
              <div className="flex-1">
                <h3 className="font-bold text-xl mb-1 group-hover:text-[var(--gold)]">Consumables</h3>
                <p className="text-sm text-[var(--text3)]">Handpieces, fibers, tips, gels, and common consumables</p>
              </div>
            </div>
          </Link>

          <Link href="/marketplace/requests" className="card p-6 hover:border-[var(--gold)] group">
            <div className="flex items-start gap-4">
              <div className="text-4xl">🛠️</div>
              <div className="flex-1">
                <h3 className="font-bold text-xl mb-1 group-hover:text-[var(--gold)]">Service Requests / Needs</h3>
                <p className="text-sm text-[var(--text3)]">Post or browse service needs and emergency repairs</p>
              </div>
            </div>
          </Link>
        </div>

        <div className="mt-10 text-xs text-[var(--text3)]">
          Only items that have been actively listed for sale appear in the Marketplace.  
          The full Parts Catalog (reference) is available in the Tech Hub.
        </div>
      </div>
    </div>
  );
}