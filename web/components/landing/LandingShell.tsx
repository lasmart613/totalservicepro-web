'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ReportIssueControl } from '@/components/ReportIssueControl';
import { FindRepControl } from './FindRepControl';
import './landing.css';

export function LandingShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('landing-mode');
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.documentElement.classList.remove('landing-mode');
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="lp-root">
      <header className={`lp-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <Link href="/" className="lp-brand">
          <span className="lp-brand-biz">Medical Repair Network</span>
          <span className="lp-brand-name">RepairPlanet</span>
          <span className="lp-brand-sub">Total Service Pro</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Public">
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/marketplace/parts">Parts</Link>
          <Link href="/plans">Free Plan</Link>
        </nav>
        <div className="lp-nav-cta">
          <ReportIssueControl variant="landing" />
          <FindRepControl variant="nav" />
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-outline">
            Register for Total Service Pro
          </Link>
        </div>
      </header>
      {children}
      <footer className="lp-footer">
        <div>
          <strong style={{ color: '#FBBF24' }}>RepairPlanet</strong>
          {' · '}
          Medical Repair Network
          {' · '}
          Total Service Pro
        </div>
        <div className="lp-footer-links">
          <Link href="/">Home</Link>
          <Link href="/?find=1">Find a service rep</Link>
          <Link href="/signup/company">Register your shop</Link>
          <Link href="/plans">Free Plan</Link>
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/marketplace/parts">Parts</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Register for Total Service Pro</Link>
          <Link href="/forgot-password">Forgot password</Link>
        </div>
      </footer>
    </div>
  );
}
