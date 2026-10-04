'use client';

import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { ReportIssueControl } from '@/components/ReportIssueControl';
import { PublicLink, useT } from '@/lib/fa/locale';

/** Logged-out header used only on the Farsi preview. */
export function FaPublicHeader() {
  const t = useT();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <header className="header px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2 relative">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <PublicLink href="/" className="flex flex-col leading-none min-w-0">
          <span className="font-extrabold text-lg sm:text-xl tracking-[-0.5px] truncate" style={{ color: 'var(--gold)' }}>
            Total Service Pro
          </span>
          <span className="hidden sm:block text-[10px] font-medium text-[var(--text3)] -mt-0.5 truncate">
            {t('Laser Equipment Service')}
          </span>
        </PublicLink>
        <nav className="ml-4 xl:ml-6 hidden lg:flex items-center gap-3 xl:gap-5 text-sm xl:text-base font-medium text-[var(--text2)] min-w-0">
          <PublicLink href="/directory" className="hover:text-[var(--gold)] py-1 shrink-0">
            {t('Directory')}
          </PublicLink>
          <PublicLink href="/marketplace" className="hover:text-[var(--gold)] py-1 shrink-0">
            {t('Marketplace')}
          </PublicLink>
          <PublicLink href="/plans" className="hover:text-[var(--gold)] py-1 shrink-0">
            {t('Free Plan')}
          </PublicLink>
        </nav>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <div className="hidden lg:flex items-center gap-2">
          <ReportIssueControl />
          <PublicLink href="/login" className="btn btn-primary text-sm px-4 py-1.5">
            {t('Sign In')}
          </PublicLink>
          <PublicLink href="/signup" className="btn btn-secondary text-sm px-4 py-1.5">
            {t('Sign Up')}
          </PublicLink>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="lg:hidden inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-[var(--text)] hover:text-[var(--gold)]"
          aria-label={mobileMenuOpen ? t('Close menu') : t('Open menu')}
          aria-expanded={mobileMenuOpen}
          aria-controls="fa-mobile-nav"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {mobileMenuOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-[80] bg-black/40"
          aria-label={t('Close menu')}
          onClick={closeMobileMenu}
        />
      )}
      {mobileMenuOpen && (
        <div
          id="fa-mobile-nav"
          className="lg:hidden absolute top-full inset-x-0 bg-[var(--surface3)] border-b border-[var(--gold)] z-[90] shadow-lg max-h-[min(75vh,calc(100dvh-4rem))] overflow-y-auto"
        >
          <nav className="flex flex-col px-4 py-1 text-base font-medium">
            <PublicLink href="/directory" className="flex items-center min-h-11 py-3 border-b border-[var(--border)]" onClick={closeMobileMenu}>
              {t('Directory')}
            </PublicLink>
            <PublicLink href="/marketplace" className="flex items-center min-h-11 py-3 border-b border-[var(--border)]" onClick={closeMobileMenu}>
              {t('Marketplace')}
            </PublicLink>
            <PublicLink href="/plans" className="flex items-center min-h-11 py-3 border-b border-[var(--border)]" onClick={closeMobileMenu}>
              {t('Free Plan')}
            </PublicLink>
            <div className="py-3 border-b border-[var(--border)]">
              <ReportIssueControl showLabel />
            </div>
            <div className="flex flex-col gap-2 py-3">
              <PublicLink href="/login" className="btn btn-primary min-h-11" onClick={closeMobileMenu}>
                {t('Sign In')}
              </PublicLink>
              <PublicLink href="/signup" className="btn btn-secondary min-h-11" onClick={closeMobileMenu}>
                {t('Sign Up')}
              </PublicLink>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
