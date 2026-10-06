'use client';

import React, { useEffect, useState } from 'react';
import { ReportIssueControl } from '@/components/ReportIssueControl';
import { LanguageSelector } from '@/components/i18n/LanguageSelector';
import { PublicLink, useT } from '@/lib/fa/locale';
import { FindRepControl } from './FindRepControl';
import './landing.css';

export function LandingShell({ children }: { children: React.ReactNode }) {
  const t = useT();
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
        <PublicLink href="/" className="lp-brand">
          <span className="lp-brand-biz">{t('Medical Repair Network')}</span>
          <span className="lp-brand-name">RepairPlanet</span>
          <span className="lp-brand-sub">Total Service Pro</span>
        </PublicLink>
        <nav className="lp-nav-links" aria-label={t('Public')}>
          <PublicLink href="/directory">{t('Directory')}</PublicLink>
          <PublicLink href="/marketplace">{t('Marketplace')}</PublicLink>
          <PublicLink href="/marketplace/parts">{t('Parts')}</PublicLink>
          <PublicLink href="/plans">{t('Free Plan')}</PublicLink>
          <LanguageSelector variant="landing" />
        </nav>
        <div className="lp-nav-cta">
          <ReportIssueControl variant="landing" />
          <FindRepControl variant="nav" />
          <PublicLink href="/login" className="lp-btn lp-btn-ghost">
            {t('Sign in')}
          </PublicLink>
          <PublicLink href="/signup" className="lp-btn lp-btn-outline">
            {t('Register for Total Service Pro')}
          </PublicLink>
        </div>
      </header>
      {children}
      <footer className="lp-footer">
        <div>
          <strong style={{ color: '#FBBF24' }}>RepairPlanet</strong>
          {' · '}
          {t('Medical Repair Network')}
          {' · '}
          Total Service Pro
          {' · '}
          {t('Soft beta — no paid ads')}
        </div>
        <div className="lp-footer-links">
          <PublicLink href="/">{t('Home')}</PublicLink>
          <PublicLink href="/#find-a-rep">{t('Find a service rep')}</PublicLink>
          <PublicLink href="/signup/company">{t('Register your shop')}</PublicLink>
          <PublicLink href="/plans">{t('Free Plan')}</PublicLink>
          <PublicLink href="/directory">{t('Directory')}</PublicLink>
          <PublicLink href="/marketplace">{t('Marketplace')}</PublicLink>
          <PublicLink href="/marketplace/parts">{t('Parts')}</PublicLink>
          <PublicLink href="/login">{t('Sign in')}</PublicLink>
          <PublicLink href="/signup">{t('Register for Total Service Pro')}</PublicLink>
          <PublicLink href="/forgot-password">{t('Forgot password')}</PublicLink>
        </div>
      </footer>
    </div>
  );
}
