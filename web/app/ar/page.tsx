'use client';

import { LandingPage } from '@/components/landing/LandingPage';

/** Logged-in visitors still see the public landing here, not the English dashboard. */
export default function ArHomePage() {
  return <LandingPage />;
}
