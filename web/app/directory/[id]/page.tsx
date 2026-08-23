'use client';

/**
 * Org-detail deep links are not public. Guests go to /signup (same as
 * guest marketplace product pages). Signed-in users return to the directory.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGuestSignupRedirect } from '@/lib/use-signed-in';

export default function DirectoryListingDeepLink() {
  const router = useRouter();
  const { ready, signedIn } = useGuestSignupRedirect();

  useEffect(() => {
    if (ready && signedIn) router.replace('/directory');
  }, [ready, signedIn, router]);

  return (
    <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
      Loading…
    </div>
  );
}
