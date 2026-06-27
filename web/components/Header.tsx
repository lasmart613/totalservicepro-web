'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '../lib/supabase/client';
import { User } from '@supabase/supabase-js';
import { LogOut, User as UserIcon, Settings, Building2, Menu, X, Calendar, Clock, Bell } from 'lucide-react';

export function Header() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const supabase = getSupabaseClient();

  // ... (keep your existing useEffect and loadUser logic unchanged)

  const fullName = profile 
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0]
    : user?.email?.split('@')[0] || 'User';

  const initials = (profile?.first_name?.[0] || user?.email?.[0] || 'U').toUpperCase() + 
                   (profile?.last_name?.[0] || '').toUpperCase();

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
      {/* ... keep your logo and nav unchanged ... */}

      <div className="flex items-center gap-3">
        {/* Mobile Menu Button - unchanged */}

        {!user ? (
          // ... sign in buttons unchanged
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
                  <Building2 size={16} /> Company Profile
                </Link>

                {/* Settings with your requested options */}
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

      {/* Mobile Menu - unchanged */}
    </header>
  );
}