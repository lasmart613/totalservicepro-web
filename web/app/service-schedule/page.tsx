'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';

export default function ServiceSchedule() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-xl mx-auto w-full px-4 py-6">
        <h1 className="text-2xl font-extrabold mb-1">📅 Service Schedule</h1>
        <p className="text-sm text-[var(--text3)] mb-6">Tickets, assignments &amp; upcoming work</p>

        <div className="card p-8 text-center">
          <div className="text-6xl mb-4">🚧</div>
          <div className="font-bold text-xl mb-2">Coming Soon</div>
          <p className="text-sm text-[var(--text3)] mb-4">
            The full Service Schedule (tickets &amp; assignments, calendar view, dispatching) is available today in the Total Service Pro Android app.
          </p>
          <p className="text-sm text-[var(--text3)] mb-4">
            This web page is a placeholder. The complete implementation is ported from <code>service_schedule.html</code> in the Android assets.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/hub" className="btn btn-primary">Back to Tech Hub</Link>
            <Link href="/" className="btn btn-secondary">Dashboard</Link>
          </div>
          <div className="mt-6 text-xs text-[var(--text3)]">
            Use the Android app for the full experience, or check back after the next web port.
          </div>
        </div>
      </div>
    </div>
  );
}
