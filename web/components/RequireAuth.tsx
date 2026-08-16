'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { loginHref, pathWithSearch } from '@/lib/login-next';

/**
 * Client auth gate. Session lives in localStorage (tsp-auth-token), so Edge
 * middleware cannot see it — do not add getUser() to middleware on Netlify.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const pathname = usePathname();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        const search = typeof window !== 'undefined' ? window.location.search : '';
        router.replace(loginHref(pathWithSearch(pathname, search)));
        return;
      }
      setOk(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router, pathname]);

  if (!ok) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header authPending />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">
          Checking sign-in…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
