'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { fetchGodMe, GOD_DASHBOARD_PATH } from '@/lib/god-client';

export default function GodAliasPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const god = await fetchGodMe();
      if (cancelled) return;
      if (god) {
        router.replace(GOD_DASHBOARD_PATH);
        return;
      }
      setDenied(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!denied) {
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
      <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
        <h1 className="text-3xl font-extrabold">404</h1>
        <p className="text-[var(--text3)] mt-2 mb-6">This page could not be found.</p>
        <Link href="/" className="btn btn-primary">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
