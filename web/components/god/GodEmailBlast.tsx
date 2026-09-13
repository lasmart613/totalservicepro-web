'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { godAuthHeader } from '@/lib/god-client';
import { orgTypeLabel } from '@/lib/labels';
import type { GodOrgRow } from '@/lib/god-orgs';
import {
  BLAST_TEMPLATES,
  clinicInviteAudience,
  pickBlastRecipient,
  selectedWithEmails,
  type BlastTemplateKey,
} from '@/lib/god-email-blast';

type SendLog = {
  id: string;
  created_at: string;
  organization_id: number | string | null;
  organization_name: string | null;
  recipient_email: string;
  subject: string;
  template_key?: string | null;
  unsubscribed_at?: string | null;
};

type Preview = {
  template_key: BlastTemplateKey;
  template_name: string;
  subject: string;
  from: string;
  reply_to: string;
  html: string;
};

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  { value: 'service_company', label: 'Repair company' },
  { value: 'customer', label: 'Clinic / laser owner' },
  { value: 'laser_clinic', label: 'Laser clinic' },
  { value: 'laser_rental', label: 'Rental' },
  { value: 'laser_reseller', label: 'Reseller' },
  { value: 'parts_supplier', label: 'Parts' },
  { value: 'vendor', label: 'Vendor' },
];

const PLAN_FILTERS = [
  { value: 'all', label: 'All plans' },
  { value: 'free', label: 'Free' },
  { value: 'premium', label: 'Premium' },
  { value: 'team', label: 'Team' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'unpaid', label: 'Unpaid' },
];

