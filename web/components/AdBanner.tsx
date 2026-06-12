'use client';

import React, { useEffect } from 'react';

interface AdBannerProps {
  slot: string;
  format?: string;
  style?: React.CSSProperties;
}

declare global {
  interface Window {
    adsbygoogle: any[];
  }
}

export default function AdBanner({ slot, format = 'auto', style }: AdBannerProps) {
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, []);

  // Optional reusable component (uses your real client from the snippet you provided).
  // Primary ad units are inline in the dashboard (page.tsx) for direct control.
  // If using this component, create ad units in AdSense and pass the real slot.
  const adClient = 'ca-pub-5353320292042327';
  const resolvedSlot = slot || '1234567890'; // replace default with a real slot ID

  return (
    <ins
      className="adsbygoogle"
      style={{
        display: 'block',
        minHeight: '90px',
        ...style,
      }}
      data-ad-client={adClient}
      data-ad-slot={resolvedSlot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}
