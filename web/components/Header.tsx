'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '../lib/supabase/client';
import { User } from '@supabase/supabase-js';
import { LogOut, User as UserIcon, Settings, Building2, Menu, X, Bell } from 'lucide-react';
import { isOwnerish, isSupplier, isAdmin } from '@/lib/roles';

export function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
      // Browser badge if supported
      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        try {
          if (count && count > 0) (navigator as any).setAppBadge(count);
          else (navigator as any).clearAppBadge?.();
        } catch { /* ignore */ }
      }
    } catch {
      setUnread(0);
    }
  }

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u);

      if (u) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('first_name, last_name, role, organizations(name, type)')
          .eq('id', u.id)
          .maybeSingle();
        setProfile(prof);
        await refreshUnread(u.id);
      }
      setLoading(false);
    };

    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        supabase
          .from('user_profiles')
          .select('first_name, last_name, role, organizations(name, type)')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(({ data }) => setProfile(data));
        refreshUnread(session.user.id);
      } else {
        setProfile(null);
        setUnread(0);
      }
    });

    // Poll notifications lightly
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

  const handleLogout = async () => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const fullName = profile 
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0]
    : user?.email?.split('@')[0] || 'User';

  const initials = (profile?.first_name?.[0] || user?.email?.[0] || 'U').toUpperCase() + 
                   (profile?.last_name?.[0] || '').toUpperCase();

  const orgType = (profile?.organizations as any)?.type || null;
  const ownerMode = isOwnerish(profile?.role, orgType);
  const supplierMode = isSupplier(profile?.role, orgType);
  const companyLabel = ownerMode ? 'Facility Profile' : supplierMode ? 'Supplier Profile' : 'Company Profile';
  // Service pros see Tech Hub / Reports; owners get My Lasers instead of hub emphasis
  const showServiceNav = !ownerMode && !supplierMode;
  const canBusinessNav =
    showServiceNav &&
    (isAdmin(profile?.role) ||
      ['service_manager', 'dispatcher', 'scheduler', 'billing_manager'].includes(
        (profile?.role || '').toLowerCase()
      ));

  if (loading) {
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
    <header className="header px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex flex-col leading-none">
          <span className="font-extrabold text-xl tracking-[-0.5px]" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          <span className="text-[10px] font-medium tracking-[1.5px] text-[var(--text3)] uppercase -mt-0.5">Laser Equipment Service</span>
        </Link>

        <nav className="ml-6 hidden md:flex items-center gap-5 text-base font-medium text-[var(--text2)]">
          <Link href="/" className="hover:text-[var(--gold)]">Dashboard</Link>
          {ownerMode && <Link href="/my-lasers" className="hover:text-[var(--gold)]">My Lasers</Link>}
          {ownerMode && <Link href="/service-requests" className="hover:text-[var(--gold)]">Service Requests</Link>}
          <Link href="/reports" className="hover:text-[var(--gold)]">{ownerMode ? 'History' : 'Reports'}</Link>
          {showServiceNav && <Link href="/manuals" className="hover:text-[var(--gold)]">Manuals</Link>}
          {showServiceNav && <Link href="/service-requests" className="hover:text-[var(--gold)]">Repair Jobs</Link>}
          {showServiceNav && <Link href="/bids" className="hover:text-[var(--gold)]">My Bids</Link>}
          {showServiceNav && <Link href="/accepted-bids" className="hover:text-[var(--gold)]">Accepted Bids</Link>}
          {ownerMode && <Link href="/accepted-bids" className="hover:text-[var(--gold)]">Accepted Bids</Link>}
          {showServiceNav && <Link href="/test-equipment" className="hover:text-[var(--gold)]">Test Equipment</Link>}
          {showServiceNav && <Link href="/hub" className="hover:text-[var(--gold)]">Tech Hub</Link>}
          {canBusinessNav && <Link href="/customers" className="hover:text-[var(--gold)]">Customers</Link>}
          {canBusinessNav && <Link href="/estimates" className="hover:text-[var(--gold)]">Estimates</Link>}
          {canBusinessNav && <Link href="/invoices" className="hover:text-[var(--gold)]">Invoices</Link>}
          {supplierMode && <Link href="/parts" className="hover:text-[var(--gold)]">Parts</Link>}
          <Link href="/directory" className="hover:text-[var(--gold)]">Directory</Link>}
          <Link href="/marketplace" className="hover:text-[var(--gold)]">Marketplace</Link>
        </nav>
      </div>

      <div className="flex items-center gap-3">
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
            <Link href="/login" className="btn btn-primary text-sm px-4 py-1.5">Sign In</Link>
            <Link href="/signup" className="btn btn-secondary text-sm px-4 py-1.5">Sign Up</Link>
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 rounded-full border border-[var(--gold-border)] pl-1 pr-3 py-1 hover:bg-[var(--surface3)]"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--gold)] text-[#111827] flex items-center justify-center text-xs font-bold border-2 border-[var(--gold)]">
                {initials}
              </div>
              <span className="hidden sm:block text-sm font-semibold text-[var(--text)] max-w-[140px] truncate">{fullName}</span>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--gold)] bg-[var(--surface3)] shadow-xl z-[100] overflow-hidden text-sm">
                <div className="px-4 py-3 border-b border-[var(--border)]">
                  <div className="font-semibold text-[var(--gold)]">{fullName}</div>
                  <div className="text-xs text-[var(--text3)] truncate">{user.email}</div>
                  {profile?.role && <div className="text-[10px] mt-0.5 text-[var(--text3)]">Role: {profile.role}</div>}
                </div>

                <Link href="/profile" className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]" onClick={() => setDropdownOpen(false)}>
                  <UserIcon size={16} /> User Profile
                </Link>
                <Link href="/company" className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]" onClick={() => setDropdownOpen(false)}>
                  <Building2 size={16} /> {companyLabel}
                </Link>
                <Link href="/settings" className="flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--surface)]" onClick={() => setDropdownOpen(false)}>
                  <Settings size={16} /> Settings
                </Link>

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

      {mobileMenuOpen && (
        <div className="md:hidden absolute top-[60px] left-0 right-0 bg-[var(--surface3)] border-b border-[var(--border)] z-[90] shadow-lg">
          <nav className="flex flex-col px-4 py-2 text-base font-medium">
            <Link href="/" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Dashboard</Link>
            {ownerMode && <Link href="/my-lasers" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>My Lasers</Link>}
            {ownerMode && <Link href="/service-requests" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Service Requests</Link>}
            <Link href="/reports" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>{ownerMode ? 'History' : 'Reports'}</Link>
            {showServiceNav && <Link href="/manuals" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Manuals</Link>}
            {showServiceNav && <Link href="/service-requests" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Repair Jobs</Link>}
            {showServiceNav && (
              <Link href="/bids" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>
                My Bids
              </Link>
            )}
            {(showServiceNav || ownerMode) && (
              <Link href="/accepted-bids" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>
                Accepted Bids
              </Link>
            )}
            {showServiceNav && (
              <Link href="/test-equipment" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>
                Test Equipment
              </Link>
            )}
            {user && (
              <Link href="/notifications" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>
                Notifications{unread > 0 ? ` (${unread})` : ''}
              </Link>
            )}
            {showServiceNav && <Link href="/hub" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Tech Hub</Link>}
            {canBusinessNav && <Link href="/customers" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Customers</Link>}
            {canBusinessNav && <Link href="/estimates" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Estimates</Link>}
            {canBusinessNav && <Link href="/invoices" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Invoices</Link>}
            {supplierMode && <Link href="/parts" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>Parts</Link>}
            <Link href="/directory" className="py-3 border-b border-[var(--border)] hover:text-[var(--gold)]" onClick={closeMobileMenu}>TSP Directory</Link>}
            <Link href="/marketplace" className="py-3 hover:text-[var(--gold)]" onClick={closeMobileMenu}>Marketplace</Link>
          </nav>
        </div>
      )}
    </header>
  );
}