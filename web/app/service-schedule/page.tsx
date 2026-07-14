'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { isAdmin, isPro } from '@/lib/roles';

/** YYYY-MM-DD in local calendar (avoids UTC shift from toISOString) */
function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(ymd: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!ymd || typeof ymd !== 'string') return null;
  // Accept YYYY-MM-DD or ISO timestamps
  const part = ymd.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function ymdEqualsDay(ymd: string | null | undefined, year: number, month1: number, day: number): boolean {
  const p = parseYmd(ymd);
  if (!p) return false;
  return p.y === year && p.m === month1 && p.d === day;
}

function isOpenTicketStatus(status: string | null | undefined): boolean {
  const s = (status || '').toLowerCase();
  return !['completed', 'cancelled', 'canceled', 'complete'].includes(s);
}

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');
  // Full date cursor (fixes hardcoded June + wrong year)
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [serviceCalls, setServiceCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('');

  const supabase = getSupabaseClient();
  const router = useRouter();

  const year = cursor.getFullYear();
  const month0 = cursor.getMonth(); // 0-11
  const month1 = month0 + 1;

  useEffect(() => {
    const fetchServiceCalls = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setServiceCalls([]);
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role, organization_id')
          .eq('id', user.id)
          .maybeSingle();

        setUserRole(profile?.role || '');
        const orgId = profile?.organization_id;
        const role = profile?.role || '';

        // Prefer org-wide tickets for dispatch/admin; assigned-only for pure FSE
        let query = supabase
          .from('service_tickets')
          .select(`
            id,
            service_date,
            scheduled_time,
            end_time,
            service_type,
            customer_name,
            equipment_model,
            equipment_make,
            status,
            organization_id,
            assigned_to,
            priority
          `)
          .order('service_date', { ascending: true });

        if (orgId != null) {
          query = query.eq('organization_id', orgId);
          // Field techs: still show org calendar but we could filter — match Android org scope for managers
          if (!isAdmin(role) && !isPro(role) && role === 'fse') {
            // FSEs see all org tickets (common for schedule awareness); tighten if needed:
            // query = query.eq('assigned_to', user.id);
          }
        } else {
          query = query.eq('assigned_to', user.id);
        }

        const { data, error } = await query.limit(500);
        if (error) throw error;

        const formatted = (data || []).map((ticket: any) => {
          const start = ticket.scheduled_time;
          const end = ticket.end_time;
          let duration = 60;
          if (start && end) {
            const [sh, sm] = String(start).split(':').map(Number);
            const [eh, em] = String(end).split(':').map(Number);
            duration = eh * 60 + em - (sh * 60 + sm);
          }
          // Normalize date to YYYY-MM-DD string
          let dateStr = ticket.service_date;
          if (dateStr && typeof dateStr === 'string' && dateStr.length > 10) {
            dateStr = dateStr.slice(0, 10);
          }
          return {
            id: ticket.id,
            date: dateStr,
            time: (start && String(start).slice(0, 5)) || '09:00',
            duration: duration > 0 ? duration : 60,
            title: `${ticket.service_type || 'Service'} - ${ticket.customer_name || 'Customer'}`,
            equipment_model: [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') || '',
            status: ticket.status,
          };
        });

        setServiceCalls(formatted);
      } catch (err: any) {
        console.error('Error fetching service calls:', err);
        setLoadError(err?.message || 'Failed to load tickets');
        setServiceCalls([]);
      } finally {
        setLoading(false);
      }
    };

    fetchServiceCalls();
  }, [supabase]);

  const monthName = cursor.toLocaleString('default', { month: 'long' });

  const nextMonth = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  const prevMonth = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));

  const nextWeek = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7));
  const prevWeek = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7));

  const nextDay = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1));
  const prevDay = () => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1));

  const goToday = () => {
    const n = new Date();
    if (view === 'month') setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    else setCursor(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
  };

  // Calendar grid for current month
  const firstDay = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const calendarDays = Array(firstDay).fill(null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  // Week starts Sunday containing cursor
  const weekStart = useMemo(() => {
    const d = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [cursor]);

  const timeSlots = Array.from({ length: 16 }, (_, i) => 6 + i);

  const handleEventClick = (callId: string | number) => {
    router.push(`/service-tickets/${callId}`);
  };

  const handleDragStart = (e: React.DragEvent, call: any) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(call));
  };

  const handleDrop = async (e: React.DragEvent, newDate: string, newTime: string) => {
    e.preventDefault();
    const draggedCall = JSON.parse(e.dataTransfer.getData('text/plain'));

    setServiceCalls((prev) =>
      prev.map((call) =>
        call.id === draggedCall.id ? { ...call, date: newDate, time: newTime } : call
      )
    );

    try {
      await supabase
        .from('service_tickets')
        .update({
          service_date: newDate,
          scheduled_time: newTime,
        })
        .eq('id', draggedCall.id);
    } catch (err) {
      console.error('Failed to update schedule:', err);
      alert('Failed to save changes. Please refresh.');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const dayYmd = toLocalYmd(cursor);
  const todayYmd = toLocalYmd(new Date());

  const agendaCalls = useMemo(() => {
    return [...serviceCalls]
      .filter((c) => c.date && c.date >= todayYmd)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
  }, [serviceCalls, todayYmd]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CalendarIcon size={32} className="text-[var(--gold)]" />
            <h1 className="text-4xl font-extrabold">Service Schedule</h1>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={goToday} className="btn btn-secondary text-sm">
              Today
            </button>
            <Link href="/" className="text-[var(--gold)] hover:underline">
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {loadError && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-300">
            {loadError}
          </div>
        )}
        {loading && (
          <div className="mb-4 text-sm text-[var(--text3)]">Loading tickets…</div>
        )}
        {!loading && (
          <div className="mb-4 text-xs text-[var(--text3)]">
            {serviceCalls.length} ticket{serviceCalls.length === 1 ? '' : 's'} loaded
            {userRole ? ` · role ${userRole}` : ''}
          </div>
        )}

        <div className="flex gap-2 mb-8 flex-wrap">
          <button onClick={() => setView('month')} className={`btn ${view === 'month' ? 'btn-primary' : ''}`}>
            Month
          </button>
          <button onClick={() => setView('week')} className={`btn ${view === 'week' ? 'btn-primary' : ''}`}>
            Week
          </button>
          <button onClick={() => setView('day')} className={`btn ${view === 'day' ? 'btn-primary' : ''}`}>
            Day
          </button>
          <button onClick={() => setView('agenda')} className={`btn ${view === 'agenda' ? 'btn-primary' : ''}`}>
            Agenda
          </button>
        </div>

        {/* MONTH VIEW */}
        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button type="button" onClick={prevMonth} className="btn btn-secondary p-3" aria-label="Previous month">
                <ChevronLeft size={20} />
              </button>
              <div className="text-3xl font-bold">
                {monthName} {year}
              </div>
              <button type="button" onClick={nextMonth} className="btn btn-secondary p-3" aria-label="Next month">
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="bg-[var(--surface)] py-3 text-center font-medium text-sm">
                  {d}
                </div>
              ))}
              {calendarDays.map((day, i) => {
                // CRITICAL: match full YYYY-MM-DD for this cell, not day-of-month only
                const dayCalls = day
                  ? serviceCalls.filter((c) => ymdEqualsDay(c.date, year, month1, day))
                  : [];
                const cellYmd = day
                  ? `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  : '';
                const isToday = cellYmd === todayYmd;
                return (
                  <div
                    key={i}
                    className={`bg-[var(--surface)] min-h-[130px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] relative overflow-hidden ${
                      isToday ? 'ring-1 ring-[var(--gold)]' : ''
                    }`}
                  >
                    {day && (
                      <>
                        <div className={`text-sm font-medium mb-1 ${isToday ? 'text-[var(--gold)]' : ''}`}>
                          {day}
                        </div>
                        {dayCalls.length > 0 && (
                          <div className="text-[10px] leading-snug text-[var(--gold)] space-y-0.5">
                            {dayCalls.slice(0, 3).map((call, idx) => (
                              <div
                                key={idx}
                                className="break-words cursor-pointer hover:underline"
                                onClick={() => handleEventClick(call.id)}
                                title={`${call.time} • ${call.title}${call.equipment_model ? ` • ${call.equipment_model}` : ''}`}
                              >
                                {call.time} {call.title}
                                {call.equipment_model && ` • ${call.equipment_model}`}
                              </div>
                            ))}
                            {dayCalls.length > 3 && (
                              <div className="text-[var(--text3)] text-[9px]">+{dayCalls.length - 3} more</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* WEEK VIEW */}
        {view === 'week' && (
          <div className="card p-6 overflow-x-auto">
            <div className="flex justify-between items-center mb-4">
              <button type="button" onClick={prevWeek} className="btn btn-secondary p-3">
                <ChevronLeft size={20} />
              </button>
              <div className="text-xl font-bold">
                Week of {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <button type="button" onClick={nextWeek} className="btn btn-secondary p-3">
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="grid grid-cols-8 gap-px bg-[var(--border)] min-w-[1100px]">
              <div className="bg-[var(--surface)]" />
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, idx) => {
                const dayDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + idx);
                const dayStr = toLocalYmd(dayDate);
                return (
                  <div key={dayName} className="bg-[var(--surface)] p-2 text-center">
                    <div className="font-medium">{dayName}</div>
                    <div className="text-xs text-[var(--text3)]">{dayDate.getDate()}</div>
                    <div
                      className="mt-2 min-h-[200px] space-y-1"
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, dayStr, '09:00')}
                    >
                      {serviceCalls
                        .filter((c) => c.date === dayStr)
                        .map((call) => (
                          <div
                            key={call.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, call)}
                            onClick={() => handleEventClick(call.id)}
                            className="text-[10px] p-1 rounded bg-[var(--gold)]/20 text-[var(--gold)] cursor-pointer"
                          >
                            {call.time} {call.title}
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DAY VIEW */}
        {view === 'day' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-4">
              <button type="button" onClick={prevDay} className="btn btn-secondary p-3">
                <ChevronLeft size={20} />
              </button>
              <div className="text-xl font-bold">
                {cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              <button type="button" onClick={nextDay} className="btn btn-secondary p-3">
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="space-y-2">
              {serviceCalls.filter((c) => c.date === dayYmd).length === 0 && (
                <div className="text-[var(--text3)] text-sm py-8 text-center">No tickets scheduled this day.</div>
              )}
              {serviceCalls
                .filter((c) => c.date === dayYmd)
                .map((call) => (
                  <div
                    key={call.id}
                    className="p-3 rounded-lg border border-[var(--border)] hover:border-[var(--gold)] cursor-pointer"
                    onClick={() => handleEventClick(call.id)}
                  >
                    <div className="font-semibold text-[var(--gold)]">
                      {call.time} · {call.title}
                    </div>
                    {call.equipment_model && (
                      <div className="text-xs text-[var(--text3)] mt-1">{call.equipment_model}</div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* AGENDA */}
        {view === 'agenda' && (
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4">Upcoming</h2>
            {agendaCalls.length === 0 && (
              <div className="text-[var(--text3)] text-sm py-8 text-center">No upcoming tickets.</div>
            )}
            <div className="space-y-2">
              {agendaCalls.map((call) => (
                <div
                  key={call.id}
                  className="p-3 rounded-lg border border-[var(--border)] hover:border-[var(--gold)] cursor-pointer flex justify-between gap-3"
                  onClick={() => handleEventClick(call.id)}
                >
                  <div>
                    <div className="font-semibold">{call.title}</div>
                    <div className="text-xs text-[var(--text3)]">
                      {call.date} · {call.time}
                      {call.equipment_model ? ` · ${call.equipment_model}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--gold)]">{call.status}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
