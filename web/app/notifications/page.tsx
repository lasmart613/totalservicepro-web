'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { mapAndroidHtmlPath } from '@/lib/android-html-routes';

type Notif = {
  id: number | string;
  type?: string | null;
  message?: string | null;
  is_read?: boolean | null;
  created_at?: string | null;
  link?: string | null;
  data?: any;
};

/**
 * Normalize notification.link from Android assets or web routes into a Next.js path.
 * Fixes 404 when Open points at service_requests.html or awarded RFQ share URLs.
 */
export function resolveNotificationHref(link: string | null | undefined, type?: string | null): string | null {
  if (!link) {
    if (type === 'bid_accepted' || type === 'bid_awarded') return '/accepted-bids';
    return null;
  }
  let raw = String(link).trim();
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      raw = u.pathname + (u.search || '');
    }
  } catch {
    /* keep raw */
  }

  // Type-first for awards (even if link is wrong/legacy)
  if (type === 'bid_accepted' || type === 'bid_awarded' || type === 'bid_declined') {
    const id =
      (raw.match(/[?&]id=([^&]+)/i) ||
        raw.match(/[?&]request=([^&]+)/i) ||
        raw.match(/\/marketplace\/requests\/([^/?#]+)/i) ||
        raw.match(/service_requests\.html\?(?:.*&)?id=([^&]+)/i) ||
        [])[1] || null;
    return id
      ? `/accepted-bids?id=${encodeURIComponent(decodeURIComponent(id))}`
      : '/accepted-bids';
  }

  // Android asset → web
  const htmlId = raw.match(/^service_requests\.html\?(?:.*&)?id=([^&]+)/i);
  if (htmlId) return `/accepted-bids?id=${encodeURIComponent(decodeURIComponent(htmlId[1]))}`;
  if (/^accepted_bids\.html/i.test(raw)) {
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    return `/accepted-bids${q}`;
  }
  // Literal path that 404s on Next
  if (/^service_requests\.html/i.test(raw)) return '/service-requests';
  if (/^equipment_listing\.html\?(?:.*&)?id=([^&]+)/i.test(raw)) {
    const m = raw.match(/[?&]id=([^&]+)/i);
    if (m) return `/marketplace/listing/${encodeURIComponent(decodeURIComponent(m[1]))}`;
  }
  if (/^marketplace\.html/i.test(raw)) return '/marketplace';
  if (/^service_schedule\.html/i.test(raw)) return '/service-schedule';

  // Web paths already
  if (raw.startsWith('/accepted-bids')) return raw;
  // Awarded RFQs are no longer public; send parties to Accepted Bids
  const mktReq = raw.match(/^\/marketplace\/requests\/([^/?#]+)/i);
  if (mktReq) {
    if (type === 'bid_accepted' || type === 'bid_awarded' || type === 'bid_declined') {
      return `/accepted-bids?id=${encodeURIComponent(mktReq[1])}`;
    }
    return `/marketplace/requests/${mktReq[1]}`;
  }
  if (raw.startsWith('/marketplace/') || raw.startsWith('/service-') || raw.startsWith('/reports')) {
    return raw;
  }

  // Bare .html (with or without leading slash / relative to /notifications)
  if (/\.html(\?|$)/i.test(raw)) {
    const pathOnly = raw.split('?')[0];
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    const mapped = mapAndroidHtmlPath(pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`, q);
    if (mapped) return mapped;
  }

  if (raw.startsWith('/')) return raw;
  return `/${raw}`;
}

export default function NotificationsPage() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setRows((data || []) as Notif[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [supabase]);

  async function markRead(id: number | string) {
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);
    setRows((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  }

  async function markAllRead() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    setRows((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function openNotif(n: Notif) {
    await markRead(n.id);
    const href =
      resolveNotificationHref(n.link, n.type) ||
      (n.type === 'bid_accepted' || n.type === 'bid_awarded' ? '/accepted-bids' : null);
    if (href) router.push(href);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-2xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">
              ← Dashboard
            </Link>
            <h1 className="text-3xl font-extrabold mt-1">Notifications</h1>
          </div>
          <button type="button" className="btn btn-secondary text-sm" onClick={markAllRead}>
            Mark all read
          </button>
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center text-[var(--text3)]">No notifications yet.</div>
        ) : (
          <ul className="space-y-2">
            {rows.map((n) => {
              const href = resolveNotificationHref(n.link, n.type);
              const canOpen = !!(href || n.type === 'bid_accepted' || n.type === 'bid_awarded');
              return (
                <li
                  key={String(n.id)}
                  className={
                    'card p-4 ' + (!n.is_read ? 'border-[var(--gold-border)] bg-[var(--gold-glow)]' : '')
                  }
                >
                  <div className="flex justify-between gap-2">
                    <div className="text-sm font-medium">{n.message || n.type}</div>
                    {!n.is_read && (
                      <span className="text-[10px] font-bold text-[var(--gold)] uppercase">New</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--text3)] mt-1">
                    {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                    {n.type ? ` · ${n.type}` : ''}
                  </div>
                  <div className="flex gap-2 mt-3">
                    {canOpen && (
                      <Link
                        href={href || '/accepted-bids'}
                        className="btn btn-primary text-sm"
                        onClick={() => {
                          markRead(n.id);
                        }}
                      >
                        Open
                      </Link>
                    )}
                    {!n.is_read && (
                      <button
                        type="button"
                        className="btn btn-secondary text-sm"
                        onClick={() => markRead(n.id)}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
