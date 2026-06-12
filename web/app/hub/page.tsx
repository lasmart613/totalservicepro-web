'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

export default function TechHub() {
  const cards = [
    { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Post needs, bid/respond, accept contracts (beta live)' },
    { href: '/service-schedule', icon: '📅', label: 'Service Schedule', desc: 'Tickets & assignments' },
    { href: '/customers', icon: '👥', label: 'Customers', desc: 'Directory & profiles' },
    { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Search & compatibility' },
    { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Full bookshelf' },
    { href: '/reports', icon: '📋', label: 'Service Reports', desc: 'Performance & safety docs' },
    { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', desc: 'Intelligent service guidance (coming soon)' },
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

        <div className="mt-8 text-xs text-center text-[var(--text3)]">Additional pages (Service Schedule, Customers, Parts, AI Assistant) now have placeholders. Full ports from the Android assets (service_schedule.html, customer_directory.html, parts_catalog.html, ai_assistant.html) coming soon. Current focus: Marketplace + Reports + Manuals + Auth.</div>
      </div>
    </div>
  );
}