const TEMPLATE_OPTIONS: Array<{ value: BlastTemplateKey; label: string }> = [
  { value: 'clinic_invite', label: BLAST_TEMPLATES.clinic_invite.name },
  { value: 'shop_invite', label: BLAST_TEMPLATES.shop_invite.name },
];

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function GodEmailBlast({ variant = 'page' }: { variant?: 'page' | 'crm' }) {
  const [orgs, setOrgs] = useState<GodOrgRow[]>([]);
  const [sends, setSends] = useState<SendLog[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [templateKey, setTemplateKey] = useState<BlastTemplateKey>('clinic_invite');
  const [type, setType] = useState('all');
  const [plan, setPlan] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await godAuthHeader();
        const [orgRes, previewRes, logRes] = await Promise.all([
          fetch('/api/god/orgs', { headers, cache: 'no-store' }),
          fetch(`/api/god/blast/preview?template_key=${templateKey}`, { headers, cache: 'no-store' }),
          fetch('/api/god/invite/log', { headers, cache: 'no-store' }),
        ]);
        const orgJson = await orgRes.json().catch(() => ({}));
        const previewJson = await previewRes.json().catch(() => ({}));
        const logJson = await logRes.json().catch(() => ({}));
        if (cancelled) return;
        setOrgs(orgJson.orgs || []);
        if (previewRes.ok) {
          setPreview({
            template_key: previewJson.template_key,
            template_name: previewJson.template_name,
            subject: previewJson.subject,
            from: previewJson.from,
            reply_to: previewJson.reply_to,
            html: previewJson.html || '',
          });
        }
        setSends(logJson.sends || []);
      } catch (e) {
        console.error('god email blast load', e);
        toast.error('Could not load Email blast');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateKey]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return orgs.filter((org) => {
      if (type !== 'all' && String(org.type).toLowerCase() !== type) return false;
      if (plan !== 'all' && org.planKey !== plan) return false;
      if (!query) return true;
      const hay = [
        org.name,
        org.orgEmail,
        org.adminEmail,
        org.typeLabel,
        org.planLabel,
        ...org.users.map((u) => `${u.name} ${u.email}`),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [orgs, type, plan, q]);

  const selectedRows = visible.filter((org) => selected.has(String(org.id)));
  const selectedEmailRows = selectedWithEmails(selectedRows);
  const clinicAudience = useMemo(() => clinicInviteAudience(orgs), [orgs]);

  function toggle(id: number | string) {
    const key = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const org of visible) {
        if (on) next.add(String(org.id));
        else next.delete(String(org.id));
      }
      return next;
    });
  }

  function selectClinicAudience() {
    setType('laser_clinic');
    setPlan('all');
    setSelected(new Set(clinicAudience.map((org) => String(org.id))));
  }

  async function sendSelected() {
    if (!selectedEmailRows.length) {
      toast.error('Select one or more organizations with an email first.');
      return;
    }
    setSending(true);
    try {
      const headers = await godAuthHeader();
      const res = await fetch('/api/god/blast/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          confirm: true,
          template_key: templateKey,
          organization_ids: selectedRows.map((o) => o.id),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Send failed');
        return;
      }
      toast.success(`Sent ${json.sentCount || 0} ${preview?.template_name || 'blast'}${json.sentCount === 1 ? '' : 's'}.`);
      if (json.skipped) toast.message(`${json.skipped} skipped (no email, duplicate, unsubscribed, or provider error).`);
      const logRes = await fetch('/api/god/invite/log', { headers, cache: 'no-store' });
      const logJson = await logRes.json().catch(() => ({}));
      setSends(logJson.sends || []);
      setConfirming(false);
      setSelected(new Set());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <section>
      {variant === 'page' ? (
        <>
          <h2 className="text-2xl font-bold mb-2">Email blast</h2>
          <p className="text-[var(--text3)] mb-4 max-w-3xl">
            Soft beta — no Ads. Pick a locked template, filter the audience, then check the orgs you
            want. Nothing is selected by default. Recipient is the organization email. clinic_invite
            skips repair companies.
          </p>
        </>
      ) : (
        <p className="text-[var(--text3)] mb-4 max-w-3xl">
          Locked God blasts. Nothing is selected by default. clinic_invite is for laser_clinic orgs
          with an org email — service companies are skipped.
        </p>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <label className="text-sm text-[var(--text3)] flex items-center gap-2">
          Template
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value as BlastTemplateKey)}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)]"
          >
            {TEMPLATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[220px]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
        >
          {TYPE_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
        >
          {PLAN_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <button type="button" className="btn btn-secondary text-xs" onClick={() => toggleVisible(true)}>
          Select visible
        </button>
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={selectClinicAudience}
          disabled={!clinicAudience.length}
        >
          Select laser clinics with org email
        </button>
        <button type="button" className="btn btn-secondary text-xs" onClick={() => setSelected(new Set())}>
          Clear selection
        </button>
        <span className="text-[var(--text3)]">
          {visible.length} shown · {selected.size} selected · {selectedEmailRows.length} selected
          with email · {orgs.length} total
        </span>
      </div>

      <div className="overflow-x-auto card mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              <th className="p-3 w-10"></th>
              <th className="p-3">Organization</th>
              <th className="p-3">Type</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Org email</th>
              <th className="p-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((org) => {
              const key = String(org.id);
              const open = expanded === key;
              const recipient = pickBlastRecipient(org);
              return (
                <React.Fragment key={key}>
                  <tr className="border-b border-[var(--border)] hover:bg-[var(--surface3)]">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggle(org.id)}
                        aria-label={`Select ${org.name}`}
                      />
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-left font-semibold hover:text-[var(--gold)] bg-transparent border-0 p-0 text-inherit cursor-pointer"
                        onClick={() => setExpanded(open ? null : key)}
                      >
                        {org.name}
                      </button>
                    </td>
                    <td className="p-3">{org.typeLabel || orgTypeLabel(org.type)}</td>
                    <td className="p-3">{org.planLabel}</td>
                    <td className="p-3">{recipient || '—'}</td>
                    <td className="p-3 whitespace-nowrap">{formatDate(org.createdAt)}</td>
                  </tr>
                  {open && (
                    <tr className="bg-[var(--surface)]">
                      <td></td>
                      <td colSpan={5} className="p-3 text-[var(--text2)]">
                        <div className="mb-2 text-xs text-[var(--text3)]">
                          org.email: {org.orgEmail || '—'} · admin: {org.adminEmail || '—'}
                        </div>
                        {org.users.length === 0 ? (
                          <div>No users on this organization.</div>
                        ) : (
                          <ul className="space-y-1">
                            {org.users.map((u) => (
                              <li key={u.id}>
                                {u.name} · {u.email || 'no email'} · {u.role}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-[var(--text3)]">
                  No organizations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mb-8">
        <h3 className="text-xl font-bold mb-2">Preview</h3>
        <p className="text-[var(--text3)] mb-3">
          Locked HTML. Template:{' '}
          <span className="text-[var(--gold)]">{preview?.template_name || templateKey}</span>
          {' · '}
          Subject: <span className="text-[var(--gold)]">{preview?.subject || '—'}</span>
        </p>
        <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-[#0b0f14]">
          <iframe
            title="Email blast preview"
            srcDoc={preview?.html || ''}
            className="w-full min-h-[640px] border-0 bg-[#0b0f14]"
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3 mb-10">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selectedEmailRows.length}
          onClick={() => setConfirming(true)}
        >
          Send blast to {selectedEmailRows.length} with email
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="card max-w-lg w-full p-6">
            <h3 className="text-xl font-bold mb-2">Send email blast?</h3>
            <dl className="text-sm mb-4 space-y-1">
              <div>
                <dt className="inline text-[var(--text3)]">Template: </dt>
                <dd className="inline">
                  {preview?.template_name || templateKey} ({templateKey})
                </dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Subject: </dt>
                <dd className="inline">{preview?.subject || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">From: </dt>
                <dd className="inline">{preview?.from || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Reply-To: </dt>
                <dd className="inline">{preview?.reply_to || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Recipient count: </dt>
                <dd className="inline">{selectedEmailRows.length}</dd>
              </div>
            </dl>
            <p className="text-sm text-[var(--text3)] mb-3">
              This emails the locked template to each selected organization email. Duplicates and
              missing addresses are skipped. Nothing else is written on those orgs.
            </p>
            <ul className="text-sm mb-5 max-h-40 overflow-y-auto space-y-1">
              {selectedRows.map((org) => (
                <li key={String(org.id)}>
                  <strong>{org.name}</strong> → {pickBlastRecipient(org) || 'no email'}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={sending} onClick={sendSelected}>
                {sending ? 'Sending…' : 'Confirm send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h3 className="text-xl font-bold mb-2">Send log</h3>
        <p className="text-[var(--text3)] mb-3">Who already got a God blast or shop invite. Manual sends only.</p>
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
                <th className="p-3">When</th>
                <th className="p-3">Template</th>
                <th className="p-3">Organization</th>
                <th className="p-3">Recipient</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]">
                  <td className="p-3 whitespace-nowrap">{formatDate(row.created_at)}</td>
                  <td className="p-3">{row.template_key || '—'}</td>
                  <td className="p-3">{row.organization_name || row.organization_id}</td>
                  <td className="p-3">{row.recipient_email}</td>
                  <td className="p-3">{row.unsubscribed_at ? 'Unsubscribed' : 'Sent'}</td>
                </tr>
              ))}
              {sends.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-[var(--text3)]">
                    No blasts sent from this dashboard yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
