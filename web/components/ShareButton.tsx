'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { shareContent } from '@/lib/share';

type Props = {
  title: string;
  text: string;
  url: string;
  /** Compact icon button (default) or full labeled button */
  variant?: 'icon' | 'button';
  className?: string;
  label?: string;
};

/** iOS / Android style share glyph (node with outgoing arcs). */
export function ShareIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51 15.42 17.49" />
      <path d="M15.41 6.51 8.59 10.49" />
    </svg>
  );
}

export function ShareButton({
  title,
  text,
  url,
  variant = 'icon',
  className = '',
  label = 'Share',
}: Props) {
  const [busy, setBusy] = useState(false);

  async function onShare(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const result = await shareContent({ title, text, url });
      if (result === 'shared') {
        toast.success('Shared');
      } else if (result === 'copied') {
        toast.success('Link copied — paste into email, text, or chat');
      } else if (result === 'mailto') {
        toast.message('Opening email…');
      } else if (result === 'failed') {
        toast.error('Could not share. Copy this link: ' + url);
      }
    } finally {
      setBusy(false);
    }
  }

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={onShare}
        disabled={busy}
        className={
          className ||
          'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[var(--border2)] bg-[var(--surface2)] text-sm font-bold hover:border-[var(--gold)] transition-colors'
        }
        title="Share via email, text, or apps"
      >
        <ShareIcon className="w-4 h-4 text-[var(--gold)]" />
        {busy ? 'Sharing…' : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onShare}
      disabled={busy}
      aria-label="Share"
      title="Share via email, text, or apps"
      className={
        className ||
        'inline-flex items-center justify-center w-10 h-10 rounded-full border border-[var(--border2)] bg-[var(--surface2)] text-[var(--gold)] hover:border-[var(--gold)] transition-colors shrink-0'
      }
    >
      <ShareIcon />
    </button>
  );
}
