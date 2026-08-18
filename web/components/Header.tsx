'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '../lib/supabase/client';
import { User } from '@supabase/supabase-js';
import {
  LogOut,
  User as UserIcon,
  Settings,
  Building2,
  Menu,
  X,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { isOwnerish, isSupplier, isAdmin } from '@/lib/roles';
import { ownerHubNavLabel, ownerProfileLabel, roleLabel } from '@/lib/labels';

type NavLink = { href: string; label: string };
type NavGroup = { id: string; label: string; href?: string; items: NavLink[] };

function NavDropdown({
  group,
  openId,
  setOpenId,
}: {
  group: NavGroup;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  const open = openId === group.id;
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeave = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const onEnter = () => {
    clearLeave();
    setOpenId(group.id);
  };

  const onLeave = () => {
    clearLeave();
    leaveTimer.current = setTimeout(() => setOpenId(null), 140);
  };

  return (
    <div className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {group.href ? (
        <Link
          href={group.href}
          className="inline-flex items-center gap-1 hover:text-[var(--gold)] py-1"
          onFocus={() => setOpenId(group.id)}
        >
          {group.label}
          <ChevronDown size={14} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Link>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-[var(--gold)] py-1 bg-transparent border-0 text-inherit font-medium cursor-pointer"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpenId(open ? null : group.id)}
        >
          {group.label}
          <ChevronDown size={14} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && group.items.length > 0 && (
        <div
          className="absolute left-0 top-full pt-2 z-[100]"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          <div className="min-w-[200px] rounded-xl border border-[var(--gold)] bg-[var(--surface3)] shadow-xl overflow-hidden py-1">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block px-4 py-2.5 text-sm text-[var(--text2)] hover:bg-[var(--surface)] hover:text-[var(--gold)]"
                onClick={() => setOpenId(null)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ authPending = false }: { authPending?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navOpenId, setNavOpenId] = useState<string | null>(null);
  const [mobileOpenGroup, setMobileOpenGroup] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const supabase = getSupabaseClient();

  async function refreshUnread(uid: string) {
    try {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('is_read', false);
      setUnread(count || 0);
      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        try {
          if (count && count > 0) (navigator as any).setAppBadge(count);
          else (navigator as any).clearAppBadge?.();
        } catch {
          /* ignore */
        }
      }
    } catch {
      setUnread(0);
    }
  }

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      setUser(u);

      if (u) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('first_name, last_name, role, organizations(name, type, facility_type)')
          .eq('id', u.id)
          .maybeSingle();
        setProfile(prof);
        await refreshUnread(u.id);
      }
      setLoading(false);
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        setUser(null);
        setProfile(null);
        setUnread(0);
        return;
      }
      setUser(session.user);
      if (session?.user) {
        supabase
          .from('user_profiles')
          .select('first_name, last_name, role, organizations(name, type, facility_type)')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(({ data }) => setProfile(data));
        refreshUnread(session.user.id);
      } else {
        setProfile(null);
        setUnread(0);
      }
    });

    const t = setInterval(() => {
      supabase.auth.getUser().then(({ data: { user: u } }) => {
        if (u) refreshUnread(u.id);
      });
    }, 45000);

    return () => {
      subscription.unsubscribe();
      clearInterval(t);
    };
  }, [supabase]);

  // Close nav dropdown on outside click / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpenId(null);
        setDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleLogout = async () => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    setUser(null);
    setProfile(null);
    setUnread(0);
    try {
      await supabase.auth.signOut();
    } catch {
      /* still leave */
    }
    window.location.replace('/login');
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    setMobileOpenGroup(null);
  };

  const meta = user?.user_metadata || {};
  const firstName = profile?.first_name || meta.first_name || '';
  const lastName = profile?.last_name || meta.last_name || '';
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') ||
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    user?.email?.split('@')[0] ||
    'User';

  const initials =
    ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() ||
    (user?.email?.[0] || 'U').toUpperCase();

  const orgType =
    (profile?.organizations as any)?.type ||
    meta.organization_type ||
    null;
  const facilityType = (profile?.organizations as any)?.facility_type || meta.facility_type || null;
  const orgName = String((profile?.organizations as any)?.name || '').trim();
  const chipLabel = orgName || fullName;
  const effectiveRole = profile?.role || meta.role;
  const ownerMode = isOwnerish(effectiveRole, orgType);
  const supplierMode = isSupplier(effectiveRole, orgType);
  const companyLabel = ownerMode
    ? ownerProfileLabel(orgType, facilityType, meta.organization_type)
    : supplierMode
      ? 'Supplier Profile'
      : 'Company Profile';
  const showServiceNav = !ownerMode && !supplierMode;
  const canBusinessNav =
    showServiceNav &&
    (isAdmin(profile?.role) ||
      ['service_manager', 'dispatcher', 'scheduler', 'billing_manager'].includes(
        (profile?.role || '').toLowerCase()
      ));
  const canAdminPortal = isAdmin(profile?.role);

  /** Primary hub dropdown — role-aware */
  const hubGroup: NavGroup = ownerMode
    ? {
        id: 'hub',
        label: ownerHubNavLabel(orgType, facilityType, meta.organization_type),
        href: '/my-lasers',
        items: [
          { href: '/my-lasers', label: 'My Lasers' },
          { href: '/service-requests', label: 'Service Requests' },
          { href: '/accepted-bids', label: 'Accepted Bids' },
          { href: '/reports', label: 'Service History' },
          { href: '/directory', label: 'TSP Directory' },
        ],
      }
    : supplierMode
      ? {
          id: 'hub',
          label: 'Supplier Hub',
          href: '/parts',
          items: [
            { href: '/parts', label: 'Parts Catalog' },
            { href: '/marketplace/parts', label: 'Parts Marketplace' },
            { href: '/marketplace/consumables', label: 'Consumables' },
            { href: '/marketplace/my-listings', label: 'My Listings' },
            { href: '/directory', label: 'TSP Directory' },
          ],
        }
      : {
          id: 'hub',
          label: 'Tech Hub',
          href: '/hub',
          items: [
            { href: '/hub', label: 'Hub Home' },
            { href: '/service-schedule', label: 'Service Schedule' },
            { href: '/manuals', label: 'Service Manuals' },
            { href: '/reports', label: 'Service Reports' },
            { href: '/service-requests', label: 'Repair Jobs' },
            { href: '/bids', label: 'My Bids' },
            { href: '/accepted-bids', label: 'Accepted Bids' },
            { href: '/test-equipment', label: 'Test Equipment' },
            { href: '/calculators', label: 'Photometry Tools' },
            { href: '/ai-assistant', label: 'AI Assistant' },
            { href: '/directory', label: 'TSP Directory' },
          ],
        };

  const marketplaceGroup: NavGroup = {
    id: 'marketplace',
    label: 'Marketplace',
    href: '/marketplace',
    items: [
      { href: '/marketplace', label: 'Marketplace Home' },
      { href: '/marketplace/used-systems', label: 'Used Equipment' },
      { href: '/marketplace/parts', label: 'Parts' },
      { href: '/marketplace/consumables', label: 'Consumables' },
      { href: '/service-requests', label: 'Service Requests' },
      { href: '/marketplace/my-listings', label: 'My Listings' },
      { href: '/marketplace/list', label: 'Post a Listing' },
    ],
  };

  const businessGroup: NavGroup | null = canBusinessNav
    ? {
        id: 'business',
        label: 'Business Management',
        items: [
          { href: '/customers', label: 'Customers' },
          { href: '/estimates', label: 'Estimates' },
          { href: '/invoices', label: 'Invoices' },
          { href: '/company', label: 'Company Profile' },
        ],
      }
    : null;

  if (loading || authPending) {
    return (
      <header className="header px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-extrabold text-xl" style={{ color: 'var(--gold)' }}>
          Total Service Pro
        </Link>
        <div className="w-8 h-8 rounded-full bg-[var(--surface3)] animate-pulse" />
      </header>
    );
  }

  return (
    <header className="header px-4 py-3 flex items-center justify-between relative z-50">
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/" className="flex flex-col leading-none shrink-0">
          <span
            className="font-extrabold text-xl tracking-[-0.5px]"
            style={{ color: 'var(--gold)' }}
          >
            Total Service Pro
          </span>
          <span className="text-[10px] font-medium tracking-[1.5px] text-[var(--text3)] uppercase -mt-0.5">
            Laser Equipment Service
          </span>
        </Link>

        {/* Desktop: limited top-level items + hover dropdowns */}
        <nav className="ml-6 hidden md:flex items-center gap-5 text-base font-medium text-[var(--text2)]">
          {user ? (
            <>
              <Link href="/" className="hover:text-[var(--gold)] py-1">
                Dashboard
              </Link>
              <NavDropdown group={hubGroup} openId={navOpenId} setOpenId={setNavOpenId} />
              <NavDropdown group={marketplaceGroup} openId={navOpenId} setOpenId={setNavOpenId} />
              {businessGroup && (
                <NavDropdown group={businessGroup} openId={navOpenId} setOpenId={setNavOpenId} />
              )}
              {canAdminPortal && (
                <Link href="/admin" className="hover:text-[var(--gold)] py-1">
                  Admin Portal
                </Link>
              )}
            </>
          ) : (
            <>
              <Link href="/directory" className="hover:text-[var(--gold)] py-1">
                Directory
              </Link>
              <Link href="/marketplace" className="hover:text-[var(--gold)] py-1">
                Marketplace
              </Link>
            </>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {user && (
          <Link
            href="/notifications"
            className="relative p-2 text-[var(--text2)] hover:text-[var(--gold)]"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={20} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        )}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 text-[var(--text)] hover:text-[var(--gold)]"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        {!user ? (
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-primary text-sm px-4 py-1.5">
              Sign In
            </Link>
            <Link href="/signup" className="btn btn-secondary text-sm px-4 py-1.5">
              Sign Up
            </Link>
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 rounded-full border border-[var(--gold-border)] pl-1 pr-3 py-1 hover:bg-[var(--surface3)]"
              aria-label="Account menu"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--gold)] text-[#111827] flex items-center justify-center text-xs font-bold border-2 border-[var(--gold)]">
                {initials}
              </div>
              <span className="hidden sm:block text-sm font-semibold text-[var(--text)] max-w-[140px] truncate">
                {chipLabel}
              </span>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--gold)] bg-[var(--surface3)] shadow-xl z-[100] overflow-hidden text-sm">
                <div className="px-4 py-3 border-b border-[var(--border)]">
                  <div className="font-semibold text-[var(--gold)]">{orgName || fullName}</div>
                  {orgName ? (
                    <div className="text-xs text-[var(--text2)] truncate">{fullName}</div>
                  ) : null}
                  <div className="text-xs text-[var(--text3)] truncate">{user.email}</div>
                  {profile?.role && (
                    <div className="text-[10px] mt-0.5 text-[var(--text3)]">Role: {roleLabel(profile.role)}</div>
                  )}
                </div>

                <Link
                  href="/profile"
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <UserIcon size={16} /> User Profile
                </Link>
                <Link
                  href="/company"
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Building2 size={16} /> {companyLabel}
                </Link>
                <Link
                  href="/settings"
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Settings size={16} /> Settings
                </Link>
                {canAdminPortal && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Building2 size={16} /> Admin Portal
                  </Link>
                )}

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-red-400 hover:bg-[var(--surface)] border-t border-[var(--border)]"
                >
                  <LogOut size={16} /> Log Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile: same groups as accordion */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-[var(--surface3)] border-b border-[var(--border)] z-[90] shadow-lg max-h-[75vh] overflow-y-auto">
          <nav className="flex flex-col px-4 py-2 text-base font-medium">
            {user ? (
            <Link
              href="/"
              className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
              onClick={closeMobileMenu}
            >
              Dashboard
            </Link>
            ) : (
              <>
                <Link
                  href="/directory"
                  className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                  onClick={closeMobileMenu}
                >
                  Directory
                </Link>
                <Link
                  href="/marketplace"
                  className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                  onClick={closeMobileMenu}
                >
                  Marketplace
                </Link>
              </>
            )}

            {user && [hubGroup, marketplaceGroup, businessGroup]
              .filter(Boolean)
              .map((g) => {
                const group = g as NavGroup;
                const open = mobileOpenGroup === group.id;
                return (
                  <div key={group.id} className="border-b border-[var(--border)]">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between py-3 hover:text-[var(--gold)] bg-transparent border-0 text-inherit font-medium text-left cursor-pointer"
                      onClick={() => setMobileOpenGroup(open ? null : group.id)}
                    >
                      {group.label}
                      <ChevronDown
                        size={16}
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {open && (
                      <div className="pb-2 pl-3 flex flex-col gap-0.5">
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="py-2 text-sm text-[var(--text3)] hover:text-[var(--gold)]"
                            onClick={closeMobileMenu}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

            {canAdminPortal && (
              <Link
                href="/admin"
                className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                Admin Portal
              </Link>
            )}
            {user && (
              <Link
                href="/notifications"
                className="py-3 hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                Notifications{unread > 0 ? ` (${unread})` : ''}
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
