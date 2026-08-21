'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { CustomerInfoForm } from '@/components/CustomerInfoForm';
import {
  createLinkedCustomer,
  emptyCustomerForm,
  type CustomerInfoFormValues,
} from '@/lib/customer-form';
import { getSupabaseClient } from '@/lib/supabase/client';

type Props = {
  serviceOrgId: string | number | null;
  onClose: () => void;
  onCreated: (id: string | number) => void;
};

export function AddCustomerModal({ serviceOrgId, onClose, onCreated }: Props) {
  const supabase = getSupabaseClient();
  const [form, setForm] = useState<CustomerInfoFormValues>(emptyCustomerForm());
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const created = await createLinkedCustomer(supabase, {
        serviceOrgId: serviceOrgId as string | number,
        form,
        createdBy: user?.id || null,
      });
      toast.success('Customer added');
      onCreated(created.id);
      onClose();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message || 'Failed to add customer');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border2)] rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-customer-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="add-customer-title" className="font-extrabold text-lg text-[var(--gold)]">
              Add Customer
            </h2>
            <p className="text-xs text-[var(--text3)] mt-1">
              Same customer information used on the CRM profile. Linked to your organization only.
            </p>
          </div>
          <button
            type="button"
            className="text-[var(--text3)] hover:text-[var(--text)] text-xl leading-none px-1"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <CustomerInfoForm value={form} onChange={setForm} disabled={saving} />

        <div className="flex flex-col-reverse sm:flex-row gap-3 mt-6">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
          >
            {saving ? 'Saving…' : 'Save Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}
