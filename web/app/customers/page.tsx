'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

export default function Customers() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">👥 Customers</h1>
        <p className="text-sm text-[var(--text3)] mb-6">Directory &amp; profiles</p>

        <div className="card p-8 text-center">
          <div className="text-6xl mb-4">🚧</div>
          <div className="font-bold text-xl mb-2">Coming Soon</div>
          <p className="text-sm text-[var(--text3)] mb-4">
            Customer directory, profiles, equipment history, and laser system lists are available in the Total Service Pro Android app.
          </p>
          <p className="text-sm text-[var(--text3)] mb-4">
            Web version coming soon (ported from <code>customer_directory.html</code> and <code>customer_profile.html</code>).
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/hub" className="btn btn-primary">Back to Tech Hub</Link>
            <Link href="/" className="btn btn-secondary">Dashboard</Link>
          </div>
          <div className="mt-6 text-xs text-[var(--text3)]">
            In the meantime, use the Android app or the Marketplace to connect with owners.
          </div>
        </div>
      </div>
    </div>
  );
}
