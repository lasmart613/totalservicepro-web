'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { isAdmin, isPro } from '@/lib/roles';
import { roleLabel } from '@/lib/labels';
import { generateDocNumber } from '@/lib/billing/doc-numbers';
import { ticketDateYmd, toLocalYmd } from '@/lib/tickets';
import { AddCustomerModal } from '@/components/AddCustomerModal';
import {
  createLinkedCustomer,
  emptyCustomerForm,
  filterLinkedCustomers,
  loadLinkedCustomers,
  matchLinkedCustomer,
  type LinkedCustomerOpt,
} from '@/lib/customer-form';

function parseYmd(ymd: string | null | undefined): { y: number; m: number; d: number } | null {
  const part = ticketDateYmd(ymd);
  if (!part) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function ymdEqualsDay(ymd: string | null | undefined, year: number, month1: number, day: number): boolean {
  const p = parseYmd(ymd);
  if (!p) return false;
  return p.y === year && p.m === month1 && p.d === day;
}

function coerceOrgId(val: unknown): number | string | null {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s) return s;
  return null;
}

type TicketForm = {
  customer_name: string;
  service_date: string;
  scheduled_time: string;
  end_time: string;
  service_type: string;
  priority: string;
  status: string;
  equipment_make: string;
  equipment_model: string;
  serial_number: string;
  notes: string;
  customer_address: string;
  customer_city: string;
  customer_state: string;
  customer_phone: string;
  customer_email: string;
};

const EMPTY_FORM = (presetDate?: string): TicketForm => ({
  customer_name: '',
  service_date: presetDate || toLocalYmd(new Date()),
  scheduled_time: '09:00',
  end_time: '10:00',
  service_type: 'Repair',
  priority: 'Medium',
  status: 'Scheduled',
  equipment_make: '',
  equipment_model: '',
  serial_number: '',
  notes: '',
  customer_address: '',
  customer_city: '',
  customer_state: '',
  customer_phone: '',
  customer_email: '',
});

