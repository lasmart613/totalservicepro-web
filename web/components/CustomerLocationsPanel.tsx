'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/lib/supabase/client';
import { updateOmittingCharOverflow } from '@/lib/char-overflow';
import {
  CustomerLocationsEditor,
} from '@/components/CustomerLocationsEditor';
import {
  draftFromLocation,
  emptyLocationDraft,
  loadCustomerLocations,
  locationsForDisplay,
  orgAddressPatch,
  overlayPrimaryFromForm,
  removeCustomerLocation,
  saveCustomerLocation,
  setCustomerLocationPrimary,
  type CustomerLocation,
  type LocationAddressFields,
  type LocationDraft,
} from '@/lib/customer-locations';

type Props = {
  customerId: string | number;
  canEdit?: boolean;
  refreshKey?: number;
  orgAddress: LocationAddressFields & { id?: string | number | null };
  onLocations?: (locations: CustomerLocation[]) => void;
  onPrimaryAddress?: (fields: LocationAddressFields) => void;
};

export function CustomerLocationsPanel({
  customerId,
  canEdit = true,
  refreshKey = 0,
  orgAddress,
  onLocations,
  onPrimaryAddress,
}: Props) {
  const supabase = getSupabaseClient();
  const [rows, setRows] = useState<CustomerLocation[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [mode, setMode] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(emptyLocationDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    (next: CustomerLocation[]) => {
      setRows(next);
      onLocations?.(next);
    },
    [onLocations]
  );

  const reload = useCallback(async () => {
    const loaded = await loadCustomerLocations(supabase, customerId);
    setUnavailable(loaded.unavailable);
    publish(loaded.locations);
    return loaded;
  }, [customerId, publish, supabase]);

  useEffect(() => {
    let cancelled = false;
    loadCustomerLocations(supabase, customerId).then((loaded) => {
      if (cancelled) return;
      setUnavailable(loaded.unavailable);
      setRows(loaded.locations);
      onLocations?.(loaded.locations);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, refreshKey, supabase, onLocations]);

  function applyPrimaryToForm(loc: CustomerLocation | null) {
    if (!loc || !onPrimaryAddress) return;
    const patch = orgAddressPatch(loc);
    onPrimaryAddress({
      address: patch.address || '',
      city: patch.city || '',
      state: patch.state || '',
      zip: patch.zip || '',
      phone: patch.phone || orgAddress.phone || '',
    });
  }

  async function mirrorPrimaryOnOrg(loc: CustomerLocation) {
    const patch = orgAddressPatch(loc);
    const payload: Record<string, unknown> = {
      address: patch.address,
      city: patch.city,
      state: patch.state,
      zip: patch.zip,
      updated_at: new Date().toISOString(),
    };
    if (patch.phone) payload.phone = patch.phone;
    const { error: orgError } = await updateOmittingCharOverflow(
      supabase,
      'organizations',
      payload,
      { column: 'id', value: customerId },
      { maxAttempts: 12 }
    );
    if (orgError) console.warn('primary address mirror', orgError.message || orgError);
  }

  function startAdd() {
    setError(null);
    setEditingId(null);
    setMode('add');
    setDraft(emptyLocationDraft({ is_primary: rows.length === 0 }));
  }

  function startEdit(loc: CustomerLocation) {
    setError(null);
    setEditingId(loc.id);
    setMode('edit');
    setDraft(draftFromLocation(loc));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const stored = rows.filter((loc) => !loc.localOnly);
    const forcePrimary = mode === 'add' ? stored.length === 0 : stored.length <= 1;
    const nextDraft = forcePrimary ? { ...draft, is_primary: true } : draft;
    try {
      const saved = await saveCustomerLocation(
        supabase,
        customerId,
        nextDraft,
        mode === 'edit' ? editingId : null
      );
      if (saved.unavailable) {
        setUnavailable(true);
        setError(saved.error || null);
        return;
      }
      if (saved.error) {
        setError(saved.error);
        return;
      }
      if (saved.contactDropped) {
        toast.success('Location saved. Contact name is stored after the database update.');
      } else {
        toast.success(mode === 'add' ? 'Location added' : 'Location updated');
      }
      publish(saved.locations);
      if (nextDraft.is_primary && saved.location) {
        applyPrimaryToForm(saved.location);
        await mirrorPrimaryOnOrg(saved.location);
      }
      setMode(null);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function remove(loc: CustomerLocation) {
    if (
      !confirm(
        `Remove “${loc.name}”?\n\nTickets already written keep the address they were saved with.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await removeCustomerLocation(supabase, customerId, loc.id, rows);
      if (result.unavailable) {
        setUnavailable(true);
        setError(result.error || null);
        return;
      }
      const loaded = await reload();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (loc.is_primary) {
        const primary =
          result.location ||
          loaded.locations.find((row) => row.is_primary) ||
          null;
        if (primary) {
          applyPrimaryToForm(primary);
          await mirrorPrimaryOnOrg(primary);
        }
      }
      toast.success('Location removed');
    } finally {
      setSaving(false);
    }
  }

  async function makePrimary(loc: CustomerLocation) {
    setSaving(true);
    setError(null);
    try {
      const result = await setCustomerLocationPrimary(supabase, customerId, loc.id);
      if (result.unavailable) {
        setUnavailable(true);
        setError(result.error || null);
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      publish(result.locations);
      const primary = result.location || loc;
      applyPrimaryToForm(primary);
      await mirrorPrimaryOnOrg(primary);
      toast.success(`${primary.name} is the primary location`);
    } finally {
      setSaving(false);
    }
  }

  const shown = overlayPrimaryFromForm(locationsForDisplay(rows, { ...orgAddress, id: customerId }), orgAddress);

  return (
    <CustomerLocationsEditor
      locations={shown}
      unavailable={unavailable}
      canEdit={canEdit}
      saving={saving}
      mode={mode}
      draft={draft}
      error={error}
      onStartAdd={startAdd}
      onStartEdit={startEdit}
      onCancel={() => {
        setMode(null);
        setError(null);
      }}
      onDraftChange={setDraft}
      onSubmit={submit}
      onRemove={remove}
      onSetPrimary={makePrimary}
    />
  );
}
