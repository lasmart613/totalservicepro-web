'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

type Notif = {
  id: number;
  type?: string | null;
  message?: string | null;
  is_read?: boolean | null;
  created_at?: string | null;
  link?: string | null;
  data?: any;
};

export default function NotificationsPage() {
  const supabase = getSupabaseClient();
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
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

  async function markRead(id: number) {
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);
    setRows((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  }

  async function markAllRead() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    setRows((prev) => prev.map((n) => ({ ...n, is_read: true })));
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
            {rows.map((n) => (
              <li
                key={n.id}
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
                  {n.link && (
                    <Link
                      href={n.link}
                      className="btn btn-primary text-sm"
                      onClick={() => markRead(n.id)}
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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
