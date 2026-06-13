'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

export default function TechHub() {
  const cards = [
    { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Post service needs, receive bids, accept contracts (beta live)' },
    { href: '/service-schedule', icon: '📅', label: 'Service Schedule', desc: 'Tickets, assignments & scheduling' },
    { href: '/customers', icon: '👥', label: 'Customers', desc: 'Directory & customer profiles' },
    { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Search parts & compatibility' },
    { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Full digital bookshelf' },
    { href: '/reports', icon: '📋', label: 'Service Reports', desc: 'Performance & safety documentation' },
    { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', desc: 'Intelligent service guidance (beta)' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">🛠️ Tech Hub</h1>
        <p className="text-sm text-[var(--text3)] mb-6">Professional laser service resources</p>

        <div className="grid grid-cols-2 gap-3">
          {cards.map((c, i) => (
            <Link key={i} href={c.href} className="card p-5 text-center hover:border-[var(--gold)]">
              <div className="text-4xl mb-2">{c.icon}</div>
              <div className="font-bold">{c.label}</div>
              <div className="text-xs text-[var(--text3)] mt-1">{c.desc}</div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-xs text-center text-[var(--text3)]">Service Schedule, Customers, Parts &amp; AI Assistant are available as functional starters. Marketplace, Reports, Manuals &amp; Auth flows are production-ready. Full feature parity with Android ports in progress.</div>
      </div>
    </div>
  );
}
