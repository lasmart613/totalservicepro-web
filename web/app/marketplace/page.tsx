import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

export default function Marketplace() {
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
        </div>

        <div className="mt-10 text-xs text-[var(--text3)]">
          Only items that have been actively listed for sale appear in the Marketplace.  
          The full Parts Catalog (reference) is available in the Tech Hub.
        </div>
      </div>
    </div>
  );
}