'use client';

import React from 'react';
import Link from 'next/link';
import { LandingShell } from '@/components/landing/LandingShell';

export default function PlansPage() {
  return (
    <LandingShell>
      <section className="lp-section" style={{ marginTop: 0, borderTop: 'none' }}>
        <p className="lp-kicker">Total Service Pro</p>
        <h1 className="lp-h2">Free Plan and Premium</h1>
        <p className="lp-lede">
          Register for a Free Plan. Compare Free and Premium in plain language, then
          create your account. Paid checkout is not on this page.
        </p>
        <div className="lp-paths lp-paths-2">
          <article className="lp-path" style={{ cursor: 'default' }}>
            <h3>Free Plan</h3>
            <ul>
              <li>Register and use Total Service Pro at no charge</li>
              <li>Schedule service calls, post service requests, and list parts</li>
              <li>Ads may appear on the Free Plan</li>
            </ul>
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
            </Link>
          </article>
          <article className="lp-path" style={{ cursor: 'default' }}>
            <h3>Premium</h3>
            <ul>
              <li>Paid plan for accounts that need more of the app</li>
              <li>AI troubleshooting assistant</li>
              <li>Full manual library</li>
              <li>No advertisements</li>
            </ul>
            <Link href="/signup" className="lp-btn lp-btn-ghost">
              Register for Total Service Pro
            </Link>
          </article>
        </div>
        <div className="lp-actions" style={{ marginTop: 28 }}>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Register for a Free Plan
          </Link>
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Already registered? Sign in
          </Link>
        </div>
      </section>
    </LandingShell>
  );
}
