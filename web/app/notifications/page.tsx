'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { notificationClickPath } from '@/lib/notification-link';
import { clientAuthOrigin } from '@/lib/site-origin';
import { useT } from '@/lib/fa/locale';

type Notif = {
  id: number | string;
  type?: string | null;
  message?: string | null;
  is_read?: boolean | null;
  created_at?: string | null;
  link?: string | null;
  data?: any;
};

export default function NotificationsPage() {
  const t = useT();
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
    const href = notificationClickPath(n.link, n.type, clientAuthOrigin());
    if (href) router.push(href);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-2xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">
              {t('← Dashboard')}
            </Link>
            <h1 className="text-3xl font-extrabold mt-1">{t('Notifications')}</h1>
          </div>
          <button type="button" className="btn btn-secondary text-sm" onClick={markAllRead}>
            {t('Mark all read')}
          </button>
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading…')}</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center text-[var(--text3)]">{t('No notifications yet.')}</div>
        ) : (
          <ul className="space-y-2">
            {rows.map((n) => {
              const href = notificationClickPath(n.link, n.type, clientAuthOrigin());
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
                      <span className="text-[10px] font-bold text-[var(--gold)] uppercase">{t('New')}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--text3)] mt-1">
                    {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                    {n.type ? ` · ${n.type}` : ''}
                  </div>
                  <div className="flex gap-2 mt-3">
                    {href && (
                      <Link
                        href={href}
                        className="btn btn-primary text-sm"
                        onClick={() => {
                          markRead(n.id);
                        }}
                      >
                        {t('Open')}
                      </Link>
                    )}
                    {!n.is_read && (
                      <button
                        type="button"
                        className="btn btn-secondary text-sm"
                        onClick={() => markRead(n.id)}
                      >
                        {t('Mark read')}
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
