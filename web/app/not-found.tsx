'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { mapAndroidHtmlPath } from '@/lib/android-html-routes';

export default function NotFound() {
  // The 404 shell is reused for every missing URL. Header copy follows the
  // locale in the path (`/de/service-manuals` → "Problem melden"), but a
  // prerendered shell does not know that path, so the first paint stays
  // locale-neutral and the translated header mounts after hydration.
  const [chrome, setChrome] = useState(false);

  useEffect(() => {
    setChrome(true);
    try {
      const mapped = mapAndroidHtmlPath(window.location.pathname, window.location.search);
      if (mapped) {
        window.location.replace(mapped);
      }
    } catch {
      /* stay on 404 */
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {chrome ? (
        <Header />
      ) : (
        <header className="header px-4 py-3">
          <Link href="/" className="font-extrabold text-xl" style={{ color: 'var(--gold)' }}>
            Total Service Pro
          </Link>
        </header>
      )}
      <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
        <h1 className="text-3xl font-extrabold">404</h1>
        <p className="text-[var(--text3)] mt-2 mb-6">This page could not be found.</p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link href="/login" className="btn btn-primary">
            Sign In
          </Link>
          <Link href="/signup" className="btn btn-secondary">
            Sign Up
          </Link>
          <Link href="/directory" className="btn btn-secondary">
            Directory
          </Link>
        </div>
      </div>
    </div>
  );
}
