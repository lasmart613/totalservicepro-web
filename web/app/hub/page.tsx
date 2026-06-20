'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';

export default function TechHub() {
  const cards = [
    { href: '/service-schedule', icon: '📅', label: 'Service Schedule', desc: 'Tickets, assignments & scheduling' },
    { href: '/customers', icon: '👥', label: 'Customers', desc: 'Directory & customer profiles' },
    { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Master list of parts, specs & cross-references' },
    { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Full digital bookshelf' },
    { href: '/reports', icon: '📋', label: 'Service Reports', desc: 'Performance & safety documentation' },
    { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', desc: 'Intelligent service guidance (beta)' },
    { href: '/calculators', icon: '🔬', label: 'Photometry Tools', desc: 'Fluence, Irradiance, Duty Cycle, Avg Power, Wavelength calculators' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">🛠️ Tech Hub</h1>
        <p className="text-sm text-[var(--text3)] mb-6">Professional laser service resources & reference tools</p>

        <div className="grid grid-cols-2 gap-3">
          {cards.map((c, i) => (
            <Link key={i} href={c.href} className="card p-5 text-center hover:border-[var(--gold)]">
              <div className="text-4xl mb-2">{c.icon}</div>
              <div className="font-bold">{c.label}</div>
              <div className="text-xs text-[var(--text3)] mt-1">{c.desc}</div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-xs text-center text-[var(--text3)]">
          Parts Catalog = Reference tool (master list).  
          Marketplace (buying/selling) is now on the Home page.
        </div>
      </div>
    </div>
  );
}