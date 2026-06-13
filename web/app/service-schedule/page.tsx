'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');
  const [currentMonth, setCurrentMonth] = useState(6); // June 2026

  const myServiceCalls = [
    { id: 1, date: '2026-06-15', title: 'VBeam PM - Downtown MedSpa', time: '09:00 AM' },
    { id: 2, date: '2026-06-16', title: 'GentleYAG Alignment - City Clinic', time: '02:00 PM' },
    { id: 3, date: '2026-06-18', title: 'CO2 Service - Metro Hospital', time: '10:30 AM' },
    { id: 4, date: '2026-06-19', title: 'Handpiece Calibration', time: '11:00 AM' },
  ];

  const monthName = new Date(2026, currentMonth - 1, 1).toLocaleString('default', { month: 'long' });

  const nextMonth = () => setCurrentMonth(prev => prev === 12 ? 1 : prev + 1);
  const prevMonth = () => setCurrentMonth(prev => prev === 1 ? 12 : prev - 1);

  // Month View - Real calendar
  const firstDay = new Date(2026, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(2026, currentMonth, 0).getDate();
  const calendarDays = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

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

        {/* MONTH VIEW */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button onClick={prevMonth} className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-3xl font-bold">{monthName} 2026</div>
              <button onClick={nextMonth} className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                <div key={d} className="bg-[var(--surface)] py-3 text-center font-medium text-sm">{d}</div>
              ))}
              {calendarDays.map((day, i) => (
                <div key={i} className="bg-[var(--surface)] min-h-[100px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] relative">
                  {day && (
                    <>
                      <div className="text-sm">{day}</div>
                      {myServiceCalls.some(c => parseInt(c.date.split('-')[2]) === day) && (
                        <div className="text-[10px] mt-1 text-[var(--gold)]">● Service</div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WEEK VIEW - Horizontal Sun → Sat with vertical calls */}
        {view === 'week' && (
          <div className="card p-6 overflow-x-auto">
            <div className="grid grid-cols-7 gap-2 min-w-[900px]">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(dayName => (
                <div key={dayName} className="border border-[var(--border)] rounded-lg p-3 min-h-[400px]">
                  <div className="font-bold text-center mb-4 pb-2 border-b border-[var(--border)]">{dayName}</div>
                  <div className="space-y-3">
                    {myServiceCalls
                      .filter(c => new Date(c.date).toLocaleDateString('en-US', { weekday: 'short' }) === dayName)
                      .map(call => (
                        <div key={call.id} className="bg-[var(--surface3)] p-3 rounded text-sm">
                          <div className="font-medium">{call.time}</div>
                          <div className="text-[var(--text3)] text-xs mt-1">{call.title}</div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DAY + AGENDA */}
        {(view === 'day' || view === 'agenda') && (
          <div className="card p-6 space-y-6">
            <h3 className="font-bold text-xl mb-4">Upcoming Service Calls</h3>
            {myServiceCalls.map(call => (
              <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl">
                <div className="font-medium text-lg">{call.time} — {call.title}</div>
                <div className="text-sm text-[var(--text3)]">{call.date}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}