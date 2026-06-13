'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../components/Header';
import { Calendar as CalendarIcon, ArrowLeft, Clock } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'agenda'>('agenda');

  // Demo data
  const upcoming = [
    { date: '2026-06-15', day: 'Monday', title: 'VBeam PM - Downtown MedSpa', time: '09:00 AM', location: 'Austin, TX' },
    { date: '2026-06-16', day: 'Tuesday', title: 'GentleYAG Alignment - City Clinic', time: '02:00 PM', location: 'Phoenix, AZ' },
    { date: '2026-06-18', day: 'Thursday', title: 'CO2 Service - Metro Hospital', time: '10:30 AM', location: 'Los Angeles, CA' },
    { date: '2026-06-19', day: 'Friday', title: 'Handpiece Calibration - Elite Dermatology', time: '11:00 AM', location: 'Austin, TX' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <CalendarIcon size={32} className="text-[var(--gold)]" />
            <h1 className="text-4xl font-extrabold">Service Schedule</h1>
          </div>
          <Link href="/" className="text-[var(--gold)] hover:underline">← Back to Dashboard</Link>
        </div>

        {/* View Toggle */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button onClick={() => setView('month')} className={`btn ${view === 'month' ? 'btn-primary' : 'btn-secondary'}`}>Month View</button>
          <button onClick={() => setView('week')} className={`btn ${view === 'week' ? 'btn-primary' : 'btn-secondary'}`}>Week View</button>
          <button onClick={() => setView('agenda')} className={`btn ${view === 'agenda' ? 'btn-primary' : 'btn-secondary'}`}>Agenda View</button>
        </div>

        {/* Month View - Yellow border on each day */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="grid grid-cols-7 gap-px bg-[var(--border)] text-center text-sm">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="bg-[var(--surface)] py-2 font-medium">{day}</div>
              ))}
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="bg-[var(--surface)] min-h-[110px] p-2 border-2 border-[var(--gold)] hover:border-yellow-400 transition-colors relative">
                  <div className="text-xs text-[var(--text3)] font-medium">{i + 1}</div>
                  {i % 4 === 0 && <div className="text-[10px] mt-1 text-[var(--gold)]">PM Due</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Week View - Vertical */}
        {view === 'week' && (
          <div className="card p-6 space-y-8">
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day, idx) => (
              <div key={day} className="border-l-4 border-[var(--gold)] pl-6">
                <div className="font-bold text-xl mb-4">{day} • June {14 + idx}, 2026</div>
                <div className="space-y-4">
                  {upcoming.filter(item => item.day === day).map((item, i) => (
                    <div key={i} className="bg-[var(--surface3)] p-5 rounded-xl">
                      <div className="flex justify-between">
                        <div className="font-medium">{item.time} — {item.title}</div>
                        <div className="text-xs text-[var(--text3)]">{item.location}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Agenda View - Vertical with yellow borders between days */}
        {view === 'agenda' && (
          <div className="card p-6 space-y-8">
            {upcoming.map((item, index) => (
              <div key={index} className={`border-l-4 border-[var(--gold)] pl-6 pb-8 ${index < upcoming.length - 1 ? 'border-b border-[var(--gold)] border-dashed' : ''}`}>
                <div className="font-bold text-lg mb-2">{item.day}, {item.date}</div>
                <div className="bg-[var(--surface3)] p-5 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Clock size={20} className="text-[var(--gold)]" />
                    <div>
                      <div className="font-medium text-lg">{item.time}</div>
                      <div>{item.title}</div>
                      <div className="text-xs text-[var(--text3)] mt-1">{item.location}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-12 text-center text-sm text-[var(--text3)]">
          Full interactive calendar with drag &amp; drop and Google sync coming soon.
        </div>
      </div>
    </div>
  );
}