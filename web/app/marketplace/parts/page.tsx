'use client';

import React from 'react';
import { Header } from '../../../components/Header';

export default function PartsMarketplace() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <h1 className="text-3xl font-extrabold mb-2">Parts Marketplace</h1>
        <p className="text-[var(--text3)] mb-6">Parts currently listed for sale by suppliers and service companies.</p>

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