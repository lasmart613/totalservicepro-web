'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

export default function Marketplace() {
  const [searchTerm, setSearchTerm] = useState('');
  const supabase = getSupabaseClient();

  // TODO: Replace with real role check from user_profiles + organizations.type
  const userRole = 'fse'; // placeholder for now

  const categories = [
    {
      title: 'Parts',
      desc: 'Parts listed for sale by suppliers and companies',
      href: '/marketplace/parts',
      icon: '🔩',
      roles: ['fse', 'parts_supplier'],
    },
    {
      title: 'Used Laser Systems',
      desc: 'Buy or sell pre-owned laser equipment',
      href: '/marketplace/used-systems',
      icon: '🖥️',
      roles: ['fse', 'owner'],
    },
    {
      title: 'Consumables',
      desc: 'Handpieces, fibers, tips, gels, and common consumables',
      href: '/marketplace/consumables',
      icon: '🧴',
      roles: ['fse', 'owner', 'parts_supplier'],
    },
    {
      title: 'Service Requests / Needs',
      desc: 'Post or browse service needs and emergency repairs',
      href: '/marketplace/requests',
      icon: '🛠️',
      roles: ['fse', 'owner'],
    },
  ];

  const visibleCategories = categories.filter(cat =>
    cat.roles.includes(userRole)
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold">Marketplace</h1>
            <p className="text-[var(--text3)]">Buy, sell, and connect in the laser service ecosystem</p>
          </div>

          <div className="w-full md:w-80">
            <input
              type="text"
              placeholder="Search marketplace..."
              className="input w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visibleCategories.map((cat, index) => (
            <Link
              key={index}
              href={cat.href}
              className="card p-6 hover:border-[var(--gold)] transition-colors group"
            >
              <div className="flex items-start gap-4">
                <div className="text-4xl">{cat.icon}</div>
                <div className="flex-1">
                  <h3 className="font-bold text-xl mb-1 group-hover:text-[var(--gold)]">{cat.title}</h3>
                  <p className="text-sm text-[var(--text3)]">{cat.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-10 text-xs text-[var(--text3)]">
          Parts shown in the marketplace are only items currently listed for sale. 
          The full Parts Catalog (reference) is available in the Tech Hub.
        </div>
      </div>
    </div>
  );
}