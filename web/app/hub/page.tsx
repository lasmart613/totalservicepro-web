'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isAdmin, isOwnerish, isSupplier } from '@/lib/roles';

type HubCard = { href: string; icon: string; label: string; desc: string };

export default function TechHub() {
  const supabase = getSupabaseClient();
  const [role, setRole] = useState<string>('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoaded(true);
          return;
        }
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('role, organization_id, organizations(type)')
          .eq('id', user.id)
          .maybeSingle();
        setRole(prof?.role || '');
        const ot = (prof?.organizations as any)?.type || null;
        setOrgType(ot);
      } catch {
        /* ignore */
      }
      setLoaded(true);
    })();
  }, [supabase]);

  const owner = isOwnerish(role, orgType);
  const supplier = isSupplier(role, orgType);
  const service = !owner && !supplier;
  const canBusiness =
    service &&
    (isAdmin(role) ||
      role === 'service_manager' ||
      role === 'dispatcher' ||
      role === 'scheduler' ||
      role === 'billing_manager');

  // Tech Hub = field / technical tools only (no CRM customers)
  const techCards: HubCard[] = owner
    ? [
        { href: '/my-lasers', icon: '⚡', label: 'My Lasers', desc: 'Facility equipment inventory' },
        { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Post needs & review bids' },
        { href: '/reports', icon: '📋', label: 'Service History', desc: 'Completed work on your systems' },
        { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Reference bookshelf' },
      ]
    : supplier
      ? [
          { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Master list & listings' },
          { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Demand & your listings' },
          { href: '/company', icon: '🏢', label: 'Supplier Profile', desc: 'Company & brands' },
        ]
      : [
          { href: '/service-schedule', icon: '📅', label: 'Service Schedule', desc: 'Tickets, assignments & scheduling' },
          { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Master list of parts, specs & cross-references' },
          { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Full digital bookshelf' },
          { href: '/reports', icon: '📋', label: 'Service Reports', desc: 'Performance & safety documentation' },
          { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', desc: 'Intelligent service guidance (beta)' },
          { href: '/calculators', icon: '🔬', label: 'Photometry Tools', desc: 'Fluence, Irradiance, Duty Cycle, Avg Power, Wavelength' },
          { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Bid on jobs & network demand' },
        ];

  // Business Management — CRM / money (permissioned roles only)
  const businessCards: HubCard[] = [
    { href: '/customers', icon: '👥', label: 'Customers', desc: 'Directory & customer profiles' },
    { href: '/company', icon: '🏢', label: 'Company Profile', desc: 'Org settings, team & branding' },
  ];

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">🛠️ Tech Hub</h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          {owner
            ? 'Facility tools & service history'
            : supplier
              ? 'Supplier catalog & marketplace tools'
              : 'Professional laser service resources & reference tools'}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {techCards.map((c, i) => (
            <Link key={i} href={c.href} className="card p-5 text-center hover:border-[var(--gold)]">
              <div className="text-4xl mb-2">{c.icon}</div>
              <div className="font-bold">{c.label}</div>
              <div className="text-xs text-[var(--text3)] mt-1">{c.desc}</div>
            </Link>
          ))}
        </div>

        {canBusiness && (
          <div className="mt-10">
            <h2 className="text-lg font-extrabold mb-1">💼 Business Management</h2>
            <p className="text-xs text-[var(--text3)] mb-4">
              CRM and company operations (admins, managers, dispatchers, billing)
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {businessCards.map((c, i) => (
                <Link key={i} href={c.href} className="card p-5 text-center hover:border-[var(--gold)]">
                  <div className="text-4xl mb-2">{c.icon}</div>
                  <div className="font-bold">{c.label}</div>
                  <div className="text-xs text-[var(--text3)] mt-1">{c.desc}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-xs text-center text-[var(--text3)]">
          Tech Hub = field &amp; reference tools. Customers live under Business Management for authorized roles.
        </div>
      </div>
    </div>
  );
}
