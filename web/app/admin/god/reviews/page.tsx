'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchGodMe, godAuthHeader } from '@/lib/god-client';
import { useT } from '@/lib/fa/locale';

type ModerationRow = {
  id: string;
  service_organization_id: number;
  customer_organization_id: number;
  stars: number;
  body: string | null;
  reply_body: string | null;
  hidden_at: string | null;
  hidden_reason: string | null;
  created_at: string | null;
  job_key: string;
};

export default function GodReviewsPage() {
  const t = useT();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ModerationRow[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  async function load() {
    const headers = await godAuthHeader();
    const res = await fetch('/api/god/reviews', { headers, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(t('Directory unavailable'));
      return;
    }
    setRows(Array.isArray(json.reviews) ? json.reviews : []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const god = await fetchGodMe();
      if (cancelled) return;
      setAllowed(god);
      if (god) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function moderate(row: ModerationRow, hidden: boolean) {
    setMessage('');
    const headers = await godAuthHeader();
    const res = await fetch('/api/god/reviews', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: row.id,
        hidden,
        reason: reasons[row.id] || row.hidden_reason || '',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(t(json.error || 'A reason is required to hide a review.'));
      return;
    }
    setMessage(t(hidden ? 'Review hidden.' : 'Review is public again.'));
    await load();
  }

  if (allowed == null) return <p className="text-[var(--text3)]">{t('Loading reviews…')}</p>;
  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto w-full py-16 text-center">
        <h1 className="text-3xl font-extrabold">404</h1>
        <Link href="/" className="btn btn-primary mt-6">{t('Dashboard')}</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">{t('Platform review moderation')}</h1>
      <p className="text-sm text-[var(--text3)] mb-6 max-w-3xl">
        {t('Hidden from the public directory')}
      </p>
      {message ? <p className="text-sm mb-4">{message}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text3)]">{t('No reviews yet.')}</p>
      ) : (
        <ul className="space-y-3 max-w-3xl">
          {rows.map((row) => (
            <li key={row.id} className="card p-4">
              <p className="text-xs text-[var(--text3)]">
                {t('Stars')} {row.stars} · {row.job_key}
                {row.hidden_at ? ` · ${t('Hidden from the public directory')}` : ''}
              </p>
              {row.body ? <p className="text-sm mt-2 whitespace-pre-wrap">{row.body}</p> : null}
              {row.reply_body ? (
                <p className="text-sm mt-2">
                  <span className="font-bold">{t('Company reply')}: </span>
                  {row.reply_body}
                </p>
              ) : null}
              <label className="block text-sm mt-3">
                <span className="font-bold">{t('Reason for hiding')}</span>
                <input
                  className="input w-full mt-1"
                  value={reasons[row.id] ?? row.hidden_reason ?? ''}
                  onChange={(e) => setReasons((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
              </label>
              <div className="flex gap-2 mt-3">
                <button type="button" className="btn btn-secondary" onClick={() => void moderate(row, true)}>
                  {t('Hide review')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void moderate(row, false)}>
                  {t('Unhide review')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
