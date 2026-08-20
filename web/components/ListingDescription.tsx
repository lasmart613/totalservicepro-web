'use client';

import React, { useMemo } from 'react';
import { renderListingCopyHtml, toPlainListingText } from '@/lib/marketplace/listing-copy';

export function ListingDescription({
  text,
  className = '',
  compact = false,
}: {
  text?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const html = useMemo(() => renderListingCopyHtml(text), [text]);
  if (!html) return null;
  return (
    <div
      className={`listing-copy ${compact ? 'listing-copy-compact' : ''} ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Card snippet: formatted meaning, never raw markdown/HTML source. */
export function ListingDescriptionSnippet({
  text,
  className = '',
}: {
  text?: string | null;
  className?: string;
}) {
  const plain = useMemo(() => toPlainListingText(text), [text]);
  if (!plain) return null;
  return <p className={`text-sm text-[var(--text3)] line-clamp-3 ${className}`.trim()}>{plain}</p>;
}
