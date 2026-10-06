'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AndroidSessionBridge } from '@/components/AndroidSessionBridge';
import { StripeConnectResume } from '@/components/StripeConnectResume';
import { SiteLocaleProvider } from '@/lib/fa/locale';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SiteLocaleProvider>
        <AndroidSessionBridge />
        <StripeConnectResume />
        {children}
        <Toaster position="top-center" richColors closeButton />
      </SiteLocaleProvider>
    </QueryClientProvider>
  );
}
