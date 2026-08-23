'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
    <div className="lp-root -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      <header className={`lp-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <Link href="/" className="lp-brand">
          <span className="lp-brand-biz">Medical Repair Network</span>
          <span className="lp-brand-name">Total Service Pro</span>
          <span className="lp-brand-sub">Laser Equipment Service</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Public">
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/marketplace/parts">Parts</Link>
          <Link href="/plans">Free Plan</Link>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Register for Total Service Pro
          </Link>
        </div>
      </header>
      {children}
      <footer className="lp-footer">
        <div>
          <strong style={{ color: '#FBBF24' }}>Medical Repair Network</strong>
          {' · '}
          Total Service Pro
        </div>
        <div className="lp-footer-links">
          <Link href="/">Home</Link>
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
