'use client';

import React from 'react';
import { GodSubnav } from '@/components/god/GodSubnav';

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <GodSubnav />
      {children}
    </div>
  );
}
