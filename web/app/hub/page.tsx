'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isAdmin, isOwnerish, isSupplier } from '@/lib/roles';
import { ownerLabelKind } from '@/lib/labels';

type HubCard = { href: string; icon: string; label: string; desc: string };

export default function TechHub() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [role, setRole] = useState<string>('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login?next=/hub');
          return;
        }
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('role, organization_id, organizations(type, facility_type)')
          .eq('id', user.id)
          .maybeSingle();
        const meta = user.user_metadata || {};
        setRole(prof?.role || meta.role || '');
        const ot =
          (prof?.organizations as any)?.type ||
          (prof?.organizations as any)?.facility_type ||
          meta.organization_type ||
          null;
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
  const rentalOwner = owner && ownerLabelKind(orgType) === 'rental';
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
        { href: '/my-lasers', icon: '⚡', label: 'My Lasers', desc: 'Inventory & laser profiles' },
        { href: '/company', icon: '🏢', label: 'Facility Profile', desc: 'Edit your clinic details, logo & contacts' },
        { href: '/service-requests', icon: '🛠️', label: 'Service Requests', desc: 'Request repair / PM for your systems' },
        { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Parts, used systems & consumables' },
        { href: '/reports', icon: '📋', label: 'Service History', desc: 'Completed work on your systems' },
        { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Reference bookshelf' },
        { href: '/directory', icon: '📒', label: 'TSP Directory', desc: 'Find service companies (free listings)' },
      ]
    : supplier
      ? [
          { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Master list & listings' },
          { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Demand & your listings' },
          { href: '/company', icon: '🏢', label: 'Supplier Profile', desc: 'Company & brands' },
          { href: '/directory', icon: '📒', label: 'TSP Directory', desc: 'Listed organizations (free)' },
        ]
      : [
          { href: '/service-schedule', icon: '📅', label: 'Service Schedule', desc: 'Tickets, assignments & scheduling' },
          { href: '/service-requests', icon: '🛠️', label: 'Repair Requests', desc: 'Open laser repair jobs from clinics' },
          { href: '/bids', icon: '📝', label: 'My Bids', desc: 'View, edit, or withdraw your submitted bids' },
          { href: '/accepted-bids', icon: '✓', label: 'Accepted Bids', desc: 'Jobs you won + customer contacts' },
          { href: '/test-equipment', icon: '🔧', label: 'Test Equipment', desc: 'Meters by org, owner, and assigned FSE' },
          { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Master list of parts, specs & cross-references' },
          { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Full digital bookshelf' },
          { href: '/reports', icon: '📋', label: 'Service Reports', desc: 'Performance & safety documentation' },
          { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', desc: 'Fault codes & manuals (same engine as mobile)' },
          { href: '/calculators', icon: '🔬', label: 'Photometry Tools', desc: 'Fluence, Irradiance, Duty Cycle, Avg Power, Wavelength' },
          { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Parts, used systems & consumables' },
          { href: '/directory', icon: '📒', label: 'TSP Directory', desc: 'Service cos, clinics & suppliers (free listings)' },
        ];

  // Business Management — CRM / money (permissioned roles only)
  // Android order: Customers, Estimates, Invoices (+ Company on web)
  const businessCards: HubCard[] = [
    { href: '/customers', icon: '👥', label: 'Customers', desc: 'Directory & customer profiles' },
    { href: '/estimates', icon: '📝', label: 'Estimates', desc: 'Quotes & service estimates' },
    { href: '/invoices', icon: '🧾', label: 'Invoices', desc: 'Billing & collections' },
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
        <h1 className="text-2xl font-extrabold mb-1">
          {owner ? (rentalOwner ? 'My Lasers' : 'Owner Hub') : supplier ? 'Supplier Hub' : '🛠️ Tech Hub'}
        </h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          {owner
            ? rentalOwner
              ? 'Fleet lasers, service requests, and history'
              : 'Facility tools & service history'
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
