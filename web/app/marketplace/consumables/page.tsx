'use client';

import React from 'react';
import { Header } from '../../../components/Header';

export default function ConsumablesMarketplace() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <h1 className="text-3xl font-extrabold mb-2">Consumables Marketplace</h1>
        <p className="text-[var(--text3)] mb-6">Handpieces, fibers, tips, gels, and other consumables for sale.</p>

        <div className="card p-8 text-center">
          <p className="text-lg mb-4">Search and listings coming soon.</p>
          <p className="text-sm text-[var(--text3)]">
            Available to FSEs, Laser Owners, and Parts Suppliers.
          </p>
        </div>
      </div>
    </div>
  );
}