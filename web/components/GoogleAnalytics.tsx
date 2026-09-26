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
 * SSR / prerender never double-counts. The gtag script uses lazyOnload so it
 * does not compete with first paint. Skips /admin and /god, local `next
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
    if (!enabled) return;
    const send = () => {
      if (typeof window.gtag !== 'function') return false;
      window.gtag('config', measurementId, { page_path: pathname });
      return true;
    };
    if (send()) return;
    // lazyOnload can trail the first client navigation; retry until gtag exists.
    const id = window.setInterval(() => {
      if (send()) window.clearInterval(id);
    }, 500);
    const stop = window.setTimeout(() => window.clearInterval(id), 10000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [enabled, measurementId, pathname]);

  if (!enabled || gaSkipsPath(pathname)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="lazyOnload"
      />
      <Script id="ga4-gtag" strategy="lazyOnload">
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
