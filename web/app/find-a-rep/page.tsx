'use client';

import { LandingShell } from '@/components/landing/LandingShell';
import { FindRepForm } from '@/components/landing/FindRepForm';
import '@/components/landing/landing.css';

/** Guest clinic onramp — no Total Service Pro account required. */
export default function FindARepPage() {
  return (
    <LandingShell>
      <section className="lp-section lp-find-page" aria-label="Find a service rep">
        <FindRepForm />
      </section>
    </LandingShell>
  );
}
