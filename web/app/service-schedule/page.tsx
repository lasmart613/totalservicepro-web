'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');

  const myServiceCalls = [
    { id: 1, date: '2026-06-15', title: 'VBeam PM - Downtown MedSpa', time: '09:00 AM' },
    { id: 2, date: '2026-06-16', title: 'GentleYAG Alignment - City Clinic', time: '02:00 PM' },
    { id: 3, date: '2026-06-18', title: 'CO2 Service - Metro Hospital', time: '10:30 AM' },
    { id: 4, date: '2026-06-19', title: 'Handpiece Calibration', time: '11:00 AM' },
  ];

  // Generate real June 2026 calendar (starts on Monday)
  const year = 2026;
  const month = 5; // June (0-indexed)
  const firstDay = new Date(year, month, 1).getDay(); // 1 = Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate(); // 30

  const calendarDays = [];
  // Add empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  // Add actual days
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push(d);
  }

  const hasService = (day: number | null) => {
    if (!day) return false;
    return myServiceCalls.some(call => parseInt(call.date.split('-')[2]) === day);
  };

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

        <div className="flex gap-2 mb-8">
          <button onClick={() => setView('month')} className={`btn ${view === 'month' ? 'btn-primary' : ''}`}>Month</button>
          <button onClick={() => setView('week')} className={`btn ${view === 'week' ? 'btn-primary' : ''}`}>Week</button>
          <button onClick={() => setView('day')} className={`btn ${view === 'day' ? 'btn-primary' : ''}`}>Day</button>
          <button onClick={() => setView('agenda')} className={`btn ${view === 'agenda' ? 'btn-primary' : ''}`}>Agenda</button>
        </div>

        {/* MONTH VIEW - Real Calendar */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-3xl font-bold">June 2026</div>
              <button className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)] text-center text-sm">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="bg-[var(--surface)] py-3 font-medium">{d}</div>
              ))}
              {calendarDays.map((day, i) => (
                <div key={i} className="bg-[var(--surface)] min-h-[100px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] relative">
                  {day && (
                    <>
                      <div className="text-sm">{day}</div>
                      {hasService(day) && <div className="text-[10px] mt-1 text-[var(--gold)]">● Service</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WEEK VIEW - Vertical */}
        {view === 'week' && (
          <div className="card p-6 space-y-8">
            {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(dayName => (
              <div key={dayName} className="border-l-4 border-[var(--gold)] pl-6">
                <div className="font-bold mb-4">{dayName}</div>
                {myServiceCalls.filter(c => new Date(c.date).toLocaleDateString('en-US',{weekday:'long'}) === dayName).map(call => (
                  <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl mb-3">
                    <div>{call.time} — {call.title}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* DAY + AGENDA */}
        {(view === 'day' || view === 'agenda') && (
          <div className="card p-6 space-y-6">
            <h3 className="font-bold text-xl">Upcoming Service Calls</h3>
            {myServiceCalls.map(call => (
              <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl">
                <div className="font-medium">{call.time} — {call.title}</div>
                <div className="text-sm text-[var(--text3)]">{call.date}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}