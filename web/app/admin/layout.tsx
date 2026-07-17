'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { isAdmin } from '@/lib/roles';

/**
 * Client-side admin gate.
 * (Server layout used browser localStorage client → always "not logged in".)
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [orgName, setOrgName] = useState('Your company');
  const [deniedReason, setDeniedReason] = useState<'login' | 'role' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          if (!cancelled) {
            setDeniedReason('login');
            setReady(true);
            // Preserve intended destination for post-login redirect
            const next = encodeURIComponent(pathname || '/admin');
            router.replace(`/login?next=${next}`);
          }
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role, organization_id, organizations(name)')
          .eq('id', user.id)
          .maybeSingle();

        if (!profile || !isAdmin(profile.role)) {
          if (!cancelled) {
            setDeniedReason('role');
            setAllowed(false);
            setReady(true);
          }
          return;
        }

        const oname = (profile.organizations as any)?.name;
        if (oname) setOrgName(oname);

        if (!cancelled) {
          setAllowed(true);
          setDeniedReason(null);
          setReady(true);
        }
      } catch (e) {
        console.error('admin layout auth', e);
        if (!cancelled) {
          setDeniedReason('login');
          setReady(true);
          router.replace(`/login?next=${encodeURIComponent(pathname || '/admin')}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router, pathname]);

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Loading Admin Portal…
        </div>
      </div>
    );
  }

  if (deniedReason === 'role') {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
          <h1 className="text-2xl font-extrabold mb-2">Admin access required</h1>
          <p className="text-sm text-[var(--text3)] mb-6">
            The Admin Portal is for organization admins (
            <code className="text-[var(--gold)]">admin</code> /{' '}
            <code className="text-[var(--gold)]">company_admin</code>
            ). Your account is signed in but does not have that role.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/" className="btn btn-primary">
              Dashboard
            </Link>
            <Link href="/company" className="btn btn-secondary">
              Company Profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Redirecting to sign in…
        </div>
      </div>
    );
  }

  const nav = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/team', label: 'Team Management' },
    { href: '/customers', label: 'Customers' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex flex-1">
        <aside className="w-64 bg-[var(--surface)] border-r border-[var(--border)] p-6 hidden lg:block">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[var(--gold)]">Admin Portal</h2>
            <p className="text-sm text-[var(--text3)] truncate" title={orgName}>
              {orgName}
            </p>
          </div>

          <nav className="space-y-1 text-sm">
            {nav.map((item) => {
              const active =
                item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    'block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)] ' +
                    (active ? 'bg-[var(--surface3)] text-[var(--gold)] font-semibold' : '')
                  }
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="pt-4 mt-4 border-t border-[var(--border)]">
              <Link href="/" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)] text-[var(--text3)]">
                ← Main Dashboard
              </Link>
              <Link href="/company" className="block px-4 py-2.5 rounded-lg hover:bg-[var(--surface3)] text-[var(--text3)]">
                Company Profile
              </Link>
            </div>
          </nav>
        </aside>

        <main className="flex-1 p-6 lg:p-8">
          {/* Mobile admin nav */}
          <div className="lg:hidden flex gap-2 overflow-x-auto mb-4 pb-1">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="btn btn-secondary text-xs whitespace-nowrap">
                {item.label}
              </Link>
            ))}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
