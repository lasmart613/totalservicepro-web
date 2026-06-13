'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');
  const [currentMonth, setCurrentMonth] = useState(6); // June

  const myServiceCalls = [
    { id: 1, date: '2026-06-15', dayNum: 15, title: 'VBeam PM - Downtown MedSpa', time: '09:00 AM', location: 'Austin, TX' },
    { id: 2, date: '2026-06-16', dayNum: 16, title: 'GentleYAG Alignment - City Clinic', time: '02:00 PM', location: 'Phoenix, AZ' },
    { id: 3, date: '2026-06-18', dayNum: 18, title: 'CO2 Service - Metro Hospital', time: '10:30 AM', location: 'Los Angeles, CA' },
    { id: 4, date: '2026-06-19', dayNum: 19, title: 'Handpiece Calibration - Elite Dermatology', time: '11:00 AM', location: 'Austin, TX' },
  ];

  const monthName = new Date(2026, currentMonth - 1, 1).toLocaleString('default', { month: 'long' });

  const nextMonth = () => setCurrentMonth(prev => (prev === 12 ? 1 : prev + 1));
  const prevMonth = () => setCurrentMonth(prev => (prev === 1 ? 12 : prev - 1));

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

        {/* My Service Calls Summary */}
        <div className="card p-6 mb-8">
          <h3 className="font-bold text-lg mb-4">My Upcoming Service Calls</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myServiceCalls.map(call => (
              <div key={call.id} className="bg-[var(--surface3)] p-4 rounded-xl">
                <div className="font-medium">{call.title}</div>
                <div className="text-sm text-[var(--gold)]">{call.date} • {call.time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Month View */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button onClick={prevMonth} className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-3xl font-bold">{monthName} 2026</div>
              <button onClick={nextMonth} className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)] text-center text-sm">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="bg-[var(--surface)] py-3 font-medium">{day}</div>
              ))}
              {Array.from({ length: 35 }).map((_, i) => {
                const dayNum = i + 1;
                const hasCall = myServiceCalls.some(c => c.dayNum === dayNum);
                return (
                  <div key={i} className="bg-[var(--surface)] min-h-[100px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] transition-colors relative">
                    <div className="text-xs text-[var(--text3)] font-medium">{dayNum}</div>
                    {hasCall && <div className="text-[10px] mt-1 text-[var(--gold)]">• Call</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Week View - Vertical */}
        {view === 'week' && (
          <div className="card p-6 space-y-8">
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dayName) => {
              const calls = myServiceCalls.filter(c => c.day === dayName);
              return (
                <div key={dayName} className="border-l-4 border-[var(--gold)] pl-6">
                  <div className="font-bold text-xl mb-4">{dayName}</div>
                  {calls.length > 0 ? calls.map(call => (
                    <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl mb-4">
                      <div className="font-medium">{call.time} — {call.title}</div>
                      <div className="text-xs text-[var(--text3)]">{call.location}</div>
                    </div>
                  )) : <div className="text-[var(--text3)] pl-4">No calls</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Day & Agenda Views remain the same */}
        {view === 'day' && (
          <div className="card p-8">
            <h3 className="text-2xl font-bold mb-6">Today • June 13, 2026</h3>
            <div className="space-y-6">
              {myServiceCalls.map(call => (
                <div key={call.id} className="bg-[var(--surface3)] p-6 rounded-2xl">
                  <div className="text-xl font-medium">{call.time}</div>
                  <div className="text-lg mt-1">{call.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === 'agenda' && (
          <div className="card p-6 space-y-8">
            {myServiceCalls.map((item, index) => (
              <div key={index} className={`border-l-4 border-[var(--gold)] pl-6 pb-8 ${index < myServiceCalls.length - 1 ? 'border-b border-[var(--gold)] border-dashed' : ''}`}>
                <div className="font-bold text-lg mb-2">{item.day}, {item.date}</div>
                <div className="bg-[var(--surface3)] p-5 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Clock size={20} className="text-[var(--gold)]" />
                    <div>
                      <div className="font-medium text-lg">{item.time}</div>
                      <div>{item.title}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}