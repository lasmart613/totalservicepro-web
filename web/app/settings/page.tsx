'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { signOutAndClearIdentity } from '@/lib/auth-session';
import { applyStoredTheme, togglePersistedTheme } from '@/lib/theme';
import { MembershipsSettings } from '@/components/OrgSwitcher';
import { APP_CHANNEL, APP_VERSION, buildLabel } from '@/lib/app-version';
import { useSetSiteLanguage, useSiteLocale, useT } from '@/lib/fa/locale';
import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/locales';
import { useAutoOpenCitedManual } from '@/components/useAssistantCitationOpen';

export const dynamic = 'force-dynamic';

// Settings page uses browser APIs (localStorage) and must not be statically prerendered.
// force-dynamic + safe client-only hydration prevents build errors like "Export encountered an error on /settings/page"

export default function Settings() {
  const t = useT();
  const siteLanguage = useSiteLocale();
  const setSiteLanguage = useSetSiteLanguage();
  const [defaultScheduleView, setDefaultScheduleView] = useState('Month');
  const [weekStartsOn, setWeekStartsOn] = useState('Sunday');
  const [showCompleted, setShowCompleted] = useState(true);
  const [showCancelled, setShowCancelled] = useState(true);
  const [timeFormat, setTimeFormat] = useState('12h');
  const [timeZone, setTimeZone] = useState('');
  const [browserNotif, setBrowserNotif] = useState(true);
  const [sound, setSound] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [autoOpenCited, setAutoOpenCited] = useAutoOpenCitedManual();

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
      setTheme(applyStoredTheme());
    }
  }, []);

  const save = (key: string, value: any) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  };

  const toggleTheme = () => {
    setTheme(togglePersistedTheme());
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

  const toggleAutoOpenCited = () => {
    setAutoOpenCited(!autoOpenCited);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-md mx-auto w-full p-6">
        <h1 className="text-xl font-bold mb-4">⚙️ {t('Settings')}</h1>

        <div className="card p-5 space-y-6 text-sm">
          <div>
            <div className="font-semibold mb-2">{t('Language')}</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('Language')}>
              {PUBLIC_LOCALES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  lang={item.htmlLang}
                  onClick={() => setSiteLanguage(item.id as PublicLocale)}
                  className={`btn btn-secondary text-xs px-3 py-1 ${siteLanguage === item.id ? 'bg-[var(--gold)] text-black' : ''}`}
                  aria-pressed={siteLanguage === item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-[var(--text3)] mt-1">
              {t('Saved on this device. The public language menu uses this same choice.')}
            </div>
          </div>

          {/* Theme */}
          <div>
            <div className="font-semibold mb-2">{t('Theme')}</div>
            <button onClick={toggleTheme} className="btn btn-secondary">{t('Toggle Light / Dark')}</button>
            <div className="text-xs text-[var(--text3)] mt-1">
              {t('Current:')} {theme === 'light' ? t('Light') : t('Dark')}. {t('Saved on this device after you choose. Until then, follows your system Light/Dark setting.')}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <div className="font-semibold mb-2">{t('Default Schedule View')}</div>
            <div className="flex flex-wrap gap-2">
              {['Month', 'Week', 'Day', 'Agenda'].map(v => (
                <button key={v} onClick={() => updateScheduleView(v)} className={`btn btn-secondary text-xs px-3 py-1 ${defaultScheduleView === v ? 'bg-[var(--gold)] text-black' : ''}`}>{t(v)}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="font-semibold mb-2">{t('Week Starts On')}</div>
            <div className="flex gap-2">
              {['Sunday', 'Monday'].map(v => (
                <button key={v} onClick={() => updateWeekStart(v)} className={`btn btn-secondary text-xs px-3 py-1 ${weekStartsOn === v ? 'bg-[var(--gold)] text-black' : ''}`}>{t(v)}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>{t('Show Completed Tickets')}</div>
            <button onClick={toggleCompleted} className={`px-3 py-1 rounded text-xs ${showCompleted ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
              {showCompleted ? t('ON') : t('OFF')}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>{t('Show Cancelled Tickets')}</div>
            <button onClick={toggleCancelled} className={`px-3 py-1 rounded text-xs ${showCancelled ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
              {showCancelled ? t('ON') : t('OFF')}
            </button>
          </div>

          {/* Date & Time */}
          <div>
            <div className="font-semibold mb-2">{t('Date & Time Format')}</div>
            <div className="flex gap-2 mb-2">
              <span className="text-xs self-center">{t('Time:')}</span>
              {['12h', '24h'].map(v => (
                <button key={v} onClick={() => updateTimeFormat(v)} className={`btn btn-secondary text-xs px-3 py-1 ${timeFormat === v ? 'bg-[var(--gold)] text-black' : ''}`}>{v}</button>
              ))}
            </div>
            <div>
              <label className="text-xs">{t('Time Zone')}</label>
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
            <div className="font-semibold mb-2">{t('Notifications')}</div>
            <div className="flex items-center justify-between mb-1">
              <div>{t('Browser Notifications')}</div>
              <button onClick={toggleBrowserNotif} className={`px-3 py-1 rounded text-xs ${browserNotif ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
                {browserNotif ? t('ON') : t('OFF')}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>{t('Sound')}</div>
              <button onClick={toggleSound} className={`px-3 py-1 rounded text-xs ${sound ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}>
                {sound ? t('ON') : t('OFF')}
              </button>
            </div>
          </div>

          <div>
            <div className="font-semibold mb-2">{t('AI Assistant')}</div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div>{t('Auto-open cited manual page')}</div>
                <div className="text-xs text-[var(--text3)] mt-1">
                  {t('When an answer cites a manual page, open it next to the answer. On a phone it opens full screen after the answer is shown. Saved on this device.')}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleAutoOpenCited}
                aria-pressed={autoOpenCited}
                className={`px-3 py-1 rounded text-xs shrink-0 ${autoOpenCited ? 'bg-green-600' : 'bg-[var(--surface)] border'}`}
              >
                {autoOpenCited ? t('ON') : t('OFF')}
              </button>
            </div>
          </div>

          <MembershipsSettings />

          <div>
            <div className="font-semibold mb-2">{t('Account')}</div>
            <button onClick={async () => { const s = getSupabaseClient(); await signOutAndClearIdentity(s); window.location.href = '/login'; }} className="btn btn-secondary text-red-400 border-red-900/40">{t('Sign Out Everywhere')}</button>
          </div>

          <div className="pt-2 border-t border-[var(--border)]">
            <div className="font-semibold mb-2">{t('About')}</div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[var(--text3)]">{t('Version')}</span>
              <span className="text-[var(--gold)] font-semibold">{APP_VERSION}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[var(--text3)]">{t('Build')}</span>
              <span>{buildLabel()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text3)]">{t('Channel')}</span>
              <span className="capitalize">{APP_CHANNEL}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
