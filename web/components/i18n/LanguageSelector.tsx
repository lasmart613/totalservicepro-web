'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePublicLocale, useT } from '@/lib/fa/locale';
import { hrefForLocale, PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/locales';

type Variant = 'landing' | 'header' | 'drawer';

function useLocaleHrefs(): (target: PublicLocale) => string {
  const pathname = usePathname() || '/';
  const [extra, setExtra] = useState('');

  useEffect(() => {
    setExtra(`${window.location.search}${window.location.hash}`);
  }, [pathname]);

  return (target: PublicLocale) => hrefForLocale(pathname, target, extra);
}

/** Language menu for the public site. Choices stay in each language's own name. */
export function LanguageSelector({
  variant,
  onNavigate,
}: {
  variant: Variant;
  onNavigate?: () => void;
}) {
  const t = useT();
  const current = usePublicLocale();
  const hrefFor = useLocaleHrefs();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (variant === 'drawer' || !open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, variant]);

  const choices = PUBLIC_LOCALES.map((item) => {
    const selected = item.id === current;
    return (
      <li key={item.id}>
        <Link
          href={hrefFor(item.id)}
          hrefLang={item.htmlLang}
          lang={item.htmlLang}
          aria-current={selected ? 'page' : undefined}
          className={
            variant === 'landing'
              ? undefined
              : `block px-4 py-2.5 text-sm hover:bg-[var(--surface)] hover:text-[var(--gold)] ${
                  selected ? 'text-[var(--gold)] font-semibold' : 'text-[var(--text2)]'
                }`
          }
          onClick={() => {
            setOpen(false);
            onNavigate?.();
          }}
        >
          {item.label}
        </Link>
      </li>
    );
  });

  if (variant === 'drawer') {
    return (
      <div className="py-3 border-b border-[var(--border)]">
        <div className="text-xs font-semibold text-[var(--text3)] mb-1">{t('Language')}</div>
        <ul className="list-none m-0 p-0">{choices}</ul>
      </div>
    );
  }

  const currentLabel = PUBLIC_LOCALES.find((item) => item.id === current)?.label ?? 'English';
  const buttonClass =
    variant === 'landing'
      ? 'lp-lang-btn'
      : 'inline-flex items-center gap-1 hover:text-[var(--gold)] py-1 bg-transparent border-0 text-inherit font-medium cursor-pointer whitespace-nowrap shrink-0';

  return (
    <div ref={rootRef} className={variant === 'landing' ? 'lp-lang' : 'relative'}>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={menuId}
        aria-label={t('Language')}
        onClick={() => setOpen((value) => !value)}
      >
        <span lang={PUBLIC_LOCALES.find((item) => item.id === current)?.htmlLang}>{currentLabel}</span>
        <ChevronDown size={14} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          id={menuId}
          className={
            variant === 'landing'
              ? 'lp-lang-menu'
              : 'absolute start-0 top-full z-[100] mt-2 min-w-[11rem] list-none rounded-xl border border-[var(--gold)] bg-[var(--surface3)] py-1 shadow-xl m-0 p-0'
          }
        >
          {choices}
        </ul>
      )}
    </div>
  );
}
