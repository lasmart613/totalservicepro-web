'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { saveShopTestEquipment } from '@/lib/test-equipment';

type TeRow = {
  id: string;
  type?: string | null;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  asset_tag?: string | null;
  cal_date?: string | null;
  cal_due?: string | null;
  cal_lab?: string | null;
  notes?: string | null;
  user_id?: string | null;
  organization_id?: number | null;
  owned_by?: string | null;
  assigned_to_fse?: string | null;
  is_active?: boolean | null;
};

/** Ownership option: user id, or special token __org__ for company stock */
type Mate = { id: string; label: string; kind: 'user' | 'org' | 'pending' };

const ORG_OWNER = '__org__';

const TYPES = [
  'Power Meter', 'Energy Meter', 'Multimeter', 'Oscilloscope', 'Thermometer',
  'Beam Profiler', 'Laser Energy/Power Sensor', 'Flow Meter', 'Conductivity Meter',
  'Laser Safety Glasses', 'Other',
];

export default function TestEquipmentPage() {
  const supabase = getSupabaseClient();
  const [rows, setRows] = useState<TeRow[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<Mate[]>([]);
  const [assignOptions, setAssignOptions] = useState<Mate[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeRow | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    setUserId(user.id);
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, first_name, last_name, role')
      .eq('id', user.id)
      .maybeSingle();
    const oId = prof?.organization_id ?? null;
    setOrgId(oId);

    const map: Record<string, string> = {};
    const meLabel =
      [prof?.first_name, prof?.last_name].filter(Boolean).join(' ') ||
      user.email ||
      'Me';
    map[user.id] = meLabel;

    const owners: Mate[] = [];
    const assignees: Mate[] = [];

    // Always include self
    owners.push({ id: user.id, label: `${meLabel} (me · ${prof?.role || 'admin'})`, kind: 'user' });
    assignees.push({ id: user.id, label: `${meLabel} (me · ${prof?.role || 'admin'})`, kind: 'user' });

    let companyName = 'Service company';
    if (oId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', oId)
        .maybeSingle();
      companyName = org?.name || companyName;
      setOrgName(companyName);

      // Company as ownership option (shop stock / org-owned)
      owners.unshift({
        id: ORG_OWNER,
        label: `Organization · ${companyName}`,
        kind: 'org',
      });

      // Team members in same org
      const { data: members, error: memErr } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, role, email')
        .eq('organization_id', oId);
      if (memErr) console.warn('team load', memErr);
      (members || []).forEach((m: any) => {
        const label =
          [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || m.id;
        map[m.id] = label;
        if (m.id === user.id) return;
        const full = `${label}${m.role ? ` · ${m.role}` : ''}`;
        owners.push({ id: m.id, label: full, kind: 'user' });
        assignees.push({ id: m.id, label: full, kind: 'user' });
      });

      // Pending invitations (shown for visibility; not assignable until they join)
      try {
        const { data: invites } = await supabase
          .from('engineer_invitations')
          .select('email, role, first_name, last_name, accepted')
          .eq('organization_id', oId)
          .or('accepted.eq.false,accepted.is.null');
        (invites || []).forEach((inv: any) => {
          const label =
            [inv.first_name, inv.last_name].filter(Boolean).join(' ') ||
            inv.email ||
            'Invite';
          // Already have a profile with this email? skip
          const already = (members || []).some(
            (m: any) => (m.email || '').toLowerCase() === (inv.email || '').toLowerCase()
          );
          if (already) return;
          assignees.push({
            id: `pending:${inv.email}`,
            label: `${label} · pending invite (sign up first)`,
            kind: 'pending',
          });
        });
      } catch (e) {
        console.warn('invites', e);
      }
    }

    setNameById(map);
    setOwnerOptions(owners);
    setAssignOptions(assignees);

    let q = supabase.from('test_equipment').select('*').eq('is_active', true);
    if (oId) {
      q = q.or(
        `organization_id.eq.${oId},user_id.eq.${user.id},owned_by.eq.${user.id},assigned_to_fse.eq.${user.id}`
      );
    } else {
      q = q.eq('user_id', user.id);
    }
    const { data, error } = await q.order('type');
    if (error) {
      const r2 = await supabase
        .from('test_equipment')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);
      setRows((r2.data || []) as TeRow[]);
      if (r2.error && !/relation .* does not exist|could not find the table|schema cache|column/i.test(r2.error.message || '')) {
        toast.error(error.message);
      }
    } else {
      setRows((data || []) as TeRow[]);
    }
    setLoading(false);
  }

  function openNew() {
    setEditing(null);
    setForm({
      type: '',
      make: '',
      model: '',
      serial_number: '',
      asset_tag: '',
      cal_date: '',
      cal_due: '',
      cal_lab: '',
      notes: '',
      owned_by: ORG_OWNER, // default company stock for service cos
      assigned_to_fse: '',
    });
    setOpen(true);
  }

  function openEdit(r: TeRow) {
    setEditing(r);
    // Null owned_by + org => company stock
    const ownedVal =
      !r.owned_by && r.organization_id != null ? ORG_OWNER : r.owned_by || userId || '';
    setForm({
      type: r.type || '',
      make: r.make || '',
      model: r.model || '',
      serial_number: r.serial_number || '',
      asset_tag: r.asset_tag || '',
      cal_date: r.cal_date || '',
      cal_due: r.cal_due || '',
      cal_lab: r.cal_lab || '',
      notes: r.notes || '',
      owned_by: ownedVal,
      assigned_to_fse: r.assigned_to_fse || '',
    });
    setOpen(true);
  }

  async function save() {
    if (!form.type) {
      toast.error('Equipment type is required');
      return;
    }
    if (!userId) return;
    // Pending invites cannot be assigned
    if (String(form.assigned_to_fse || '').startsWith('pending:')) {
      toast.error('That FSE has not signed up yet. Assign after they join the team.');
      return;
    }
    setSaving(true);
    const orgOwned = form.owned_by === ORG_OWNER;
    const payload: any = {
      user_id: userId,
      type: form.type,
      make: form.make || null,
      model: form.model || null,
      serial_number: form.serial_number || null,
      asset_tag: form.asset_tag || null,
      cal_date: form.cal_date || null,
      cal_due: form.cal_due || null,
      cal_lab: form.cal_lab || null,
      notes: form.notes || null,
      organization_id: orgId || null,
      // Company stock: owned_by null + organization_id set
      owned_by: orgOwned ? null : form.owned_by || userId,
      assigned_to_fse: form.assigned_to_fse || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    try {
      const result = await saveShopTestEquipment(supabase, payload, editing?.id || null);
      if (result.unavailable) {
        setOpen(false);
        return;
      }
      if (result.error && !result.schemaLag) {
        throw result.error;
      }
      toast.success('Saved');
      setOpen(false);
      await load();
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/relation .* does not exist|could not find the table|character\(3\)|char\(3\)|value too long|schema cache/i.test(msg)) {
        setOpen(false);
        return;
      }
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function calStatus(due?: string | null) {
    if (!due) return 'none';
    const d = new Date(due);
    const today = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + 60);
    if (d < today) return 'overdue';
    if (d <= soon) return 'warning';
    return 'ok';
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-start gap-3 mb-4 flex-wrap">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">
              ← Dashboard
            </Link>
            <h1 className="text-3xl font-extrabold mt-1">Test Equipment</h1>
            <p className="text-sm text-[var(--text3)] mt-1">
              Track power meters and tools by organization, owner, and assigned FSE.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={openNew}>
            ＋ Add equipment
          </button>
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center text-[var(--text3)]">
            No test equipment yet.
            <div className="mt-4">
              <button type="button" className="btn btn-primary" onClick={openNew}>
                Add first item
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const st = calStatus(r.cal_due);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openEdit(r)}
                  className="card p-4 w-full text-left hover:border-[var(--gold)]"
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <div className="font-bold text-[var(--gold)]">
                        {[r.make, r.model].filter(Boolean).join(' ') || r.type}
                      </div>
                      <div className="text-xs text-[var(--text3)] mt-1">
                        {r.type}
                        {r.serial_number ? ` · SN ${r.serial_number}` : ''}
                        {r.assigned_to_fse
                          ? ` · Assigned: ${nameById[r.assigned_to_fse] || 'FSE'}`
                          : ''}
                        {r.owned_by
                          ? ` · Owner: ${nameById[r.owned_by] || '—'}`
                          : r.organization_id
                            ? ` · Owner: ${orgName || 'Organization'}`
                            : ''}
                      </div>
                    </div>
                    <span
                      className={
                        'text-[10px] font-bold uppercase h-fit px-2 py-1 rounded ' +
                        (st === 'overdue'
                          ? 'bg-red-500/20 text-red-400'
                          : st === 'warning'
                            ? 'bg-amber-500/20 text-amber-400'
                            : st === 'ok'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-[var(--surface3)] text-[var(--text3)]')
                      }
                    >
                      {r.cal_due ? `Due ${r.cal_due}` : 'No cal'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between mb-3">
              <h2 className="font-bold text-lg text-[var(--gold)]">
                {editing ? 'Edit equipment' : 'Add equipment'}
              </h2>
              <button type="button" className="text-[var(--text3)]" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Type *</label>
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="">Select…</option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Make</label>
                  <input
                    className="input"
                    value={form.make}
                    onChange={(e) => setForm({ ...form, make: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input
                    className="input"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Serial #</label>
                  <input
                    className="input"
                    value={form.serial_number}
                    onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Asset tag</label>
                  <input
                    className="input"
                    value={form.asset_tag}
                    onChange={(e) => setForm({ ...form, asset_tag: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Last cal</label>
                  <input
                    type="date"
                    className="input"
                    value={form.cal_date}
                    onChange={(e) => setForm({ ...form, cal_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Cal due</label>
                  <input
                    type="date"
                    className="input"
                    value={form.cal_due}
                    onChange={(e) => setForm({ ...form, cal_due: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Owned by</label>
                <select
                  className="input"
                  value={form.owned_by}
                  onChange={(e) => setForm({ ...form, owned_by: e.target.value })}
                >
                  {ownerOptions.map((m) => (
                    <option key={m.id} value={m.id} disabled={m.kind === 'pending'}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text3)] mt-1">
                  Use Organization for company-owned shop stock. Or pick yourself / a team member.
                </p>
              </div>
              <div>
                <label className="label">Assigned to FSE</label>
                <select
                  className="input"
                  value={form.assigned_to_fse}
                  onChange={(e) => setForm({ ...form, assigned_to_fse: e.target.value })}
                >
                  <option value="">Unassigned / shop stock</option>
                  {assignOptions.map((m) => (
                    <option key={m.id} value={m.id} disabled={m.kind === 'pending'}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text3)] mt-1">
                  Who currently has this meter in the field (you, an FSE, or unassigned).
                </p>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary flex-1" disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
