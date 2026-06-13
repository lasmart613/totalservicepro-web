'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');

  // Real service calls from Supabase (demo data for now - will connect to real query)
  const myServiceCalls = [
    { id: 1, date: '2026-06-15', title: 'VBeam PM - Downtown MedSpa', time: '09:00 AM', location: 'Austin, TX' },
    { id: 2, date: '2026-06-16', title: 'GentleYAG Alignment - City Clinic', time: '02:00 PM', location: 'Phoenix, AZ' },
    { id: 3, date: '2026-06-18', title: 'CO2 Service - Metro Hospital', time: '10:30 AM', location: 'Los Angeles, CA' },
    { id: 4, date: '2026-06-19', title: 'Handpiece Calibration - Elite Dermatology', time: '11:00 AM', location: 'Austin, TX' },
  ];

  const getDayOfMonth = (dayNum: number) => {
    return myServiceCalls.find(call => parseInt(call.date.split('-')[2]) === dayNum);
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

        {/* View Toggle */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button onClick={() => setView('month')} className={`btn ${view === 'month' ? 'btn-primary' : 'btn-secondary'}`}>Month</button>
          <button onClick={() => setView('week')} className={`btn ${view === 'week' ? 'btn-primary' : 'btn-secondary'}`}>Week</button>
          <button onClick={() => setView('day')} className={`btn ${view === 'day' ? 'btn-primary' : 'btn-secondary'}`}>Day</button>
          <button onClick={() => setView('agenda')} className={`btn ${view === 'agenda' ? 'btn-primary' : 'btn-secondary'}`}>Agenda</button>
        </div>

        {/* Month View - Real Calendar */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-3xl font-bold">June 2026</div>
              <button className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)] text-center text-sm">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="bg-[var(--surface)] py-3 font-medium">{day}</div>
              ))}
              {Array.from({ length: 35 }).map((_, i) => {
                const dayNum = i + 1;
                const call = getDayOfMonth(dayNum);
                return (
                  <div key={i} className="bg-[var(--surface)] min-h-[100px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] transition-colors relative">
                    <div className="text-xs text-[var(--text3)] font-medium">{dayNum}</div>
                    {call && (
                      <div className="text-[10px] mt-1 text-[var(--gold)] font-medium truncate">• {call.title.split(' - ')[0]}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Week View - Vertical Sun to Sat */}
        {view === 'week' && (
          <div className="card p-6 space-y-8">
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dayName) => {
              const calls = myServiceCalls.filter(c => {
                const callDay = new Date(c.date).toLocaleString('en-US', { weekday: 'long' });
                return callDay === dayName;
              });
              return (
                <div key={dayName} className="border-l-4 border-[var(--gold)] pl-6">
                  <div className="font-bold text-xl mb-4">{dayName}</div>
                  {calls.length > 0 ? (
                    calls.map(call => (
                      <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl mb-3">
                        <div className="font-medium">{call.time} — {call.title}</div>
                        <div className="text-xs text-[var(--text3)]">{call.location}</div>
                      </div>
                    ))
                  ) : (
                    <div className="pl-4 text-[var(--text3)]">No calls scheduled</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Day & Agenda Views */}
        {(view === 'day' || view === 'agenda') && (
          <div className="card p-6 space-y-6">
            <h3 className="font-bold text-xl mb-4">Upcoming Service Calls</h3>
            {myServiceCalls.map(call => (
              <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl">
                <div className="font-medium text-lg">{call.time} — {call.title}</div>
                <div className="text-sm text-[var(--text3)]">{call.date} • {call.location}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}