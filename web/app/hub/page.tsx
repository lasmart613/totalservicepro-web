'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isOwnerish, isSupplier } from '@/lib/roles';
import { canAccessFinancialReporting } from '@/lib/financial-reporting-access';
import { canAccessJobCosting } from '@/lib/job-costing-access';
import { getOrgRole, reportingOrganizationId } from '@/lib/org-role';
import {
  businessManagementNavVisible,
  ORG_NAV_PENDING,
  orgNavFromLookup,
  type OrgNavState,
} from '@/lib/profile-nav';
import { fetchGodMe } from '@/lib/god-client';
import { ownerLabelKind } from '@/lib/labels';
import { hubDest } from '@/lib/no-org-route';
import { useT } from '@/lib/fa/locale';

type HubCard = { href: string; icon: string; label: string; desc: string };

export default function TechHub() {
  const t = useT();
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [role, setRole] = useState<string>('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [god, setGod] = useState(false);
  const [orgNav, setOrgNav] = useState<OrgNavState>(ORG_NAV_PENDING);

  useEffect(() => {
    (async () => {
      let lookedUp = false;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login?next=/hub');
          return;
        }
        let { data: prof, error: profErr } = await supabase
          .from('user_profiles')
          .select('role, organization_id, active_organization_id, organizations(type, facility_type)')
          .eq('id', user.id)
          .maybeSingle();
        if (profErr && /active_organization_id|column/i.test(profErr.message || '')) {
          const retry = await supabase
            .from('user_profiles')
            .select('role, organization_id, organizations(type, facility_type)')
            .eq('id', user.id)
            .maybeSingle();
          prof = retry.data;
          profErr = retry.error;
        }
        if (!profErr && hubDest(prof)) {
          router.replace('/onboarding');
          return;
        }
        const meta = user.user_metadata || {};
        setRole(prof?.role || meta.role || '');
        const looked = await getOrgRole(supabase, user.id, reportingOrganizationId(prof));
        setOrgNav(orgNavFromLookup(looked));
        lookedUp = true;
        const ot =
          (prof?.organizations as any)?.type ||
          (prof?.organizations as any)?.facility_type ||
          meta.organization_type ||
          null;
        setOrgType(ot);
        setGod(await fetchGodMe());
      } catch {
        if (!lookedUp) setOrgNav({ lookup: 'error', platformAdmin: false, orgPowerRole: '' });
      }
      setLoaded(true);
    })();
  }, [supabase]);

  const owner = isOwnerish(role, orgType);
  const supplier = isSupplier(role, orgType);
  const service = !owner && !supplier;
  const rentalOwner = owner && ownerLabelKind(orgType) === 'rental';
  const orgPowerRole = orgNav.orgPowerRole;
  const canBusiness =
    businessManagementNavVisible(orgNav) && (service || orgNav.platformAdmin);

  // Tech Hub = field / technical tools only (no CRM customers)
  const techCards: HubCard[] = owner
    ? [
        { href: '/my-lasers', icon: '⚡', label: 'My Lasers', desc: 'Inventory & laser profiles' },
        { href: '/company', icon: '🏢', label: 'Facility Profile', desc: 'Edit your clinic details, logo & contacts' },
        { href: '/manuals', icon: '📖', label: 'Operators Manuals', desc: 'Operators, IFU & user docs' },
        { href: '/service-requests', icon: '🛠️', label: 'Service Requests', desc: 'Request repair / PM for your systems' },
        { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Parts, used systems & consumables' },
        { href: '/reports', icon: '📋', label: 'Service History', desc: 'Completed work on your systems' },
        { href: '/directory', icon: '📒', label: 'TSP Directory', desc: 'Find service companies (free listings)' },
      ]
    : supplier
      ? [
          { href: '/parts', icon: '🔩', label: 'Parts Catalog', desc: 'Master list & listings' },
          { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Demand & your listings' },
          { href: '/marketplace/storefront', icon: '🏪', label: 'Seller storefront', desc: 'Public shop page & CSV/Excel inventory' },
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
          { href: '/manuals', icon: '📚', label: 'Service Manuals', desc: 'Service and Operators library tabs' },
          { href: '/reports', icon: '📋', label: 'Service Reports', desc: 'Performance & safety documentation' },
          { href: '/ai-assistant', icon: '🤖', label: 'AI Assistant', desc: 'Fault codes & manuals (same engine as mobile)' },
          { href: '/calculators', icon: '🔬', label: 'Photometry Tools', desc: 'Fluence, Irradiance, Duty Cycle, Avg Power, Wavelength' },
          { href: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Parts, used systems & consumables' },
          { href: '/directory', icon: '📒', label: 'TSP Directory', desc: 'Service cos, clinics & suppliers (free listings)' },
        ];

  // Business Management — CRM / money (permissioned roles only)
  // Android order: Customers, Estimates, Invoices (+ Company on web)
  // Financial reporting and job costing follow the membership role in the active org.
  const businessCards: HubCard[] = [
    ...(canBusiness
      ? [
          { href: '/customers', icon: '👥', label: 'Customers', desc: 'Directory & customer profiles' },
          { href: '/estimates', icon: '📝', label: 'Estimates', desc: 'Quotes & service estimates' },
          { href: '/invoices', icon: '🧾', label: 'Invoices', desc: 'Billing & collections' },
          { href: '/company', icon: '🏢', label: 'Company Profile', desc: 'Org settings, team & branding' },
        ]
      : []),
    ...(canAccessFinancialReporting({ role: orgPowerRole, god })
      ? [
          {
            href: '/business/financial-reporting',
            icon: '📊',
            label: 'Financial Reporting',
            desc: 'Income, collections, and unpaid invoices',
          },
        ]
      : []),
    ...(canAccessJobCosting({ role: orgPowerRole, god })
      ? [
          {
            href: '/business/job-costing',
            icon: '🧮',
            label: 'Job Costing',
            desc: 'Labor, parts, and margin per repair order',
          },
        ]
      : []),
  ];

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">{t('Loading…')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">
          {owner ? (rentalOwner ? t('My Lasers') : t('Owner Hub')) : supplier ? t('Supplier Hub') : `🛠️ ${t('Tech Hub')}`}
        </h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          {owner
            ? rentalOwner
              ? t('Fleet lasers, service requests, and history')
              : t('Facility tools & service history')
            : supplier
              ? t('Supplier catalog & marketplace tools')
              : t('Professional laser service resources & reference tools')}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {techCards.map((c, i) => (
            <Link key={i} href={c.href} className="card p-5 text-center hover:border-[var(--gold)]">
              <div className="text-4xl mb-2">{c.icon}</div>
              <div className="font-bold">{t(c.label)}</div>
              <div className="text-xs text-[var(--text3)] mt-1">{t(c.desc)}</div>
            </Link>
          ))}
        </div>

        {businessCards.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-extrabold mb-1">💼 {t('Business Management')}</h2>
            <p className="text-xs text-[var(--text3)] mb-4">
              {t('CRM and company operations (admins, managers, dispatchers, billing)')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {businessCards.map((c, i) => (
                <Link key={i} href={c.href} className="card p-5 text-center hover:border-[var(--gold)]">
                  <div className="text-4xl mb-2">{c.icon}</div>
                  <div className="font-bold">{t(c.label)}</div>
                  <div className="text-xs text-[var(--text3)] mt-1">{t(c.desc)}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-xs text-center text-[var(--text3)]">
          {t('Tech Hub = field & reference tools. Customers live under Business Management for authorized roles.')}
        </div>
      </div>
    </div>
  );
}
