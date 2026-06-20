'use client';

import React from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function Settings() {
  const supabase = getSupabaseClient();

  const toggleTheme = () => {
    const html = document.documentElement;
    const isLight = html.classList.toggle('light');
    localStorage.setItem('tsp_theme', isLight ? 'light' : 'dark');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-md mx-auto w-full p-6">
        <h1 className="text-xl font-bold mb-4">⚙️ Settings</h1>

        <div className="card p-5 space-y-6 text-sm">
          <div>
            <div className="font-semibold mb-2">Theme</div>
            <button onClick={toggleTheme} className="btn btn-secondary">Toggle Light / Dark</button>
            <div className="text-xs text-[var(--text3)] mt-1">Follows system preference by default (persisted).</div>
          </div>

          <div>
            <div className="font-semibold mb-2">Account</div>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }} className="btn btn-secondary text-red-400 border-red-900/40">Sign Out Everywhere</button>
          </div>

          <div className="text-xs text-[var(--text3)] pt-2 border-t border-[var(--border)]">
            Web build of Total Service Pro. All data lives in Supabase — fully shared with the Android app.
            <br />Offline support, advanced calculators, and additional modules coming in later phases.
          </div>
        </div>
      </div>
    </div>
  );
}
