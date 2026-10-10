'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabaseClient } from '../lib/supabase/client';
import { signOutAndClearIdentity } from '@/lib/auth-session';
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
  ArrowUpCircle,
} from 'lucide-react';
import { isOwnerish, isSupplier } from '@/lib/roles';
import { financialReportingNavLink } from '@/lib/financial-reporting-access';
import { jobCostingNavLink } from '@/lib/job-costing-access';
import { getOrgRole, reportingOrganizationId } from '@/lib/org-role';
import {
  adminPortalNavVisible,
  businessManagementNavVisible,
  loadOwnNavProfile,
  ORG_NAV_PENDING,
  orgNavFromLookup,
  type OrgNavState,
} from '@/lib/profile-nav';
import { ownerHubNavLabel, ownerProfileLabel, roleLabel } from '@/lib/labels';
import { useUpgradeEntry } from '@/lib/use-show-upgrade';
import { UpgradePlanLink } from '@/components/UpgradePlanLink';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { ReportIssueControl } from '@/components/ReportIssueControl';
import { fetchGodMe, GOD_DASHBOARD_PATH } from '@/lib/god-client';
import { isUnreadPollBackoffError, startDocumentUnreadPoll } from '@/lib/unread-poll';
import { useLocalizedPublic, useSiteLocale, useT } from '@/lib/fa/locale';
import { FaPublicHeader } from '@/components/fa/FaPublicHeader';
import { LanguageSelector } from '@/components/i18n/LanguageSelector';

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
  const t = useT();
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
          className="inline-flex items-center gap-1 hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0"
          onFocus={() => setOpenId(group.id)}
        >
          {t(group.label)}
          <ChevronDown size={14} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Link>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-[var(--gold)] py-1 bg-transparent border-0 text-inherit font-medium cursor-pointer whitespace-nowrap shrink-0"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpenId(open ? null : group.id)}
        >
          {t(group.label)}
          <ChevronDown size={14} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {open && group.items.length > 0 && (
        <div
          className="absolute start-0 top-full pt-2 z-[100]"
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
                {t(item.label)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ authPending = false }: { authPending?: boolean }) {
  const localizedPublic = useLocalizedPublic();
  const t = useT();
  const locale = useSiteLocale();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [orgNav, setOrgNav] = useState<OrgNavState>(ORG_NAV_PENDING);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navOpenId, setNavOpenId] = useState<string | null>(null);
  const [mobileOpenGroup, setMobileOpenGroup] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [isGod, setIsGod] = useState(false);
  const upgrade = useUpgradeEntry();
  const supabase = getSupabaseClient();
  const pathname = usePathname();

  /** @returns true when the poll should back off (504 / timeout / 5xx). */
  async function refreshUnread(uid: string): Promise<boolean> {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('is_read', false);
      if (error) {
        if (isUnreadPollBackoffError(error)) return true;
        setUnread(0);
        return false;
      }
      setUnread(count || 0);
      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        try {
          if (count && count > 0) (navigator as any).setAppBadge(count);
          else (navigator as any).clearAppBadge?.();
        } catch {
          /* ignore */
        }
      }
      return false;
    } catch (err) {
      if (isUnreadPollBackoffError(err)) return true;
      setUnread(0);
      return false;
    }
  }

  useEffect(() => {
    let activeUserId: string | null = null;

    const applyProfile = (uid: string, prof: any) => {
      if (activeUserId !== uid) return;
      if (prof && prof.id && prof.id !== uid) return;
      setProfile(prof);
    };

    const loadProfileFor = async (uid: string) => {
      const prof = await loadOwnNavProfile(supabase, uid);
      applyProfile(uid, prof);
      if (activeUserId !== uid) return;
      const looked = await getOrgRole(supabase, uid, reportingOrganizationId(prof));
      if (activeUserId !== uid) return;
      setOrgNav(orgNavFromLookup(looked));
    };

    const loadUser = async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      activeUserId = u?.id ?? null;
      setUser(u);
      if (!u) {
        setProfile(null);
        setOrgNav(ORG_NAV_PENDING);
        setUnread(0);
        setIsGod(false);
        setLoading(false);
        return;
      }
      setProfile(null);
      setOrgNav(ORG_NAV_PENDING);
      await loadProfileFor(u.id);
      if (activeUserId === u.id) {
        await refreshUnread(u.id);
        setIsGod(await fetchGodMe());
      }
      setLoading(false);
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        activeUserId = null;
        setUser(null);
        setProfile(null);
        setOrgNav(ORG_NAV_PENDING);
        setUnread(0);
        setIsGod(false);
        return;
      }
      const uid = session.user.id;
      const switched = activeUserId !== uid;
      activeUserId = uid;
      setUser(session.user);
      if (switched) {
        // Drop the previous account's org chip immediately — do not wait for fetch.
        setProfile(null);
        setOrgNav(ORG_NAV_PENDING);
        setUnread(0);
      }
      loadProfileFor(uid);
      refreshUnread(uid);
      fetchGodMe().then(setIsGod);
    });

    const stopUnreadPoll = startDocumentUnreadPoll(async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!u) return false;
      return refreshUnread(u.id);
    });

    return () => {
      subscription.unsubscribe();
      stopUnreadPoll();
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

  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileOpenGroup(null);
    setDropdownOpen(false);
    setNavOpenId(null);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  const handleLogout = async () => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    setUser(null);
    setProfile(null);
    setOrgNav(ORG_NAV_PENDING);
    setUnread(0);
    await signOutAndClearIdentity(supabase);
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
  const orgPowerRole = orgNav.orgPowerRole;
  const canBusinessNav =
    businessManagementNavVisible(orgNav) && (showServiceNav || orgNav.platformAdmin);
  const canAdminPortal = adminPortalNavVisible(orgNav);
  const financialNav = financialReportingNavLink({ role: orgPowerRole, god: isGod });
  const jobCostingNav = jobCostingNavLink({ role: orgPowerRole, god: isGod });

  /** Primary hub dropdown — role-aware */
  const hubGroup: NavGroup = ownerMode
    ? {
        id: 'hub',
        label: ownerHubNavLabel(orgType, facilityType, meta.organization_type),
        href: '/my-lasers',
        items: [
          { href: '/my-lasers', label: 'My Lasers' },
          { href: '/company', label: ownerProfileLabel(orgType, facilityType, meta.organization_type) },
          { href: '/manuals', label: 'Operators Manuals' },
          { href: '/service-requests', label: 'Service Requests' },
          { href: '/estimates', label: 'Estimates' },
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
          { href: '/purchase-orders', label: 'Purchase Orders' },
          { href: '/company', label: 'Company Profile' },
          ...(financialNav ? [financialNav] : []),
          ...(jobCostingNav ? [jobCostingNav] : []),
        ],
      }
    : null;

  if (localizedPublic) return <FaPublicHeader />;

  if (loading || authPending) {
    return (
      <header className="header px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2">
        <Link href="/" className="font-extrabold text-lg sm:text-xl min-w-0 truncate" style={{ color: 'var(--gold)' }}>
          Total Service Pro
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden lg:block">
            <ReportIssueControl />
          </div>
          <div className="w-8 h-8 rounded-full bg-[var(--surface3)] animate-pulse" />
        </div>
      </header>
    );
  }

  return (
    <header className="header w-full min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 flex-1 relative z-[100]">
        <Link href="/" className="flex flex-col leading-none shrink-0 max-w-full">
          <span
            className="font-extrabold text-lg sm:text-xl tracking-[-0.5px]"
            style={{ color: 'var(--gold)' }}
          >
            Total Service Pro
          </span>
          <span className="hidden sm:block text-[10px] font-medium tracking-normal text-[var(--text3)] uppercase -mt-0.5">
            {t('Laser Equipment Service')}
          </span>
        </Link>

        {/* Desktop / large tablet: inline groups. Phones + small tablets use the drawer.
            At 1280 the row wraps instead of clipping Admin Portal or the brand. */}
        <nav className="ms-1 xl:ms-3 hidden lg:flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium text-[var(--text2)] min-w-0">
          {user ? (
            <>
              <Link href="/" className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                {t('Dashboard')}
              </Link>
              <NavDropdown group={hubGroup} openId={navOpenId} setOpenId={setNavOpenId} />
              <NavDropdown group={marketplaceGroup} openId={navOpenId} setOpenId={setNavOpenId} />
              {businessGroup && (
                <NavDropdown group={businessGroup} openId={navOpenId} setOpenId={setNavOpenId} />
              )}
              {canAdminPortal && (
                <Link href="/admin" className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                  {t('Admin Portal')}
                </Link>
              )}
              {financialNav && !businessGroup && (
                <Link href={financialNav.href} className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                  {t(financialNav.label)}
                </Link>
              )}
              {jobCostingNav && !businessGroup && (
                <Link href={jobCostingNav.href} className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                  {t(jobCostingNav.label)}
                </Link>
              )}
              {isGod && (
                <Link href={GOD_DASHBOARD_PATH} className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                  {t('God Dashboard')}
                </Link>
              )}
            </>
          ) : (
            <>
              <Link href="/directory" className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                {t('Directory')}
              </Link>
              <Link href="/marketplace" className="hover:text-[var(--gold)] py-1 whitespace-nowrap shrink-0">
                {t('Marketplace')}
              </Link>
              <LanguageSelector variant="header" />
            </>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 relative z-[100]">
        <div className="hidden lg:flex items-center gap-1.5">
          <ReportIssueControl />
          {user && <OrgSwitcher compact />}
          {user && (
            <Link
              href="/notifications"
              className="relative inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-[var(--text2)] hover:text-[var(--gold)]"
              aria-label={t('Notifications')}
              title={t('Notifications')}
            >
              <Bell size={20} />
              {unread > 0 && (
                <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          )}
        </div>

        {!user && (
          <div className="hidden lg:flex items-center gap-2">
            <Link href="/login" className="btn btn-primary text-sm px-4 py-1.5">
              {t('Sign In')}
            </Link>
            <Link href="/signup" className="btn btn-secondary text-sm px-4 py-1.5">
              {t('Sign Up')}
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(!mobileMenuOpen);
            setDropdownOpen(false);
          }}
          className="lg:hidden inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-[var(--text)] hover:text-[var(--gold)]"
          aria-label={mobileMenuOpen ? t('Close menu') : t('Open menu')}
          aria-expanded={mobileMenuOpen}
          aria-controls="app-mobile-nav"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        {user && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setDropdownOpen(!dropdownOpen);
                setMobileMenuOpen(false);
              }}
              className="flex items-center gap-2 rounded-full border border-[var(--gold-border)] ps-1 pe-1.5 lg:pe-2 py-1 min-h-11 hover:bg-[var(--surface3)]"
              aria-label={t('Account menu')}
            >
              <div className="w-8 h-8 rounded-full bg-[var(--gold)] text-[#111827] flex items-center justify-center text-xs font-bold border-2 border-[var(--gold)]">
                {initials}
              </div>
              <span className="hidden 2xl:block text-sm font-semibold text-[var(--text)] max-w-[9rem] truncate">
                {chipLabel}
              </span>
            </button>

            {dropdownOpen && (
              <div className="absolute end-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] min-w-[18rem] rounded-xl border border-[var(--gold)] bg-[var(--surface3)] shadow-xl z-[100] overflow-visible text-sm">
                <div className="px-4 py-3 border-b border-[var(--border)]">
                  <div className="font-semibold text-[var(--gold)]">{orgName || fullName}</div>
                  {orgName ? (
                    <div className="text-xs text-[var(--text2)] truncate">{fullName}</div>
                  ) : null}
                  <div className="text-xs text-[var(--text3)] truncate">{user.email}</div>
                  {profile?.role && (
                    <div className="text-[10px] mt-0.5 text-[var(--text3)]">{t('Role:')} {roleLabel(profile.role, locale)}</div>
                  )}
                  <div className="mt-2">
                    <OrgSwitcher variant="menu" />
                  </div>
                </div>

                <Link
                  href="/profile"
                  className="flex items-center gap-2 px-4 py-2.5 min-h-11 hover:bg-[var(--surface)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <UserIcon size={16} /> {t('User Profile')}
                </Link>
                <Link
                  href="/company"
                  className="flex items-center gap-2 px-4 py-2.5 min-h-11 hover:bg-[var(--surface)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Building2 size={16} /> {t(companyLabel)}
                </Link>
                {upgrade.show && (
                  <UpgradePlanLink
                    className="flex items-center gap-2 px-4 py-2.5 min-h-11 hover:bg-[var(--surface)]"
                    onClick={() => setDropdownOpen(false)}
                    target={upgrade.target}
                  >
                    <ArrowUpCircle size={16} /> {t('Upgrade plan')}
                  </UpgradePlanLink>
                )}
                <Link
                  href="/settings"
                  className="flex items-center gap-2 px-4 py-2.5 min-h-11 hover:bg-[var(--surface)]"
                  onClick={() => setDropdownOpen(false)}
                >
                  <Settings size={16} /> {t('Settings')}
                </Link>
                {canAdminPortal && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 px-4 py-2.5 min-h-11 hover:bg-[var(--surface)]"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Building2 size={16} /> {t('Admin Portal')}
                  </Link>
                )}
                {isGod && (
                  <Link
                    href={GOD_DASHBOARD_PATH}
                    className="flex items-center gap-2 px-4 py-2.5 min-h-11 hover:bg-[var(--surface)]"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Building2 size={16} /> {t('God Dashboard')}
                  </Link>
                )}

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 min-h-11 text-start text-red-400 hover:bg-[var(--surface)] border-t border-[var(--border)]"
                >
                  <LogOut size={16} /> {t('Log Out')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {mobileMenuOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-[80] bg-black/40"
          aria-label={t('Close menu')}
          onClick={closeMobileMenu}
        />
      )}

      {mobileMenuOpen && (
        <div
          id="app-mobile-nav"
          className="lg:hidden absolute top-full left-0 right-0 bg-[var(--surface3)] border-b border-[var(--gold)] z-[90] shadow-lg max-h-[min(75vh,calc(100dvh-4rem))] overflow-y-auto"
        >
          <nav className="flex flex-col px-4 py-1 text-base font-medium">
            {user ? (
              <Link
                href="/"
                className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                {t('Dashboard')}
              </Link>
            ) : (
              <>
                <Link
                  href="/directory"
                  className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                  onClick={closeMobileMenu}
                >
                  {t('Directory')}
                </Link>
                <Link
                  href="/marketplace"
                  className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                  onClick={closeMobileMenu}
                >
                  {t('Marketplace')}
                </Link>
              </>
            )}
            {!user && <LanguageSelector variant="drawer" onNavigate={closeMobileMenu} />}

            {user &&
              [hubGroup, marketplaceGroup, businessGroup].filter(Boolean).map((g) => {
                const group = g as NavGroup;
                const open = mobileOpenGroup === group.id;
                return (
                  <div key={group.id} className="border-b border-[var(--border)]">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between min-h-11 py-3 hover:text-[var(--gold)] bg-transparent border-0 text-inherit font-medium text-start cursor-pointer"
                      aria-expanded={open}
                      onClick={() => setMobileOpenGroup(open ? null : group.id)}
                    >
                      {t(group.label)}
                      <ChevronDown
                        size={16}
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {open && (
                      <div className="pb-2 ps-3 flex flex-col">
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="flex items-center min-h-11 py-2 text-sm text-[var(--text3)] hover:text-[var(--gold)]"
                            onClick={closeMobileMenu}
                          >
                            {t(item.label)}
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
                className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                {t('Admin Portal')}
              </Link>
            )}
            {financialNav && !businessGroup && (
              <Link
                href={financialNav.href}
                className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                {t(financialNav.label)}
              </Link>
            )}
            {jobCostingNav && !businessGroup && (
              <Link
                href={jobCostingNav.href}
                className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                {t(jobCostingNav.label)}
              </Link>
            )}
            {isGod && (
              <Link
                href={GOD_DASHBOARD_PATH}
                className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                {t('God Dashboard')}
              </Link>
            )}
            {user && (
              <div className="py-3 border-b border-[var(--border)]">
                <OrgSwitcher variant="menu" />
              </div>
            )}
            <div className="py-3 border-b border-[var(--border)]">
              <ReportIssueControl showLabel />
            </div>
            {user && (
              <Link
                href="/notifications"
                className="flex items-center min-h-11 py-3 border-b border-[var(--border)] hover:text-[var(--gold)]"
                onClick={closeMobileMenu}
              >
                {t('Notifications')}{unread > 0 ? ` (${unread})` : ''}
              </Link>
            )}
            {!user && (
              <div className="flex flex-col gap-2 py-3">
                <Link href="/login" className="btn btn-primary min-h-11" onClick={closeMobileMenu}>
                  {t('Sign In')}
                </Link>
                <Link href="/signup" className="btn btn-secondary min-h-11" onClick={closeMobileMenu}>
                  {t('Sign Up')}
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
