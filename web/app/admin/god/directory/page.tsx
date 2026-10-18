'use client';

import { useCallback, useEffect, useState } from 'react';
import { godAuthHeader } from '@/lib/god-client';

type Reg = {
  id: string;
  status: string;
  step: number;
  org_type: string;
  email: string;
  created_at: string;
  name: string | null;
  contact_name: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  supported_brands: string[] | null;
  specialties: string[] | null;
  service_territories: string[] | null;
  organization_id: number | null;
  possible_duplicate: boolean;
  email_verified?: boolean;
  details?: Record<string, unknown> | null;
  matched_organization_id: number | null;
  matched_name: string | null;
  matched_type: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  service_company: 'Service and repair',
  parts_supplier: 'Parts supplier',
  laser_rental: 'Rental',
  laser_clinic: 'Clinic / owner',
};

/** Medical Repair Network sign-ups waiting for review (000926). */
export default function GodDirectoryReviewPage() {
  const [rows, setRows] = useState<Reg[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/god/directory', { headers: await godAuthHeader(), cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setRows(j.registrations || []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not load');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !window.confirm('Reject this sign-up? It stays unlisted and no email is sent.')) return;
    setBusy(id);
    setMsg('');
    try {
      const res = await fetch('/api/god/directory', {
        method: 'POST',
        headers: await godAuthHeader(),
        body: JSON.stringify({ registration_id: id, decision }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.code || j.error || `HTTP ${res.status}`);
      const invite = j.invite_kind
        ? ` Invite: ${j.invite_kind}${j.invite_skipped ? ` (skipped: ${j.invite_skipped})` : j.emailed ? ', emailed' : `, not emailed${j.email_skipped ? ` (${j.email_skipped})` : ''}`}.`
        : '';
      setMsg(`${decision === 'approve' ? 'Approved' : 'Rejected'}${j.already ? ' (already)' : ''}.${invite}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Directory sign-ups</h1>
      <p className="text-sm text-[var(--text3)]">
        Medical Repair Network registrations waiting for review. Approve lists the company and emails one invite to the
        registered address. Reject keeps it unlisted and sends nothing.
      </p>
      {msg && <div className="card p-3 text-sm">{msg}</div>}
      {rows === null ? (
        <div className="text-[var(--text3)]">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-[var(--text3)]">Nothing to review.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card p-4 space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-base">{r.name || '(no org created)'}</strong>
                <span className="badge">{TYPE_LABEL[r.org_type] || r.org_type}</span>
                {r.possible_duplicate && (
                  <span className="badge" style={{ background: 'rgba(240,140,140,.2)' }}>
                    Possible duplicate of #{r.matched_organization_id} {r.matched_name || ''} ({r.matched_type || '?'})
                  </span>
                )}
                {r.step < 2 && <span className="badge">Step 2 not finished</span>}
                {!r.organization_id && <span className="badge">No org created (matched at sign-up)</span>}
              </div>
              <div>
                {r.contact_name || '—'} · {r.email}{' '}
                <span className="badge" title="Nobody has confirmed this address yet. Treat the contact details as typed by the registrant.">
                  email unverified
                </span>{' '}
                · {r.phone || 'no phone'}
                {r.website ? ` · ${r.website}` : ''}
              </div>
              <div className="text-[var(--text3)]">
                {[r.city, r.state].filter(Boolean).join(', ') || 'No location'} · Signed up{' '}
                {new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Phoenix' })} (Arizona time)
              </div>
              {(r.specialties?.length || r.supported_brands?.length || r.service_territories?.length) ? (
                <div className="text-[var(--text3)]">
                  {r.specialties?.join(', ')} {r.supported_brands?.length ? `· Brands: ${r.supported_brands.join(', ')}` : ''}{' '}
                  {r.service_territories?.length ? `· Covers: ${r.service_territories.join(', ')}` : ''}
                </div>
              ) : null}
              <div className="flex gap-2 pt-2">
                <button
                  className="btn btn-primary text-xs"
                  disabled={busy === r.id || !r.organization_id}
                  title={r.organization_id ? '' : 'Matched an existing company at step 1; no org to list'}
                  onClick={() => decide(r.id, 'approve')}
                >
                  Approve and list
                </button>
                <button className="btn btn-secondary text-xs" disabled={busy === r.id} onClick={() => decide(r.id, 'reject')}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
