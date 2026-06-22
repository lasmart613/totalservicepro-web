'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

// Settings page uses browser APIs (localStorage) and must not be statically prerendered.
// force-dynamic + safe client-only hydration prevents build errors like "Export encountered an error on /settings/page"

export default function Settings() {
  const [defaultScheduleView, setDefaultScheduleView] = useState('Month');
  const [weekStartsOn, setWeekStartsOn] = useState('Sunday');
  const [showCompleted, setShowCompleted] = useState(true);
  const [showCancelled, setShowCancelled] = useState(true);
  const [timeFormat, setTimeFormat] = useState('12h');
  const [timeZone, setTimeZone] = useState('');
  const [browserNotif, setBrowserNotif] = useState(true);
  const [sound, setSound] = useState(true);

  const TIME_ZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Moscow',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Seoul',
    'Asia/Hong_Kong',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Perth',
    'America/Toronto',
    'America/Vancouver',
    'America/Sao_Paulo',
    'America/Mexico_City',
  ];

  // Load from localStorage only on client
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDefaultScheduleView(localStorage.getItem('defaultScheduleView') || 'Month');
      setWeekStartsOn(localStorage.getItem('weekStartsOn') || 'Sunday');
      setShowCompleted(localStorage.getItem('showCompletedTickets') !== 'false');
      setShowCancelled(localStorage.getItem('showCancelledTickets') !== 'false');
      setTimeFormat(localStorage.getItem('timeFormat') || '12h');
      setTimeZone(localStorage.getItem('timeZone') || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setBrowserNotif(localStorage.getItem('browserNotifications') !== 'false');
      setSound(localStorage.getItem('notificationSound') !== 'false');
    }
  }, []);

  const save = (key: string, value: any) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  };

  const toggleTheme = () => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const isLight = html.classList.toggle('light');
    localStorage.setItem('tsp_theme', isLight ? 'light' : 'dark');
  };

  const updateScheduleView = (val: string) => {
    setDefaultScheduleView(val);
    save('defaultScheduleView', val);
  };

  const updateWeekStart = (val: string) => {
    setWeekStartsOn(val);
    save('weekStartsOn', val);
  };

  const toggleCompleted = () => {
    const next = !showCompleted;
    setShowCompleted(next);
    save('showCompletedTickets', next);
  };

  const toggleCancelled = () => {
    const next = !showCancelled;
    setShowCancelled(next);
    save('showCancelledTickets', next);
  };

  const updateTimeFormat = (val: string) => {
    setTimeFormat(val);
    save('timeFormat', val);
  };

  const updateTimeZone = (val: string) => {
    setTimeZone(val);
    save('timeZone', val);
  };

  const toggleBrowserNotif = () => {
    const next = !browserNotif;
    setBrowserNotif(next);
    save('browserNotifications', next);
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    save('notificationSound', next);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-md mx-auto w-full p-6">
        <h1 className="text-xl font-bold mb-4">⚙️ Settings</h1>

        <div className="card p-5 space-y-6 text-sm">
          {/* Theme */}
          <div>
            <div className="font-semibold mb-2">Theme</div>
            <button onClick={toggleTheme} className="btn btn-secondary">Toggle Light / Dark</button>
            <div className="text-xs text-[var(--text3)] mt-1">Follows system preference by default (persisted).</div>
          </div>

          {/* Schedule */}
          <div>
            <div className="font-semibold mb-2">Default Schedule View</div>
            <div className="flex gap-2">
              {['Month', 'Week', 'Day', 'Agenda'].map(v => (
                <button key={v} onClick={() => updateScheduleView(v)} className={`btn btn-secondary text-xs px-3 py-1 ${defaultScheduleView === v ? 'bg-[var(--gold)] text-black' : ''}`}>{v}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-semibold mb-2">Week Starts On</div>
            <div className="flex gap-2">
              {['Sunday', 'Monday'].map(v => (
                <button key={v} onClick={() => updateWeekStart(v)} className={`btn btn-secondary text-xs px-3 py-1 ${weekStartsOn === v ? 'bg-[var(--gold)] text-black' : ''}`}>{v}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>Show Completed Tickets</div>
            <button onClick={toggleCompleted} className={`px-3 py-1 rounded text-xs ${showCompleted ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
              {showCompleted ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>Show Cancelled Tickets</div>
            <button onClick={toggleCancelled} className={`px-3 py-1 rounded text-xs ${showCancelled ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
              {showCancelled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Date & Time */}
          <div>
            <div className="font-semibold mb-2">Date & Time Format</div>
            <div className="flex gap-2 mb-2">
              <span className="text-xs self-center">Time:</span>
              {['12h', '24h'].map(v => (
                <button key={v} onClick={() => updateTimeFormat(v)} className={`btn btn-secondary text-xs px-3 py-1 ${timeFormat === v ? 'bg-[var(--gold)] text-black' : ''}`}>{v}</button>
              ))}
            </div>
            <div>
              <label className="text-xs">Time Zone</label>
              <select
                value={timeZone}
                onChange={e => updateTimeZone(e.target.value)}
                className="select text-xs mt-1 w-full"
              >
                {TIME_ZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
                {/* If a custom value was previously saved and is not in the list, still allow it to display */}
                {timeZone && !TIME_ZONES.includes(timeZone) && (
                  <option value={timeZone}>{timeZone} (custom)</option>
                )}
              </select>
            </div>
          </div>

          {/* Notifications */}
          <div>
            <div className="font-semibold mb-2">Notifications</div>
            <div className="flex items-center justify-between mb-1">
              <div>Browser Notifications</div>
              <button onClick={toggleBrowserNotif} className={`px-3 py-1 rounded text-xs ${browserNotif ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
                {browserNotif ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>Sound</div>
              <button onClick={toggleSound} className={`px-3 py-1 rounded text-xs ${sound ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
                {sound ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div>
            <div className="font-semibold mb-2">Account</div>
            <button onClick={async () => { const s = getSupabaseClient(); await s.auth.signOut(); window.location.href = '/login'; }} className="btn btn-secondary text-red-400 border-red-900/40">Sign Out Everywhere</button>
          </div>

          <div className="text-xs text-[var(--text3)] pt-2 border-t border-[var(--border)]">
            Web build of Total Service Pro. All data lives in Supabase — fully shared with the Android app.
            <br />Preferences saved locally for now.
          </div>
        </div>
      </div>
    </div>
  );
}
