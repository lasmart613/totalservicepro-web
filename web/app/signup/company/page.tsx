'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CompanySignup() {
  const router = useRouter();

  // This page is deprecated / skipped. Keep /company as the single Company profile & management page.
  // Redirect immediately to the real form (no email/PW re-prompt, no duplicate fields/logo, has proper TZ dropdown).
  useEffect(() => {
    router.replace('/company');
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <div className="max-w-md mx-auto w-full px-4 py-12 text-center">
        <div className="text-[var(--gold)] font-extrabold text-2xl mb-2">Total Service Pro</div>
        <h1 className="text-xl font-bold mb-4">Redirecting to Company Management…</h1>
        <p className="text-sm text-[var(--text3)]">The Service Organization signup is now at <a href="/company" className="text-[var(--gold)] underline">/company</a>.</p>
      </div>
    </div>
  );
}
