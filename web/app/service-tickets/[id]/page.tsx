'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
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
  const [organizations, setOrganizations] = useState<any[]>([]);

  const supabase = getSupabaseClient();

  // Fetch ticket + organizations
  useEffect(() => {
    const fetchData = async () => {
      if (!ticketId) return;
      setLoading(true);
      try {
        // Fetch ticket
        const { data: ticketData, error: ticketError } = await supabase
          .from('service_tickets')
          .select('*')
          .eq('id', ticketId)
          .single();

        if (ticketError) throw ticketError;
        setTicket(ticketData);
        setFormData(ticketData);

        // Fetch customer organizations for dropdown
        const { data: orgData } = await supabase
          .from('organizations')
          .select('id, name, address, city, state, zip, phone, email')
          .eq('type', 'customer')
          .eq('is_active', true)
          .order('name');

        setOrganizations(orgData || []);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticketId, supabase]);

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  // Handle customer selection from dropdown
  const handleCustomerSelect = (orgId: string) => {
    if (orgId === 'new') {
      // New customer - clear autofill fields but keep customer_name editable
      handleInputChange('organization_id', null);
      return;
    }

    const selectedOrg = organizations.find(org => org.id.toString() === orgId);
    if (selectedOrg) {
      setFormData((prev: any) => ({
        ...prev,
        customer_name: selectedOrg.name,
        customer_address: selectedOrg.address || prev.customer_address,
        customer_city: selectedOrg.city || prev.customer_city,
        customer_state: selectedOrg.state || prev.customer_state,
        customer_zip: selectedOrg.zip || prev.zip,
        customer_phone: selectedOrg.phone || prev.customer_phone,
        customer_email: selectedOrg.email || prev.customer_email,
        organization_id: selectedOrg.id,
      }));
    }
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
      toast.error('Failed to save changes.');
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
              <Field label="Status" value={isEditing ? (
                <select className="input" value={formData.status || ''} onChange={(e) => handleInputChange('status', e.target.value)}>
                  {['Awaiting Scheduling','Scheduled','En Route','On Site','Parts Ordered','Completed','Cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : ticket.status} />
              <Field label="Priority" value={isEditing ? (
                <select className="input" value={formData.priority || ''} onChange={(e) => handleInputChange('priority', e.target.value)}>
                  {['Low','Medium','High','Emergency'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : ticket.priority} />
              <Field label="Service Type" value={ticket.service_type} />
              <Field label="Description" value={isEditing ? <textarea className="input" rows={3} value={formData.description || ''} onChange={(e) => handleInputChange('description', e.target.value)} /> : ticket.description} multiline />
              <Field label="Notes" value={isEditing ? <textarea className="input" rows={3} value={formData.notes || ''} onChange={(e) => handleInputChange('notes', e.target.value)} /> : ticket.notes} multiline />
            </div>
          </div>

          {/* Customer Information with Dropdown + Autofill */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Customer Information</h2>
            <div className="space-y-4">
              {/* Customer Dropdown */}
              {isEditing && (
                <div>
                  <div className="text-xs text-[var(--text3)] mb-1">Select Existing Customer</div>
                  <select 
                    className="input mb-3" 
                    onChange={(e) => handleCustomerSelect(e.target.value)}
                    defaultValue={formData.organization_id ? formData.organization_id.toString() : 'new'}
                  >
                    <option value="new">New / Custom Customer</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <Field label="Customer Name" value={isEditing ? 
                <input className="input" value={formData.customer_name || ''} onChange={(e) => handleInputChange('customer_name', e.target.value)} placeholder="Enter or select customer" /> 
                : ticket.customer_name} />

              <Field label="Phone" value={isEditing ? <input className="input" value={formData.customer_phone || ''} onChange={(e) => handleInputChange('customer_phone', e.target.value)} /> : ticket.customer_phone} />
              <Field label="Email" value={isEditing ? <input className="input" value={formData.customer_email || ''} onChange={(e) => handleInputChange('customer_email', e.target.value)} /> : ticket.customer_email} />
              <Field label="Address" value={isEditing ? <input className="input" value={formData.customer_address || formData.address || ''} onChange={(e) => handleInputChange('customer_address', e.target.value)} /> : (ticket.customer_address || ticket.address)} />
              <Field label="City" value={isEditing ? <input className="input" value={formData.customer_city || formData.city || ''} onChange={(e) => handleInputChange('customer_city', e.target.value)} /> : (ticket.customer_city || ticket.city)} />
              <Field label="State" value={isEditing ? <input className="input" value={formData.customer_state || formData.state || ''} onChange={(e) => handleInputChange('customer_state', e.target.value)} /> : (ticket.customer_state || ticket.state)} />
              <Field label="ZIP" value={isEditing ? <input className="input" value={formData.zip || ''} onChange={(e) => handleInputChange('zip', e.target.value)} /> : ticket.zip} />
            </div>
          </div>

          {/* Equipment Information */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Equipment Information</h2>
            <div className="space-y-4">
              <Field label="Make" value={isEditing ? <input className="input" value={formData.equipment_make || ''} onChange={(e) => handleInputChange('equipment_make', e.target.value)} /> : ticket.equipment_make} />
              <Field label="Model" value={isEditing ? <input className="input" value={formData.equipment_model || ''} onChange={(e) => handleInputChange('equipment_model', e.target.value)} /> : ticket.equipment_model} />
              <Field label="Equipment Type" value={isEditing ? <input className="input" value={formData.equipment_type || ''} onChange={(e) => handleInputChange('equipment_type', e.target.value)} /> : ticket.equipment_type} />
              <Field label="Serial Number" value={isEditing ? <input className="input" value={formData.serial_number || ''} onChange={(e) => handleInputChange('serial_number', e.target.value)} /> : ticket.serial_number} />
              <Field label="PM Due Date" value={isEditing ? <input type="date" className="input" value={formData.service_date || ''} onChange={(e) => handleInputChange('service_date', e.target.value)} /> : ticket.service_date} />
            </div>
          </div>

          {/* Scheduling */}
          <div className="card p-6">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Scheduling</h2>
            <div className="space-y-4">
              <Field label="Service Date" value={isEditing ? <input type="date" className="input" value={formData.service_date || ''} onChange={(e) => handleInputChange('service_date', e.target.value)} /> : ticket.service_date} />
              <Field label="Scheduled Time" value={isEditing ? <input type="time" className="input" value={formData.scheduled_time || ''} onChange={(e) => handleInputChange('scheduled_time', e.target.value)} /> : ticket.scheduled_time} />
              <Field label="End Time" value={isEditing ? <input type="time" className="input" value={formData.end_time || ''} onChange={(e) => handleInputChange('end_time', e.target.value)} /> : ticket.end_time} />
              <Field label="Arrival Time" value={ticket.arrival_time} />
              <Field label="Departure Time" value={ticket.departure_time} />
            </div>
          </div>

          {/* Additional Details */}
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-xl font-bold mb-4 border-b border-[var(--border)] pb-3">Additional Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="PO Number" value={isEditing ? <input className="input" value={formData.po_number || ''} onChange={(e) => handleInputChange('po_number', e.target.value)} /> : ticket.po_number} />
              <Field label="Contract Number" value={isEditing ? <input className="input" value={formData.contract_number || ''} onChange={(e) => handleInputChange('contract_number', e.target.value)} /> : ticket.contract_number} />
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