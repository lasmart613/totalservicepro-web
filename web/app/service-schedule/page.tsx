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

  const hasCallOnDay = (dayNum: number) => myServiceCalls.some(call => {
    const d = parseInt(call.date.split('-')[2]);
    return d === dayNum;
  });

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

        {/* MONTH VIEW - Proper Calendar */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-3xl font-bold">June 2026</div>
              <button className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} className="bg-[var(--surface)] py-3 text-center font-medium text-sm border-b border-[var(--border)]">{d}</div>
              ))}
              {Array.from({ length: 35 }).map((_, i) => {
                const day = i + 1;
                const call = hasCallOnDay(day);
                return (
                  <div key={i} className="bg-[var(--surface)] min-h-[110px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] relative">
                    <span className="text-sm">{day}</span>
                    {call && <div className="text-[10px] text-[var(--gold)] mt-1">● Service</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* WEEK VIEW - Vertical */}
        {view === 'week' && (
          <div className="card p-6 space-y-8">
            {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day => (
              <div key={day} className="border-l-4 border-[var(--gold)] pl-6">
                <div className="font-bold mb-3">{day}</div>
                {myServiceCalls.filter(c => new Date(c.date).toLocaleDateString('en-US', { weekday: 'long' }) === day).map(call => (
                  <div key={call.id} className="bg-[var(--surface3)] p-4 rounded-xl mb-3">
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
            <h3 className="font-bold">Upcoming Calls</h3>
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