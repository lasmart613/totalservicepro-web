'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { gaSkipsPath, getGaMeasurementId, shouldLoadGa } from '@/lib/ga';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * GA4 gtag for repairplanet.net. Mounts only after a real browser check so
 * SSR / prerender never double-counts. Skips /admin and /god, local `next
 * dev`, and Netlify deploy-preview hosts.
 */
export function GoogleAnalytics() {
  const pathname = usePathname() || '';
  const measurementId = getGaMeasurementId();
  const [hostname, setHostname] = useState<string | null>(null);

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  const enabled =
    hostname !== null &&
    shouldLoadGa({
      nodeEnv: process.env.NODE_ENV,
      pathname,
      hostname,
      measurementId,
    });

  useEffect(() => {
    if (!enabled || typeof window.gtag !== 'function') return;
    window.gtag('config', measurementId, { page_path: pathname });
  }, [enabled, measurementId, pathname]);

  if (!enabled || gaSkipsPath(pathname)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-gtag" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </Script>
    </>
  );
}
