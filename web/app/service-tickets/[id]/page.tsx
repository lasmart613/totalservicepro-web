'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Header } from '../../../components/Header';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { ArrowLeft, Edit2, Save, X } from 'lucide-react';
import { toast } from 'sonner';

export default function ServiceTicketDetail() {
  const params = useParams();
  const ticketId = params.id as string;

  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const supabase = getSupabaseClient();

  useEffect(() => {
    const fetchTicket = async () => {
      if (!ticketId) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('service_tickets')
          .select('*')
          .eq('id', ticketId)
          .single();

        if (error) throw error;
        setTicket(data);
        setFormData(data);
      } catch (err) {
        console.error('Error fetching ticket:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTicket();
  }, [ticketId, supabase]);

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!ticketId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('service_tickets')
        .update({ ...formData, updated_at: new Date().toISOString() })
        .eq('id', ticketId);

      if (error) throw error;

      setTicket(formData);
      setIsEditing(false);
      toast.success('Ticket updated successfully!');
    } catch (err) {
      console.error('Error saving ticket:', err);
      toast.error('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData(ticket);
    setIsEditing(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-[var(--text3)]">Loading ticket...</div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl mb-4">Ticket not found</p>
          <Link href="/service-schedule" className="btn btn-primary">Back to Schedule</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/service-schedule" className="btn btn-secondary p-3">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-4xl font-extrabold">Ticket #{ticket.ticket_number}</h1>
              <p className="text-[var(--text3)]">{ticket.customer_name}</p>
            </div>
          </div>

          <div className="flex gap-3">
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} className="btn btn-primary flex items-center gap-2">
                <Edit2 size={18} /> Edit Ticket
              </button>
            ) : (
              <>
                <button onClick={handleCancel} className="btn btn-secondary flex items-center gap-2">
                  <X size={18} /> Cancel
                </button>
                <button onClick={handleSave} disabled={saving} className="btn btn-primary flex items-center gap-2 disabled:opacity-60">
                  <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Ticket Information */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Ticket Information</h2>
            <div className="space-y-4">
              <Field label="Ticket Number" value={ticket.ticket_number} />
              <Field 
                label="Status" 
                value={isEditing ? (
                  <select className="input" value={formData.status || ''} onChange={(e) => handleInputChange('status', e.target.value)}>
                    {['Awaiting Scheduling','Scheduled','En Route','On Site','Parts Ordered','Completed','Cancelled'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : ticket.status} 
              />
              <Field 
                label="Priority" 
                value={isEditing ? (
                  <select className="input" value={formData.priority || ''} onChange={(e) => handleInputChange('priority', e.target.value)}>
                    {['Low','Medium','High','Emergency'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : ticket.priority} 
              />
              <Field label="Service Type" value={ticket.service_type} />
              <Field 
                label="Description" 
                value={isEditing ? (
                  <textarea className="input" rows={3} value={formData.description || ''} onChange={(e) => handleInputChange('description', e.target.value)} />
                ) : ticket.description} 
                multiline 
              />
              <Field 
                label="Notes" 
                value={isEditing ? (
                  <textarea className="input" rows={3} value={formData.notes || ''} onChange={(e) => handleInputChange('notes', e.target.value)} />
                ) : ticket.notes} 
                multiline 
              />
            </div>
          </div>

          {/* Customer Information */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Customer Information</h2>
            <div className="space-y-4">
              <Field label="Customer Name" value={ticket.customer_name} />
              <Field label="Phone" value={ticket.customer_phone} />
              <Field label="Email" value={ticket.customer_email} />
              <Field label="Address" value={ticket.customer_address || ticket.address} />
              <Field label="City" value={ticket.customer_city || ticket.city} />
              <Field label="State" value={ticket.customer_state || ticket.state} />
              <Field label="ZIP" value={ticket.zip} />
            </div>
          </div>

          {/* Equipment Information */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Equipment Information</h2>
            <div className="space-y-4">
              <Field label="Make" value={ticket.equipment_make} />
              <Field label="Model" value={ticket.equipment_model} />
              <Field label="Type" value={ticket.equipment_type} />
              <Field label="Serial Number" value={ticket.serial_number} />
            </div>
          </div>

          {/* Scheduling */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Scheduling</h2>
            <div className="space-y-4">
              <Field label="Service Date" value={ticket.service_date} />
              <Field label="Scheduled Time" value={ticket.scheduled_time} />
              <Field label="End Time" value={ticket.end_time} />
              <Field label="Arrival Time" value={ticket.arrival_time} />
              <Field label="Departure Time" value={ticket.departure_time} />
            </div>
          </div>

          {/* Additional Details */}
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Additional Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="PO Number" value={ticket.po_number} />
              <Field label="Contract Number" value={ticket.contract_number} />
              <Field label="Billable" value={ticket.billable ? 'Yes' : 'No'} />
              <Field label="Created At" value={ticket.created_at} />
              <Field label="Last Updated" value={ticket.updated_at} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, multiline = false }: { label: string; value: any; multiline?: boolean }) {
  if (!value && value !== false) return null;

  return (
    <div>
      <div className="text-xs text-[var(--text3)] mb-1">{label}</div>
      {multiline ? (
        <div className="text-sm whitespace-pre-wrap">{value}</div>
      ) : (
        <div className="text-sm font-medium">{value}</div>
      )}
    </div>
  );
}