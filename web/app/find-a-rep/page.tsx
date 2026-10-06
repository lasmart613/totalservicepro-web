'use client';
import { useT } from '@/lib/fa/locale';

import { LandingShell } from '@/components/landing/LandingShell';
import { FindRepForm } from '@/components/landing/FindRepForm';
import '@/components/landing/landing.css';

/** Guest clinic onramp — no Total Service Pro account required. */
export default function FindARepPage() {
  const t = useT();
  return (
    <LandingShell>
      <section className="lp-section lp-find-page" aria-label={t('Find a service rep')}>
        <FindRepForm />
      </section>
    </LandingShell>
  );
}
