'use client';

import React, { useEffect, useId, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/lib/supabase/client';
import { WHAT_HAPPENED_MAX, WHAT_HAPPENED_MIN } from '@/lib/product-issues';

type Variant = 'app' | 'landing';

export function ReportIssueControl({ variant = 'app' }: { variant?: Variant }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [whatHappened, setWhatHappened] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPageUrl(typeof window !== 'undefined' ? window.location.href : '');
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionEmail(session?.user?.email || null);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const supabase = getSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch('/api/product-issues', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          whatHappened,
          pageUrl,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          email: session?.user?.email ? undefined : guestEmail.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        toast.error(json.error || 'Could not send the report');
        return;
      }
      toast.success(json.message || 'Thanks — the Total Service Pro team has your report.');
      setWhatHappened('');
      setGuestEmail('');
      setOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not send the report');
    } finally {
      setSending(false);
    }
  }

  const triggerClass =
    variant === 'landing'
      ? 'lp-btn lp-btn-ghost lp-report-btn'
      : 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold-border)] bg-transparent px-2.5 py-1.5 text-xs font-semibold text-[var(--text2)] hover:text-[var(--gold)] hover:border-[var(--gold)]';

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Report an Issue"
        aria-label="Report an Issue"
      >
        <CircleAlert size={16} aria-hidden className={variant === 'landing' ? undefined : 'shrink-0'} />
        <span className={variant === 'app' ? 'hidden sm:inline' : undefined}>Report an Issue</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-start justify-end p-3 sm:p-4 pointer-events-none">
          <button
            type="button"
            className="absolute inset-0 bg-black/35 pointer-events-auto"
            aria-label="Close report form"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative pointer-events-auto mt-12 w-full max-w-md rounded-xl border border-[var(--gold)] bg-[var(--surface3,#1F2937)] text-[var(--text,#F3E8D8)] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
              <div>
                <h2 id={titleId} className="text-base font-bold text-[var(--gold,#FBBF24)]">
                  Report an Issue
                </h2>
                <p className="text-xs text-[var(--text3,#9CA3AF)] mt-0.5">
                  Sends a short note to the Total Service Pro product team. Screenshot upload can wait.
                </p>
              </div>
              <button
                type="button"
                className="p-1 rounded text-[var(--text2)] hover:text-[var(--gold)]"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit} className="px-4 pb-4 flex flex-col gap-3">
              <label className="block text-sm">
                <span className="block text-xs font-semibold mb-1">What happened</span>
                <textarea
                  required
                  minLength={WHAT_HAPPENED_MIN}
                  maxLength={WHAT_HAPPENED_MAX}
                  rows={4}
                  value={whatHappened}
                  onChange={(e) => setWhatHappened(e.target.value)}
                  placeholder="What did you expect, and what did you see instead?"
                  className="w-full rounded-lg border border-[var(--border,#4B5563)] bg-[var(--surface,#111827)] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs font-semibold mb-1">Page / URL</span>
                <input
                  type="text"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border,#4B5563)] bg-[var(--surface,#111827)] px-3 py-2 text-xs"
                />
              </label>
              {sessionEmail ? (
                <p className="text-[11px] text-[var(--text3,#9CA3AF)]">
                  We will email a confirmation to {sessionEmail}.
                </p>
              ) : (
                <label className="block text-sm">
                  <span className="block text-xs font-semibold mb-1">Email (optional)</span>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="So we can confirm we received your report"
                    autoComplete="email"
                    className="w-full rounded-lg border border-[var(--border,#4B5563)] bg-[var(--surface,#111827)] px-3 py-2 text-sm"
                  />
                </label>
              )}
              <p className="text-[11px] text-[var(--text3,#9CA3AF)]">
                Optional screenshot: not required for this tester build.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className="btn btn-secondary text-sm px-3 py-1.5" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-sm px-3 py-1.5" disabled={sending}>
                  {sending ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
