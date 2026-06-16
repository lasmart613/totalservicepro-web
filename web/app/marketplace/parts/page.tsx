'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../../components/Header';
import { getSupabaseClient } from '../../../lib/supabase/client';

export default function PartsMarketplace() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Parts Marketplace</h1>
            <p className="text-[var(--text3)]">Parts currently listed for sale</p>
          </div>
          <Link href="/marketplace/list?type=part" className="btn btn-primary">
            + Create New Listing
          </Link>
        </div>

        <div className="card p-8 text-center">
          <p className="text-lg mb-4">Search, filters, and listings coming soon.</p>
          <p className="text-sm text-[var(--text3)]">
            This section will only show parts that have been actively listed for sale.
          </p>
        </div>
      </div>
    </div>
  );
}