'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');
  const [currentMonth, setCurrentMonth] = useState(6); // June 2026
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [currentDayOffset, setCurrentDayOffset] = useState(0);

  // TODO: Replace with real Supabase fetch
  const myServiceCalls = [
    { id: 1, date: '2026-06-15', title: 'VBeam PM - Downtown MedSpa', time: '09:00', duration: 120, location: 'Austin, TX' },
    { id: 2, date: '2026-06-16', title: 'GentleYAG Alignment - City Clinic', time: '14:00', duration: 90, location: 'Phoenix, AZ' },
    { id: 3, date: '2026-06-18', title: 'CO2 Service - Metro Hospital', time: '10:30', duration: 60, location: 'Los Angeles, CA' },
    { id: 4, date: '2026-06-19', title: 'Handpiece Calibration', time: '11:00', duration: 45, location: 'Austin, TX' },
  ];

  const monthName = new Date(2026, currentMonth - 1, 1).toLocaleString('default', { month: 'long' });

  const nextMonth = () => setCurrentMonth(prev => prev === 12 ? 1 : prev + 1);
  const prevMonth = () => setCurrentMonth(prev => prev === 1 ? 12 : prev - 1);

  const nextWeek = () => setCurrentWeekOffset(prev => prev + 1);
  const prevWeek = () => setCurrentWeekOffset(prev => prev - 1);

  const nextDay = () => setCurrentDayOffset(prev => prev + 1);
  const prevDay = () => setCurrentDayOffset(prev => prev - 1);

  // Generate proper calendar days for current month
  const firstDay = new Date(2026, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(2026, currentMonth, 0).getDate();
  const calendarDays = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  // Simple time slots for Week View (6am - 9pm)
  const timeSlots = Array.from({ length: 16 }, (_, i) => 6 + i); // 6 to 21 (9pm)

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
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

        {/* WEEK VIEW - Horizontal with hourly grid */}
        {view === 'week' && (
          <div className="card p-6 overflow-x-auto">
            <div className="flex justify-between items-center mb-4">
              <button onClick={prevWeek} className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-xl font-bold">Week of June 2026</div>
              <button onClick={nextWeek} className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-8 gap-px bg-[var(--border)] min-w-[1100px]">
              {/* Time column */}
              <div className="bg-[var(--surface)]">
                <div className="h-12 border-b border-[var(--border)]"></div>
                {timeSlots.map(hour => (
                  <div key={hour} className="h-12 border-b border-[var(--border)] px-2 text-xs text-[var(--text3)] flex items-center">
                    {hour}:00
                  </div>
                ))}
              </div>

              {/* Days */}
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((dayName, dayIndex) => (
                <div key={dayIndex} className="bg-[var(--surface)] relative border-l border-[var(--border)]">
                  <div className="h-12 flex items-center justify-center font-medium border-b border-[var(--border)]">{dayName}</div>
                  
                  {/* Hourly slots */}
                  {timeSlots.map((hour, slotIndex) => (
                    <div key={slotIndex} className="h-12 border-b border-[var(--border)] relative"></div>
                  ))}

                  {/* Service calls as gold blocks */}
                  {myServiceCalls
                    .filter(call => {
                      const callDate = new Date(call.date);
                      return callDate.getDay() === dayIndex;
                    })
                    .map(call => {
                      const startHour = parseInt(call.time.split(':')[0]);
                      const top = (startHour - 6) * 48; // 48px per hour
                      const height = (call.duration / 60) * 48;

                      return (
                        <div
                          key={call.id}
                          className="absolute left-1 right-1 bg-[var(--gold)] text-black text-xs p-1 rounded overflow-hidden"
                          style={{ top: `${top}px`, height: `${height}px` }}
                        >
                          {call.time} {call.title}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DAY + AGENDA VIEWS */}
        {(view === 'day' || view === 'agenda') && (
          <div className="card p-6 space-y-6">
            <div className="flex justify-between items-center">
              <button onClick={prevDay} className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <h3 className="font-bold text-xl">Upcoming Service Calls</h3>
              <button onClick={nextDay} className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>
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