'use client';

import Link from 'next/link';
import React, { createContext, useContext } from 'react';
import type { ComponentProps } from 'react';
import { FA_COPY } from './copy';
import { prefixFaHref } from './paths';

const FaContext = createContext(false);

export function FaProvider({ children }: { children: React.ReactNode }) {
  return <FaContext.Provider value={true}>{children}</FaContext.Provider>;
}

export function useFa(): boolean {
  return useContext(FaContext);
}

export function translate(fa: boolean, text: string): string {
  if (!fa || !text) return text;
  return FA_COPY[text] ?? text;
}

export function useT(): (text: string) => string {
  const fa = useFa();
  return (text: string) => translate(fa, text);
}

export function usePublicHref(): (href: string) => string {
  const fa = useFa();
  return (href: string) => (fa ? prefixFaHref(href) : href);
}

/** next/link that stays on /fa while the Farsi preview is open. */
export function PublicLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const to = usePublicHref();
  const nextHref = typeof href === 'string' ? to(href) : href;
  return <Link href={nextHref} {...rest} />;
}
