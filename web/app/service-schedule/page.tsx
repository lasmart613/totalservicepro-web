'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');
  const [currentMonth, setCurrentMonth] = useState(6);
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);
  const [serviceCalls, setServiceCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseClient();

  // Fetch real scheduled calls for the logged-in FSE
  useEffect(() => {
    const fetchServiceCalls = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('service_tickets')
          .select(`
            id,
            service_date,
            scheduled_time,
            end_time,
            service_type,
            customer_name,
            status,
            priority
          `)
          .eq('assigned_to', user.id)
          .in('status', ['Scheduled', 'En Route', 'On Site'])
          .order('service_date', { ascending: true });

        if (error) throw error;

        // Transform data for the calendar
        const formatted = (data || []).map((ticket: any) => {
          const start = ticket.scheduled_time;
          const end = ticket.end_time;

          let duration = 60;
          if (start && end) {
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            duration = (eh * 60 + em) - (sh * 60 + sm);
          }

          return {
            id: ticket.id,
            date: ticket.service_date,
            time: start || '09:00',
            duration: duration > 0 ? duration : 60,
            title: `${ticket.service_type || 'Service'} - ${ticket.customer_name}`,
          };
        });

        setServiceCalls(formatted);
      } catch (err) {
        console.error('Error fetching service calls:', err);
        setServiceCalls([]);
      } finally {
        setLoading(false);
      }
    };

    fetchServiceCalls();
  }, [supabase]);

  const currentDate = new Date();
  currentDate.setDate(currentDate.getDate() + dayOffset);

  const monthName = new Date(2026, currentMonth - 1, 1).toLocaleString('default', { month: 'long' });

  const nextMonth = () => setCurrentMonth(prev => (prev === 12 ? 1 : prev + 1));
  const prevMonth = () => setCurrentMonth(prev => (prev === 1 ? 12 : prev - 1));

  const nextWeek = () => setWeekOffset(prev => prev + 1);
  const prevWeek = () => setWeekOffset(prev => prev - 1);

  const nextDay = () => setDayOffset(prev => prev + 1);
  const prevDay = () => setDayOffset(prev => prev - 1);

  // Calendar generation
  const firstDay = new Date(2026, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(2026, currentMonth, 0).getDate();
  const calendarDays = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const timeSlots = Array.from({ length: 16 }, (_, i) => 6 + i);

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
                      {serviceCalls.some(c => parseInt(c.date.split('-')[2]) === day) && (
                        <div className="text-[10px] mt-1 text-[var(--gold)]">● Service</div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WEEK VIEW */}
        {view === 'week' && (
          <div className="card p-6 overflow-x-auto">
            <div className="flex justify-between items-center mb-4">
              <button onClick={prevWeek} className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-xl font-bold">Week View</div>
              <button onClick={nextWeek} className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-8 gap-px bg-[var(--border)] min-w-[1100px]">
              <div className="bg-[var(--surface)]">
                <div className="h-12"></div>
                {timeSlots.map(h => (
                  <div key={h} className="h-12 border-b border-[var(--border)] px-2 text-xs text-[var(--text3)] flex items-center">
                    {h}:00
                  </div>
                ))}
              </div>

              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((dayName, idx) => {
                const dayDate = new Date(2026, 5, 14 + (weekOffset * 7) + idx);
                const dayStr = dayDate.toISOString().split('T')[0];

                return (
                  <div key={idx} className="bg-[var(--surface)] relative border-l border-[var(--border)]">
                    <div className="h-12 flex flex-col items-center justify-center border-b border-[var(--border)]">
                      <div className="font-medium">{dayName}</div>
                      <div className="text-xs text-[var(--text3)]">{dayDate.getDate()}</div>
                    </div>

                    {timeSlots.map((hour, slotIdx) => (
                      <div key={slotIdx} className="h-12 border-b border-[var(--border)] relative"></div>
                    ))}

                    {serviceCalls
                      .filter(c => c.date === dayStr)
                      .map(call => {
                        const startHour = parseInt(call.time.split(':')[0]);
                        const top = (startHour - 6) * 48;
                        const height = ((call.duration || 60) / 60) * 48;

                        return (
                          <div
                            key={call.id}
                            className="absolute left-1 right-1 bg-[var(--gold)] text-black text-xs p-1 rounded overflow-hidden z-10"
                            style={{ top: `${top}px`, height: `${height}px` }}
                          >
                            {call.time} {call.title}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DAY VIEW - Narrow time column + hourly grid */}
        {view === 'day' && (
          <div className="card p-6 overflow-x-auto">
            <div className="flex justify-between items-center mb-6">
              <button onClick={prevDay} className="btn btn-secondary p-3"><ChevronLeft size={20} /></button>
              <div className="text-2xl font-bold">
                {currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <button onClick={nextDay} className="btn btn-secondary p-3"><ChevronRight size={20} /></button>
            </div>

            <div className="grid grid-cols-[70px_1fr] gap-px bg-[var(--border)] min-w-[600px]">
              {/* Narrow time column */}
              <div className="bg-[var(--surface)]">
                {timeSlots.map(h => (
                  <div key={h} className="h-12 border-b border-[var(--border)] px-2 text-xs text-[var(--text3)] flex items-center">
                    {h}:00
                  </div>
                ))}
              </div>

              {/* Calls column */}
              <div className="bg-[var(--surface)] relative">
                {timeSlots.map(h => (
                  <div key={h} className="h-12 border-b border-[var(--border)]"></div>
                ))}

                {serviceCalls
                  .filter(c => c.date === currentDate.toISOString().split('T')[0])
                  .map(call => {
                    const startHour = parseInt(call.time.split(':')[0]);
                    const top = (startHour - 6) * 48;
                    const height = ((call.duration || 60) / 60) * 48;

                    return (
                      <div
                        key={call.id}
                        className="absolute left-2 right-2 bg-[var(--gold)] text-black text-sm p-2 rounded overflow-hidden"
                        style={{ top: `${top}px`, height: `${height}px` }}
                      >
                        {call.time} — {call.title}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* AGENDA VIEW */}
        {view === 'agenda' && (
          <div className="card p-6 space-y-6">
            <h3 className="font-bold text-xl mb-4">Upcoming Service Calls</h3>
            {serviceCalls.length === 0 ? (
              <p className="text-[var(--text3)]">No upcoming service calls found.</p>
            ) : (
              serviceCalls.map(call => (
                <div key={call.id} className="bg-[var(--surface3)] p-5 rounded-xl">
                  <div className="font-medium text-lg">{call.time} — {call.title}</div>
                  <div className="text-sm text-[var(--text3)]">{call.date}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}