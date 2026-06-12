'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

export default function PartsCatalog() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">🔩 Parts Catalog</h1>
        <p className="text-sm text-[var(--text3)] mb-6">Search &amp; compatibility</p>

        <div className="card p-8 text-center">
          <div className="text-6xl mb-4">🚧</div>
          <div className="font-bold text-xl mb-2">Coming Soon</div>
          <p className="text-sm text-[var(--text3)] mb-4">
            The Parts Catalog with search, compatibility lookup, and ordering info is available in the Total Service Pro Android app.
          </p>
          <p className="text-sm text-[var(--text3)] mb-4">
            Web version coming soon (ported from <code>parts_catalog.html</code>).
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/hub" className="btn btn-primary">Back to Tech Hub</Link>
            <Link href="/" className="btn btn-secondary">Dashboard</Link>
          </div>
          <div className="mt-6 text-xs text-[var(--text3)]">
            Parts suppliers can sign up via the Parts Supplier flow. Full catalog port in progress.
          </div>
        </div>
      </div>
    </div>
  );
}
