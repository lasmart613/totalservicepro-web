'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { fetchGodMe, godAuthHeader } from '@/lib/god-client';
import { orgTypeLabel } from '@/lib/labels';
import type { GodOrgRow } from '@/lib/god-orgs';

type SendLog = {
  id: string;
  created_at: string;
  organization_id: number | string | null;
  organization_name: string | null;
  recipient_email: string;
  subject: string;
  unsubscribed_at?: string | null;
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

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function GodDashboardPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [orgs, setOrgs] = useState<GodOrgRow[]>([]);
  const [sends, setSends] = useState<SendLog[]>([]);
  const [html, setHtml] = useState('');
  const [subject, setSubject] = useState('Find Laser Repair Jobs in Your Area');
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
      const god = await fetchGodMe();
      if (cancelled) return;
      if (!god) {
        setAllowed(false);
        setReady(true);
        return;
      }
      setAllowed(true);
      try {
        const headers = await godAuthHeader();
        const [orgRes, previewRes, logRes] = await Promise.all([
          fetch('/api/god/orgs', { headers, cache: 'no-store' }),
          fetch('/api/god/invite/preview', { headers, cache: 'no-store' }),
          fetch('/api/god/invite/log', { headers, cache: 'no-store' }),
        ]);
        const orgJson = await orgRes.json().catch(() => ({}));
        const previewJson = await previewRes.json().catch(() => ({}));
        const logJson = await logRes.json().catch(() => ({}));
        if (!cancelled) {
          setOrgs(orgJson.orgs || []);
          setHtml(previewJson.html || '');
          setSubject(previewJson.subject || subject);
          setSends(logJson.sends || []);
        }
      } catch (e) {
        console.error('god dashboard load', e);
        toast.error('Could not load God dashboard data');
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return orgs.filter((org) => {
      if (type !== 'all' && String(org.type).toLowerCase() !== type) return false;
      if (plan !== 'all' && org.planKey !== plan) return false;
      if (!query) return true;
      const hay = [
        org.name,
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

  async function sendSelected() {
    if (!selectedRows.length) {
      toast.error('Select one or more organizations first.');
      return;
    }
    setSending(true);
    try {
      const headers = await godAuthHeader();
      const res = await fetch('/api/god/invite/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          confirm: true,
          organization_ids: selectedRows.map((o) => o.id),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Send failed');
        return;
      }
      toast.success(`Sent ${json.sentCount || 0} invite${json.sentCount === 1 ? '' : 's'}.`);
      if (json.skipped) toast.message(`${json.skipped} skipped (no email or provider error).`);
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

  if (!ready) {
    return <div className="text-[var(--text3)]">Loading God dashboard…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto w-full py-16 text-center">
        <h1 className="text-3xl font-extrabold">404</h1>
        <p className="text-[var(--text3)] mt-2 mb-6">This page could not be found.</p>
        <Link href="/" className="btn btn-primary">
          Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">God Dashboard</h1>
      <p className="text-[var(--text3)] mb-4 max-w-3xl">
        Every organization and user. Send the locked shop-tester invite only to the shops you
        check. Nothing is selected by default. This is not a Stripe plan.
      </p>
      <p className="text-sm text-[var(--text3)] mb-6 max-w-3xl">
        Need a row that is not an org invite? Use{' '}
        <Link href="/admin/god/tables" className="text-[var(--gold)] hover:underline">
          Tables
        </Link>
        ,{' '}
        <Link href="/admin/god/equipment" className="text-[var(--gold)] hover:underline">
          Equipment
        </Link>
        ,{' '}
        <Link href="/admin/god/users" className="text-[var(--gold)] hover:underline">
          Users
        </Link>
        , or{' '}
        <Link href="/admin/god/auth" className="text-[var(--gold)] hover:underline">
          Auth / Users
        </Link>
        . Catalog spreadsheets land in{' '}
        <Link href="/admin/god/tables/marketplace_upload_batches" className="text-[var(--gold)] hover:underline">
          Catalog upload batches
        </Link>
        {' '}— mark rows listed via <code>PATCH /api/god/marketplace-uploads/:id</code>.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
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
        <button type="button" className="btn btn-secondary text-xs" onClick={() => setSelected(new Set())}>
          Clear selection
        </button>
        <span className="text-[var(--text3)]">
          {visible.length} shown · {selected.size} selected · {orgs.length} total
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
              <th className="p-3">Seats</th>
              <th className="p-3">Admin email</th>
              <th className="p-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((org) => {
              const key = String(org.id);
              const open = expanded === key;
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
                    <td className="p-3">{org.seats}</td>
                    <td className="p-3">{org.adminEmail || '—'}</td>
                    <td className="p-3 whitespace-nowrap">{formatDate(org.createdAt)}</td>
                  </tr>
                  {open && (
                    <tr className="bg-[var(--surface)]">
                      <td></td>
                      <td colSpan={6} className="p-3 text-[var(--text2)]">
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
                <td colSpan={7} className="p-6 text-center text-[var(--text3)]">
                  No organizations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mb-8">
        <h2 className="text-2xl font-bold mb-2">Shop invite preview</h2>
        <p className="text-[var(--text3)] mb-3">
          Locked HTML. Subject: <span className="text-[var(--gold)]">{subject}</span>
        </p>
        <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-[#0b0f14]">
          <iframe
            title="Shop invite preview"
            srcDoc={html}
            className="w-full min-h-[640px] border-0 bg-[#0b0f14]"
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3 mb-10">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selectedRows.length}
          onClick={() => setConfirming(true)}
        >
          Send to {selectedRows.length} selected
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="card max-w-lg w-full p-6">
            <h3 className="text-xl font-bold mb-2">Send shop invite?</h3>
            <p className="text-sm text-[var(--text3)] mb-4">
              This emails the locked template to the admin address of each selected organization.
              Nothing else is written on those orgs. Tony Martin / first-wave shops are not
              included unless you checked them.
            </p>
            <ul className="text-sm mb-5 max-h-40 overflow-y-auto space-y-1">
              {selectedRows.map((org) => (
                <li key={String(org.id)}>
                  <strong>{org.name}</strong> → {org.adminEmail || 'no email'}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={sending}
                onClick={sendSelected}
              >
                {sending ? 'Sending…' : 'Confirm send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-2xl font-bold mb-2">Send log</h2>
        <p className="text-[var(--text3)] mb-3">Who already got this invite. Manual sends only.</p>
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
                <th className="p-3">When</th>
                <th className="p-3">Organization</th>
                <th className="p-3">Recipient</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]">
                  <td className="p-3 whitespace-nowrap">{formatDate(row.created_at)}</td>
                  <td className="p-3">{row.organization_name || row.organization_id}</td>
                  <td className="p-3">{row.recipient_email}</td>
                  <td className="p-3">{row.unsubscribed_at ? 'Unsubscribed' : 'Sent'}</td>
                </tr>
              ))}
              {sends.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-[var(--text3)]">
                    No invites sent from this dashboard yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
