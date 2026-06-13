'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../../components/Header';
import { Clock, ArrowLeft } from 'lucide-react';

export default function UsedSystems() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <Header />

      <div className="max-w-4xl mx-auto w-full px-4 py-20 text-center">
        <div className="inline-flex items-center gap-3 mb-8 text-[var(--gold)]">
          <Clock size={48} />
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight mb-6">Buy & Sell Used Laser Systems</h1>
        <p className="text-2xl text-[var(--text3)] max-w-2xl mx-auto">
          Full marketplace for pre-owned Candela, Lumenis, Cynosure, Alma, Cutera and more is coming very soon.
        </p>

        <div className="mt-12 card p-10 max-w-md mx-auto">
          <p className="text-lg mb-6">Get notified when the Used Equipment Marketplace launches.</p>
          <input 
            type="email" 
            placeholder="your@email.com" 
            className="input w-full mb-4" 
          />
          <button className="btn btn-primary w-full py-4">Notify Me</button>
        </div>

        <Link href="/marketplace" className="inline-flex items-center gap-2 text-[var(--gold)] mt-12 hover:underline">
          <ArrowLeft size={18} /> Back to Marketplace
        </Link>
      </div>
    </div>
  );
}