export default function ServiceSchedule() {
  const [view, setView] = useState<'month' | 'week' | 'day' | 'agenda'>('month');
  // Keep full date so Day view and month→day click land on the correct day
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0);
  });
  const [serviceCalls, setServiceCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [selfName, setSelfName] = useState('');
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<TicketForm>(() => EMPTY_FORM());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<LinkedCustomerOpt[]>([]);
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [customerOrgId, setCustomerOrgId] = useState<string | number | null>(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  const supabase = getSupabaseClient();
  const router = useRouter();

  const year = cursor.getFullYear();
  const month0 = cursor.getMonth();
  const month1 = month0 + 1;
  const canCreate = isAdmin(userRole) || isPro(userRole);

  const formatTicket = useCallback((ticket: any) => {
    const start = ticket.scheduled_time;
    const end = ticket.end_time;
    let duration = 60;
    if (start && end) {
      const [sh, sm] = String(start).split(':').map(Number);
      const [eh, em] = String(end).split(':').map(Number);
      duration = eh * 60 + em - (sh * 60 + sm);
    }
    const dateStr = ticketDateYmd(ticket.service_date);
    return {
      id: ticket.id,
      ticket_number: ticket.ticket_number,
      date: dateStr,
      time: (start && String(start).slice(0, 5)) || '09:00',
      duration: duration > 0 ? duration : 60,
      title: `${ticket.service_type || 'Service'} - ${ticket.customer_name || 'Customer'}`,
      equipment_model:
        [ticket.equipment_make, ticket.equipment_model].filter(Boolean).join(' ') || '',
      status: ticket.status,
      assigned_to: ticket.assigned_to,
      priority: ticket.priority,
    };
  }, []);

  const fetchServiceCalls = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Prefer session (faster / settles after auth callback); fall back to getUser
      let user =
        (await supabase.auth.getSession()).data.session?.user ?? null;
      if (!user) {
        const gu = await supabase.auth.getUser();
        user = gu.data.user;
      }
      if (!user) {
        setServiceCalls([]);
        setUserId(null);
        setLoadError(null);
        return;
      }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, organization_id, first_name, last_name, email')
        .eq('id', user.id)
        .maybeSingle();

      setUserRole(profile?.role || '');
      const mine =
        [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
        profile?.email ||
        '';
      setSelfName(mine);
      const oId = coerceOrgId(profile?.organization_id ?? null);
      setOrgId(oId);

      const selectCols = `
            id,
            ticket_number,
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
          `;

      // Org tickets OR assigned to me (mirrors RLS; avoids empty calendar when org filter is too strict)
      let data: any[] | null = null;
      let error: any = null;

      if (oId != null) {
        const q1 = await supabase
          .from('service_tickets')
          .select(selectCols)
          .or(`organization_id.eq.${oId},assigned_to.eq.${user.id}`)
          .order('service_date', { ascending: true })
          .limit(500);
        data = q1.data;
        error = q1.error;

        // Fallback: plain org filter if .or() is rejected
        if (error) {
          console.warn('schedule or-filter failed, retrying org-only', error);
          const q2 = await supabase
            .from('service_tickets')
            .select(selectCols)
            .eq('organization_id', oId)
            .order('service_date', { ascending: true })
            .limit(500);
          data = q2.data;
          error = q2.error;
        }
      } else {
        const q3 = await supabase
          .from('service_tickets')
          .select(selectCols)
          .eq('assigned_to', user.id)
          .order('service_date', { ascending: true })
          .limit(500);
        data = q3.data;
        error = q3.error;
      }

      // Last resort: RLS-only unfiltered (still scoped by policies)
      if (error) {
        console.warn('schedule filtered query failed, retrying RLS-only', error);
        const q4 = await supabase
          .from('service_tickets')
          .select(selectCols)
          .order('service_date', { ascending: true })
          .limit(500);
        if (q4.error) throw q4.error;
        data = q4.data;
        error = null;
      }

      if (error) throw error;

      const formatted = (data || []).map(formatTicket);
      setServiceCalls(formatted);
    } catch (err: any) {
      console.error('Error fetching service calls:', err);
      setLoadError(err?.message || 'Failed to load tickets');
      setServiceCalls([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, formatTicket]);

  const refreshCustomers = useCallback(
    async (oId: number | string | null) => {
      if (oId == null) {
        setCustomers([]);
        return;
      }
      try {
        setCustomers(await loadLinkedCustomers(supabase, oId));
      } catch (e) {
        console.warn('ticket customers', e);
        setCustomers([]);
      }
    },
    [supabase]
  );

  const refreshAssignees = useCallback(
    async (oId: number | string | null, meId: string | null) => {
      if (oId == null) {
        setAssignees([]);
        return;
      }
      const assignable = new Set([
        'fse',
        'engineer',
        'technician',
        'service_manager',
        'admin',
        'company_admin',
      ]);
      const toOpt = (m: any) => ({
        id: String(m.id),
        name:
          [m.first_name, m.last_name].filter(Boolean).join(' ') ||
          m.email ||
          'Team member',
        role: String(m.role || 'fse'),
      });
      let members: any[] = [];
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) {
          const res = await fetch('/api/team/list', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const json = await res.json().catch(() => ({}));
            if (Array.isArray(json.members)) members = json.members;
          }
        }
      } catch (e) {
        console.warn('ticket assignees api', e);
      }
      if (!members.length) {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('id, first_name, last_name, email, role')
          .eq('organization_id', oId);
        if (error) console.warn('ticket assignees', error.message);
        members = data || [];
      }
      const opts = members
        .filter((m) => m?.id && (String(m.id) === String(meId) || assignable.has(String(m.role || '').toLowerCase())))
        .map(toOpt);
      if (meId && !opts.some((o) => o.id === meId)) {
        opts.unshift({
          id: meId,
          name: selfName || 'Me',
          role: userRole || 'fse',
        });
      }
      opts.sort((a, b) => {
        if (meId && a.id === meId) return -1;
        if (meId && b.id === meId) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setAssignees(opts);
    },
    [supabase, selfName, userRole]
  );

  useEffect(() => {
    refreshCustomers(orgId);
  }, [orgId, refreshCustomers]);

  useEffect(() => {
    refreshAssignees(orgId, userId);
  }, [orgId, userId, refreshAssignees]);

  const filteredCustomers = useMemo(
    () => filterLinkedCustomers(customers, form.customer_name),
    [customers, form.customer_name]
  );

  function applyCustomer(c: LinkedCustomerOpt) {
    setCustomerOrgId(c.id);
    setForm((prev) => ({
      ...prev,
      customer_name: c.name,
      customer_address: c.address || '',
      customer_city: c.city || '',
      customer_state: c.state || '',
      customer_phone: c.phone || '',
      customer_email: c.email || '',
    }));
    setShowCustDrop(false);
  }

  useEffect(() => {
    fetchServiceCalls();
    // Reload when auth settles (e.g. after hard refresh / magic link)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        fetchServiceCalls();
      }
      if (event === 'SIGNED_OUT') {
        setServiceCalls([]);
        setUserId(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchServiceCalls, supabase]);

  const monthName = cursor.toLocaleString('default', { month: 'long' });

  const nextMonth = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, Math.min(prev.getDate(), 28), 12, 0, 0));
  const prevMonth = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, Math.min(prev.getDate(), 28), 12, 0, 0));
  const nextWeek = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7, 12, 0, 0));
  const prevWeek = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7, 12, 0, 0));
  const nextDay = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1, 12, 0, 0));
  const prevDay = () =>
    setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1, 12, 0, 0));

  const goToday = () => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0));
  };

  /** Open Day view for a calendar day (primary month interaction) */
  const openDayView = (y: number, m0: number, day: number) => {
    setCursor(new Date(y, m0, day, 12, 0, 0));
    setView('day');
  };

  const firstDay = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const calendarDays = Array(firstDay)
    .fill(null)
    .concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const weekStart = useMemo(() => {
    const d = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [cursor]);

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

  function openNewModal(presetDate?: string) {
    setForm(EMPTY_FORM(presetDate));
    setFormError(null);
    setCustomerOrgId(null);
    setShowCustDrop(false);
    setShowAddCustomer(false);
    setAssignedTo(userId || '');
    setShowNew(true);
    if (orgId != null && customers.length === 0) {
      refreshCustomers(orgId);
    }
  }

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const customer = form.customer_name.trim();
    if (!customer) {
      setFormError('Customer name is required.');
      return;
    }
    if (!orgId) {
      setFormError('Your profile has no organization. Finish company onboarding first.');
      return;
    }
    if (!canCreate) {
      setFormError('Your role cannot create tickets. Ask a company admin.');
      return;
    }

    setSaving(true);
    try {
      let ticketNumber: string;
      try {
        ticketNumber = await generateDocNumber(supabase as any, {
          orgId,
          kind: 'TKT',
          date: form.service_date ? new Date(form.service_date + 'T12:00:00') : new Date(),
        });
      } catch {
        ticketNumber = `TMP-TKT-${Date.now().toString().slice(-6)}`;
      }

      let status = form.status || 'Scheduled';
      if (form.service_date && status === 'Awaiting Scheduling') status = 'Scheduled';

      let linkedCustomerId = customerOrgId;
      if (!linkedCustomerId) {
        linkedCustomerId = matchLinkedCustomer(customers, customer)?.id || null;
      }
      if (!linkedCustomerId) {
        const created = await createLinkedCustomer(supabase, {
          serviceOrgId: orgId,
          form: {
            ...emptyCustomerForm(),
            name: customer,
            address: form.customer_address,
            city: form.customer_city,
            state: form.customer_state,
            phone: form.customer_phone,
            email: form.customer_email,
          },
          createdBy: userId,
        });
        linkedCustomerId = created.id;
        await refreshCustomers(orgId);
      }

      const payload: Record<string, any> = {
        ticket_number: ticketNumber,
        organization_id: orgId,
        customer_organization_id: linkedCustomerId,
        customer_name: customer,
        customer_address: form.customer_address.trim() || null,
        customer_city: form.customer_city.trim() || null,
        customer_state: form.customer_state.trim() || null,
        customer_phone: form.customer_phone.trim() || null,
        customer_email: form.customer_email.trim() || null,
        equipment_make: form.equipment_make.trim() || null,
        equipment_model: form.equipment_model.trim() || null,
        serial_number: form.serial_number.trim() || null,
        service_date: form.service_date || null,
        scheduled_time: form.scheduled_time || null,
        end_time: form.end_time || null,
        service_type: form.service_type || 'Repair',
        priority: form.priority || 'Medium',
        status,
        notes: form.notes.trim() || null,
        description: form.notes.trim() || null,
        assigned_to: assignedTo || null,
      };

      let { data, error } = await supabase
        .from('service_tickets')
        .insert([payload])
        .select('id, ticket_number')
        .single();
      if (error && /customer_organization/i.test(error.message || '') && 'customer_organization_id' in payload) {
        delete payload.customer_organization_id;
        ({ data, error } = await supabase
          .from('service_tickets')
          .insert([payload])
          .select('id, ticket_number')
          .single());
      }

      if (error) throw error;

      setShowNew(false);
      await fetchServiceCalls();
      if (data?.id && assignedTo && assignedTo !== userId) {
        const who =
          assignees.find((a) => a.id === assignedTo)?.name || 'the assigned FSE';
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          if (token) {
            const res = await fetch('/api/tickets/notify-assignee', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ticketId: data.id, assignedTo }),
            });
            const json = await res.json().catch(() => ({}));
            if (json.emailed) {
              toast.success(`Ticket created. ${who} was emailed.`);
            } else {
              toast.success(
                `Ticket created. Could not email ${who}${json.error ? `: ${json.error}` : '.'}`
              );
            }
          }
        } catch (notifyErr) {
          console.warn('notify assignee', notifyErr);
          toast.success('Ticket created.');
        }
      } else {
        toast.success('Ticket created.');
      }
    } catch (err: any) {
      console.error('create ticket', err);
      setFormError(err?.message || 'Failed to create ticket');
    } finally {
      setSaving(false);
    }
  }

  const dayYmd = toLocalYmd(cursor);
  const todayYmd = toLocalYmd(new Date());

  const agendaCalls = useMemo(() => {
    return [...serviceCalls]
      .filter((c) => c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.date >= todayYmd)
      .sort(
        (a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          String(a.time).localeCompare(String(b.time))
      );
  }, [serviceCalls, todayYmd]);

  const unscheduledCalls = useMemo(
    () => serviceCalls.filter((c) => !c.date || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)),
    [serviceCalls]
  );
  const datedThisMonth = useMemo(
    () =>
      serviceCalls.filter((c) => {
        const p = parseYmd(c.date);
        return p && p.y === year && p.m === month1;
      }).length,
    [serviceCalls, year, month1]
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CalendarIcon size={32} className="text-[var(--gold)]" />
            <h1 className="text-4xl font-extrabold">Service Schedule</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {canCreate && (
              <button
                type="button"
                onClick={() => openNewModal()}
                className="btn btn-primary text-sm inline-flex items-center gap-1.5"
              >
                <Plus size={16} /> New Service Call
              </button>
            )}
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
        {loading && <div className="mb-4 text-sm text-[var(--text3)]">Loading tickets…</div>}
        {!loading && (
          <div className="mb-4 text-xs text-[var(--text3)] flex flex-wrap items-center gap-2">
            <span>
              {serviceCalls.length} ticket{serviceCalls.length === 1 ? '' : 's'} loaded
              {' · '}
              {datedThisMonth} dated this month
              {' · '}
              {unscheduledCalls.length} unscheduled
              {userRole ? ` · role ${userRole}` : ''}
              {!canCreate && userId ? ' · read-only' : ''}
            </span>
            <button
              type="button"
              className="text-[var(--gold)] underline-offset-2 hover:underline"
              onClick={() => fetchServiceCalls()}
            >
              Refresh
            </button>
          </div>
        )}

        <div className="flex gap-2 mb-8 flex-wrap">
          <button
            onClick={() => setView('month')}
            className={`btn ${view === 'month' ? 'btn-primary' : ''}`}
          >
            Month
          </button>
          <button
            onClick={() => setView('week')}
            className={`btn ${view === 'week' ? 'btn-primary' : ''}`}
          >
            Week
          </button>
          <button
            onClick={() => setView('day')}
            className={`btn ${view === 'day' ? 'btn-primary' : ''}`}
          >
            Day
          </button>
          <button
            onClick={() => setView('agenda')}
            className={`btn ${view === 'agenda' ? 'btn-primary' : ''}`}
          >
            Agenda
          </button>
        </div>

        {view === 'month' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-6">
              <button
                type="button"
                onClick={prevMonth}
                className="btn btn-secondary p-3"
                aria-label="Previous month"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-3xl font-bold">
                {monthName} {year}
              </div>
              <button
                type="button"
                onClick={nextMonth}
                className="btn btn-secondary p-3"
                aria-label="Next month"
              >
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
                    className={`bg-[var(--surface)] min-h-[130px] p-2 border border-[var(--border)] hover:bg-[var(--surface3)] relative overflow-hidden cursor-pointer ${
                      isToday ? 'ring-1 ring-[var(--gold)]' : ''
                    } ${dayCalls.length ? 'bg-[rgba(251,191,36,0.04)]' : ''}`}
                    title={day ? (dayCalls.length ? `${dayCalls.length} call(s) — open Day view` : 'Open Day view') : undefined}
                    onClick={() => {
                      // Month → Day: click a day opens Day View for that date
                      if (!day) return;
                      openDayView(year, month0, day);
                    }}
                    onDoubleClick={(ev) => {
                      if (day && canCreate) {
                        ev.stopPropagation();
                        openNewModal(cellYmd);
                      }
                    }}
                  >
                    {day && (
                      <>
                        <div className="flex justify-between items-start mb-1">
                          <div
                            className={`text-sm font-medium ${isToday ? 'text-[var(--gold)]' : ''}`}
                          >
                            {day}
                          </div>
                          {canCreate && (
                            <button
                              type="button"
                              title="Add service call"
                              className="text-[var(--gold)] text-xs opacity-60 hover:opacity-100"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                openNewModal(cellYmd);
                              }}
                            >
                              +
                            </button>
                          )}
                        </div>
                        {dayCalls.length > 0 && (
                          <div className="text-[10px] leading-snug text-[var(--gold)] space-y-0.5">
                            {dayCalls.slice(0, 3).map((call) => (
                              <Link
                                key={call.id}
                                href={`/service-tickets/${call.id}`}
                                className="block break-words hover:underline"
                                onClick={(ev) => ev.stopPropagation()}
                                title={`${call.time} • ${call.title}${call.equipment_model ? ` • ${call.equipment_model}` : ''}`}
                              >
                                {call.time} {call.title}
                                {call.equipment_model && ` • ${call.equipment_model}`}
                              </Link>
                            ))}
                            {dayCalls.length > 3 && (
                              <div className="text-[var(--text3)] text-[9px]">
                                +{dayCalls.length - 3} more
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--text3)] mt-3">
              Tip: click a day to open Day view
              {canCreate ? '; use + or double-click to schedule a call on that date.' : '.'}
            </p>
          </div>
        )}

        {view === 'week' && (
          <div className="card p-6 overflow-x-auto">
            <div className="flex justify-between items-center mb-4">
              <button type="button" onClick={prevWeek} className="btn btn-secondary p-3">
                <ChevronLeft size={20} />
              </button>
              <div className="text-xl font-bold">
                Week of{' '}
                {weekStart.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <button type="button" onClick={nextWeek} className="btn btn-secondary p-3">
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="grid grid-cols-8 gap-px bg-[var(--border)] min-w-[1100px]">
              <div className="bg-[var(--surface)]" />
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, idx) => {
                const dayDate = new Date(
                  weekStart.getFullYear(),
                  weekStart.getMonth(),
                  weekStart.getDate() + idx
                );
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
                            className="text-[10px] p-1 rounded bg-[var(--gold)]/20 text-[var(--gold)] flex items-start gap-1"
                          >
                            <span
                              className="cursor-grab select-none opacity-70"
                              draggable
                              onDragStart={(e) => handleDragStart(e, call)}
                              title="Drag to reschedule"
                            >
                              ⋮⋮
                            </span>
                            <Link href={`/service-tickets/${call.id}`} className="hover:underline flex-1">
                              {call.time} {call.title}
                            </Link>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'day' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-4">
              <button type="button" onClick={prevDay} className="btn btn-secondary p-3">
                <ChevronLeft size={20} />
              </button>
              <div className="text-xl font-bold">
                {cursor.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <button type="button" onClick={nextDay} className="btn btn-secondary p-3">
                <ChevronRight size={20} />
              </button>
            </div>
            {canCreate && (
              <button
                type="button"
                className="btn btn-secondary text-sm mb-4"
                onClick={() => openNewModal(dayYmd)}
              >
                + Add call this day
              </button>
            )}
            <div className="space-y-2">
              {serviceCalls.filter((c) => c.date === dayYmd).length === 0 && (
                <div className="text-[var(--text3)] text-sm py-8 text-center">
                  No tickets scheduled this day.
                </div>
              )}
              {serviceCalls
                .filter((c) => c.date === dayYmd)
                .map((call) => (
                  <Link
                    key={call.id}
                    href={`/service-tickets/${call.id}`}
                    className="block p-3 rounded-lg border border-[var(--border)] hover:border-[var(--gold)]"
                  >
                    <div className="font-semibold text-[var(--gold)]">
                      {call.time} · {call.title}
                    </div>
                    {call.equipment_model && (
                      <div className="text-xs text-[var(--text3)] mt-1">{call.equipment_model}</div>
                    )}
                  </Link>
                ))}
            </div>
          </div>
        )}

        {view === 'agenda' && (
          <div className="card p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Upcoming</h2>
              {canCreate && (
                <button type="button" className="btn btn-primary text-sm" onClick={() => openNewModal()}>
                  + New
                </button>
              )}
            </div>
            {agendaCalls.length === 0 && (
              <div className="text-[var(--text3)] text-sm py-8 text-center">No upcoming tickets.</div>
            )}
            <div className="space-y-2">
              {agendaCalls.map((call) => (
                <Link
                  key={call.id}
                  href={`/service-tickets/${call.id}`}
                  className="p-3 rounded-lg border border-[var(--border)] hover:border-[var(--gold)] flex justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold">{call.title}</div>
                    <div className="text-xs text-[var(--text3)]">
                      {call.date} · {call.time}
                      {call.equipment_model ? ` · ${call.equipment_model}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--gold)]">{call.status}</div>
                </Link>
              ))}
            </div>
            {unscheduledCalls.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-bold text-[var(--text3)] uppercase tracking-wide mb-2">
                  Unscheduled ({unscheduledCalls.length})
                </h3>
                <div className="space-y-2">
                  {unscheduledCalls.map((call) => (
                    <Link
                      key={call.id}
                      href={`/service-tickets/${call.id}`}
                      className="p-3 rounded-lg border border-[var(--border)] hover:border-[var(--gold)] flex justify-between gap-3"
                    >
                      <div>
                        <div className="font-semibold">{call.title}</div>
                        <div className="text-xs text-[var(--text3)]">No service date</div>
                      </div>
                      <div className="text-xs text-[var(--gold)]">{call.status}</div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Service Call modal */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 p-3 sm:p-4"
          onClick={() => !saving && setShowNew(false)}
        >
          <div className="flex min-h-full items-start sm:items-center justify-center">
          <div
            className="card w-full max-w-lg flex flex-col p-0 hover:transform-none"
            style={{
              maxHeight: 'calc(100dvh - 1.5rem)',
              minHeight: 0,
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-6 pt-5 pb-3 shrink-0 border-b border-[var(--border)]">
              <h2 className="text-xl font-bold" style={{ color: 'var(--gold)' }}>
                New Service Call
              </h2>
              <button
                type="button"
                className="text-2xl leading-none text-[var(--text3)] hover:text-[var(--text)]"
                onClick={() => !saving && setShowNew(false)}
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="mx-6 mt-3 p-2 rounded text-sm bg-red-900/30 text-red-400 shrink-0">
                {formError}
              </div>
            )}

            <form
              onSubmit={createTicket}
              className="flex flex-col min-h-0 flex-1"
            >
              <div
                className="space-y-3 px-6 py-4"
                style={{ overflowY: 'auto', minHeight: 0, flex: '1 1 auto', overscrollBehavior: 'contain' }}
              >
              <div className="relative">
                <label className="label">Customer *</label>
                <input
                  className="input"
                  value={form.customer_name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm({ ...form, customer_name: value });
                    const match = matchLinkedCustomer(customers, value);
                    setCustomerOrgId(match?.id || null);
                    setShowCustDrop(true);
                  }}
                  onFocus={() => setShowCustDrop(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowCustDrop(false), 180);
                  }}
                  placeholder="Type to find a company assigned to this shop"
                  autoComplete="off"
                  required
                  autoFocus
                />
                {showCustDrop && (
                  <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--border2)] bg-[var(--surface3)] shadow-lg">
                    {filteredCustomers.length === 0 && !form.customer_name.trim() && (
                      <div className="px-3 py-2 text-xs text-[var(--text3)]">
                        {customers.length
                          ? 'Start typing to search your customers.'
                          : 'No customers assigned to this shop yet.'}
                      </div>
                    )}
                    {filteredCustomers.map((c) => (
                      <button
                        key={String(c.id)}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-[var(--surface)] text-sm"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyCustomer(c)}
                      >
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-[var(--text3)]">
                          {[c.city, c.state].filter(Boolean).join(', ') || 'Assigned customer'}
                        </div>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 border-t border-[var(--border)] text-sm text-[var(--gold)] hover:bg-[var(--surface)]"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setShowCustDrop(false);
                        setShowAddCustomer(true);
                      }}
                    >
                      {form.customer_name.trim() && !matchLinkedCustomer(customers, form.customer_name)
                        ? `Add “${form.customer_name.trim()}” as a new company`
                        : 'Add a company that’s new to me'}
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-[var(--text3)] mt-1">
                  Autofill is limited to customers assigned to your active company. Add a new company to put it on that list.
                </p>
              </div>
              <div>
                <label className="label">Assign to</label>
                <select
                  className="select"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                >
                  {userId && (
                    <option value={userId}>
                      Me{selfName ? ` — ${selfName}` : ''}
                    </option>
                  )}
                  {assignees
                    .filter((a) => a.id !== userId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {roleLabel(a.role)}
                      </option>
                    ))}
                  <option value="">Unassigned</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Service date</label>
                  <input
                    type="date"
                    className="input"
                    value={form.service_date}
                    onChange={(e) => setForm({ ...form, service_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select
                    className="select"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Emergency</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start time</label>
                  <input
                    type="time"
                    className="input"
                    value={form.scheduled_time}
                    onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">End time</label>
                  <input
                    type="time"
                    className="input"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Service type</label>
                  <select
                    className="select"
                    value={form.service_type}
                    onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                  >
                    <option>Repair</option>
                    <option>PM</option>
                    <option>Install</option>
                    <option>Calibration</option>
                    <option>Training</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    className="select"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option>Scheduled</option>
                    <option>Awaiting Scheduling</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Equipment make</label>
                  <input
                    className="input"
                    value={form.equipment_make}
                    onChange={(e) => setForm({ ...form, equipment_make: e.target.value })}
                    placeholder="e.g. Candela"
                  />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input
                    className="input"
                    value={form.equipment_model}
                    onChange={(e) => setForm({ ...form, equipment_model: e.target.value })}
                    placeholder="e.g. GentleMAX Pro"
                  />
                </div>
              </div>
              <div>
                <label className="label">Serial number</label>
                <input
                  className="input"
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Address</label>
                <input
                  className="input"
                  value={form.customer_address}
                  onChange={(e) => setForm({ ...form, customer_address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">City</label>
                  <input
                    className="input"
                    value={form.customer_city}
                    onChange={(e) => setForm({ ...form, customer_city: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">State</label>
                  <input
                    className="input"
                    value={form.customer_state}
                    onChange={(e) => setForm({ ...form, customer_state: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    className="input"
                    value={form.customer_phone}
                    onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Notes / problem</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              </div>

              <div className="flex gap-2 px-6 py-4 border-t border-[var(--border)] shrink-0">
                <button
                  type="button"
                  className="btn btn-secondary flex-1"
                  disabled={saving}
                  onClick={() => setShowNew(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1" disabled={saving}>
                  {saving ? 'Creating…' : 'Create ticket'}
                </button>
              </div>
            </form>
          </div>
          </div>
        </div>
      )}

      {showAddCustomer && orgId != null && (
        <AddCustomerModal
          serviceOrgId={orgId}
          initialName={form.customer_name}
          onClose={() => setShowAddCustomer(false)}
          onCreated={async (id) => {
            const list = await loadLinkedCustomers(supabase, orgId);
            setCustomers(list);
            const hit = list.find((c) => String(c.id) === String(id));
            if (hit) applyCustomer(hit);
            else setCustomerOrgId(id);
            setShowAddCustomer(false);
          }}
        />
      )}
    </div>
  );
}
