'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy sibling URL — service requests live at /service-requests */
export default function MarketplaceServiceRequestsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/service-requests');
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
      Redirecting to Service Requests…
    </div>
  );
}
