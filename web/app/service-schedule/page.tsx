'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

const PRIORITIES = ['Low', 'Medium', 'High', 'Emergency'];
const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

export default function ServiceSchedule() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMyTasks, setShowMyTasks] = useState(false);
  const [newTicket, setNewTicket] = useState({
    customer_name: '',
    customer_address: '',
    equipment_make: '',
    equipment_model: '',
    service_date: '',
    priority: 'Medium',
    status: 'scheduled',
    assigned_to: '',
    notes: '',
  });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const supabase = getSupabaseClient();

  useEffect(() => {
    loadTickets();
  }, [showMyTasks]);

  async function loadTickets() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, first_name, last_name')
        .eq('id', user.id)
        .maybeSingle();

      let query = supabase.from('service_tickets').select('*').order('service_date', { ascending: true });

      if (prof?.organization_id) {
        query = query.eq('organization_id', prof.organization_id);
      }

      if (showMyTasks && prof) {
        const myName = [prof.first_name, prof.last_name].filter(Boolean).join(' ');
        query = query.ilike('assigned_to', `%${myName}%`);
      }

      const { data } = await query.limit(50);
      setTickets(data || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function createTicket() {
    setCreating(true);
    setMessage('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();

      const ticketData: any = {
        ...newTicket,
        organization_id: prof?.organization_id || null,
        ticket_number: 'T-' + Date.now().toString().slice(-6),
        created_by: user.id,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('service_tickets').insert(ticketData);
      if (error) throw error;

      setMessage('Ticket created successfully!');
      setNewTicket({
        customer_name: '', customer_address: '', equipment_make: '', equipment_model: '',
        service_date: '', priority: 'Medium', status: 'scheduled', assigned_to: '', notes: '',
      });
      await loadTickets();
    } catch (err: any) {
      setMessage('Failed to create ticket: ' + (err.message || err));
    }
    setCreating(false);
  }

  async function updateTicketStatus(id: string, newStatus: string) {
    try {
      await supabase.from('service_tickets').update({ status: newStatus }).eq('id', id);
      await loadTickets();
    } catch (e) {
      alert('Update failed');
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto w-full px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-extrabold">📅 Service Schedule</h1>
            <p className="text-sm text-[var(--text3)]">Tickets, assignments &amp; upcoming work (operational basic version)</p>
          </div>
          <Link href="/hub" className="text-sm text-[var(--gold)] hover:underline">← Back to Tech Hub</Link>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded text-sm ${message.includes('success') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
            {message}
          </div>
        )}

        {/* Create New Ticket - operational create like Android */}
        <div className="card p-5 mb-8">
          <h2 className="font-bold mb-3">+ New Ticket</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input className="input" placeholder="Customer / Facility Name" value={newTicket.customer_name} onChange={e => setNewTicket({ ...newTicket, customer_name: e.target.value })} />
            <input className="input" placeholder="Customer Address" value={newTicket.customer_address} onChange={e => setNewTicket({ ...newTicket, customer_address: e.target.value })} />
            <input className="input" placeholder="Equipment Make / Model" value={newTicket.equipment_make + ' ' + newTicket.equipment_model} onChange={e => {
              const [make, ...model] = e.target.value.split(' ');
              setNewTicket({ ...newTicket, equipment_make: make || '', equipment_model: model.join(' ') });
            }} />
            <input type="date" className="input" value={newTicket.service_date} onChange={e => setNewTicket({ ...newTicket, service_date: e.target.value })} />
            <select className="select" value={newTicket.priority} onChange={e => setNewTicket({ ...newTicket, priority: e.target.value })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className="input" placeholder="Assigned To (name or FSE)" value={newTicket.assigned_to} onChange={e => setNewTicket({ ...newTicket, assigned_to: e.target.value })} />
            <textarea className="input col-span-1 md:col-span-3" rows={2} placeholder="Notes / Scope" value={newTicket.notes} onChange={e => setNewTicket({ ...newTicket, notes: e.target.value })} />
          </div>
          <button onClick={createTicket} disabled={creating || !newTicket.customer_name || !newTicket.service_date} className="btn btn-primary mt-4">
            {creating ? 'Creating...' : 'Create Ticket'}
          </button>
          <p className="text-[10px] mt-2 text-[var(--text3)]">Matches core Android service_schedule.html create flow (customer, equipment, date, assigned, priority, status).</p>
        </div>

        {/* List + Filters - operational agenda/list like Android */}
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold">Upcoming / Scheduled Tickets</div>
          <button onClick={() => setShowMyTasks(!showMyTasks)} className="btn btn-secondary text-xs px-3 py-1">
            {showMyTasks ? 'Show All' : 'My Tasks Only'}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="card p-6 text-center text-[var(--text3)]">No tickets yet. Create one above.</div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t, i) => (
              <div key={i} className="card p-4 flex flex-col md:flex-row md:items-center gap-4 justify-between">
                <div>
                  <div className="font-semibold">{t.ticket_number || 'Ticket'} • {t.customer_name}</div>
                  <div className="text-sm text-[var(--text3)]">{t.equipment_make} {t.equipment_model} • {t.service_date}</div>
                  <div className="text-xs mt-1">Assigned: {t.assigned_to || 'Unassigned'} • Priority: {t.priority}</div>
                  {t.notes && <div className="text-xs mt-1 opacity-70">{t.notes}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <select className="select text-xs" value={t.status} onChange={e => updateTicketStatus(t.id, e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <Link href="/reports/new" className="text-xs text-[var(--gold)] hover:underline">Create Report →</Link>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-[var(--text3)]">
          Basic operational version ported from Android <code>service_schedule.html</code>. Full calendar views, navigation, advanced dispatching available in the native Android app. Tickets use the shared <code>service_tickets</code> table.
        </div>
      </div>
    </div>
  );
}
