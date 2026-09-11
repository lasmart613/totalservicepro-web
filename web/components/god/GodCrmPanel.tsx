'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchGodMe, godAuthHeader } from '@/lib/god-client';
import {
  CRM_TABS,
  filterCrmAccounts,
  filterCrmContacts,
  filterCrmPipeline,
  filterCrmWork,
  formatCrmDate,
  formatMoney,
  parseCrmTab,
  type CrmTab,
  type GodCrmPayload,
} from '@/lib/god-crm';
import { GOD_TABLES_PATH, godTableHref } from '@/lib/god-tables';

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

const PIPELINE_SOURCES = [
  { value: 'all', label: 'All sources' },
  { value: 'clinic_lead', label: 'Clinic find-a-rep' },
  { value: 'service_request', label: 'Service requests' },
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'marketplace_request', label: 'Marketplace requests' },
];

const PIPELINE_STAGES = [
  { value: 'all', label: 'All stages' },
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'closed', label: 'Closed' },
];

const WORK_KINDS = [
  { value: 'all', label: 'All work' },
  { value: 'ticket', label: 'Tickets' },
  { value: 'estimate', label: 'Estimates' },
  { value: 'invoice', label: 'Invoices' },
];

const WORK_STAGES = [
  { value: 'all', label: 'All stages' },
  { value: 'active', label: 'Active tickets' },
  { value: 'open', label: 'Open estimates' },
  { value: 'unpaid', label: 'Unpaid invoices' },
  { value: 'won', label: 'Won / paid' },
  { value: 'lost', label: 'Lost / expired' },
  { value: 'closed', label: 'Closed tickets' },
];

const TAB_LABEL: Record<CrmTab, string> = {
  pipeline: 'Pipeline',
  accounts: 'Accounts',
  contacts: 'Contacts',
  work: 'Work',
};

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function SummaryCard({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: number | null | undefined;
  onClick?: () => void;
  active?: boolean;
}) {
  const className =
    'card p-4 min-w-0 text-left ' +
    (onClick ? 'hover:border-[var(--gold)] cursor-pointer ' : '') +
    (active ? 'border-[var(--gold)] ' : '');
  const inner = (
    <>
      <div className="text-xs uppercase tracking-wide text-[var(--text3)] mb-1">{label}</div>
      <div className="text-2xl font-extrabold text-[var(--gold)]">{formatCount(value)}</div>
    </>
  );
  if (!onClick) return <div className={className}>{inner}</div>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  );
}

export function GodCrmPanel() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [data, setData] = useState<GodCrmPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CrmTab>('pipeline');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [stage, setStage] = useState('all');
  const [type, setType] = useState('all');
  const [plan, setPlan] = useState('all');
  const [kind, setKind] = useState('all');

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
        const res = await fetch('/api/god/crm', { headers, cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not load CRM');
          setData(null);
        } else {
          setData(json as GodCrmPayload);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load CRM');
          setData(null);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pipeline = useMemo(
    () => filterCrmPipeline(data?.pipeline || [], { q, source, stage }),
    [data, q, source, stage]
  );
  const accounts = useMemo(
    () => filterCrmAccounts(data?.accounts || [], { q, type, plan }),
    [data, q, type, plan]
  );
  const contacts = useMemo(() => filterCrmContacts(data?.contacts || [], { q }), [data, q]);
  const work = useMemo(
    () => filterCrmWork(data?.work || [], { q, kind, stage }),
    [data, q, kind, stage]
  );

  if (!ready) {
    return <div className="text-[var(--text3)]">Loading CRM…</div>;
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

  const summary = data?.summary;

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">CRM</h1>
      <p className="text-[var(--text3)] mb-4 max-w-3xl">
        Relationships and inbound pipeline across RepairPlanet / TSP. This composes live tables —
        organizations, contacts, shop↔clinic links, find-a-rep requests, waitlist, tickets,
        estimates, and invoices. There is no separate deals table yet.{' '}
        <Link href={GOD_TABLES_PATH} className="text-[var(--gold)] hover:underline">
          Open a raw table
        </Link>{' '}
        to edit a row.
      </p>

      {error ? <p className="text-sm text-red-400 mb-3">{error}</p> : null}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <SummaryCard
          label="Accounts"
          value={summary?.organizations}
          active={tab === 'accounts'}
          onClick={() => setTab('accounts')}
        />
        <SummaryCard
          label="Contacts"
          value={summary?.contacts}
          active={tab === 'contacts'}
          onClick={() => setTab('contacts')}
        />
        <SummaryCard
          label="Open requests"
          value={summary?.openRequests}
          active={tab === 'pipeline'}
          onClick={() => {
            setTab('pipeline');
            setSource('service_request');
            setStage('open');
          }}
        />
        <SummaryCard
          label="Open tickets"
          value={summary?.openTickets}
          active={tab === 'work' && kind === 'ticket'}
          onClick={() => {
            setTab('work');
            setKind('ticket');
            setStage('active');
          }}
        />
        <SummaryCard
          label="Open estimates"
          value={summary?.openEstimates}
          active={tab === 'work' && kind === 'estimate'}
          onClick={() => {
            setTab('work');
            setKind('estimate');
            setStage('open');
          }}
        />
        <SummaryCard
          label="Unpaid invoices"
          value={summary?.unpaidInvoices}
          active={tab === 'work' && kind === 'invoice'}
          onClick={() => {
            setTab('work');
            setKind('invoice');
            setStage('unpaid');
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-[var(--text3)]">Shop ↔ clinic links: </span>
          <span className="font-semibold text-[var(--gold)]">{formatCount(summary?.shopClinicLinks)}</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-[var(--text3)]">Needs scheduling: </span>
          <span className="font-semibold text-[var(--gold)]">{formatCount(summary?.needsScheduling)}</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-[var(--text3)]">Waitlist: </span>
          <span className="font-semibold text-[var(--gold)]">{formatCount(summary?.waitlist)}</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-[var(--text3)]">Clinic leads: </span>
          <span className="font-semibold text-[var(--gold)]">{formatCount(summary?.clinicLeads)}</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-[var(--text3)]">Active listings: </span>
          <span className="font-semibold text-[var(--gold)]">{formatCount(summary?.activeListings)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="CRM sections">
        {CRM_TABS.map((item) => {
          const active = item === tab;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={active}
              className={'btn text-xs ' + (active ? 'btn-primary' : 'btn-secondary')}
              onClick={() => {
                setTab(parseCrmTab(item));
                setQ('');
                setSource('all');
                setStage('all');
                setType('all');
                setPlan('all');
                setKind('all');
              }}
            >
              {TAB_LABEL[item]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            tab === 'accounts'
              ? 'Search org, email, city'
              : tab === 'contacts'
                ? 'Search name, email, org'
                : tab === 'work'
                  ? 'Search customer, number, shop'
                  : 'Search request, clinic, email'
          }
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[220px]"
        />
        {tab === 'pipeline' ? (
          <>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
            >
              {PIPELINE_SOURCES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
            >
              {PIPELINE_STAGES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {tab === 'accounts' ? (
          <>
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
          </>
        ) : null}
        {tab === 'work' ? (
          <>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
            >
              {WORK_KINDS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
            >
              {WORK_STAGES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {tab === 'pipeline' ? (
        <CrmTable
          caption={`${pipeline.length} pipeline row${pipeline.length === 1 ? '' : 's'}`}
          empty="No inbound leads or requests match these filters."
          columns={['Source', 'Title / company', 'Contact', 'Location', 'Stage', 'Created']}
          rows={pipeline.map((row) => [
            row.sourceLabel,
            <span key={`${row.id}-title`}>
              <Link href={row.href} className="font-semibold hover:text-[var(--gold)]">
                {row.title}
              </Link>
              {row.company && row.company !== row.title ? (
                <div className="text-xs text-[var(--text3)]">{row.company}</div>
              ) : null}
            </span>,
            <span key={`${row.id}-contact`}>
              {row.contact || '—'}
              {row.email ? <div className="text-xs text-[var(--text3)]">{row.email}</div> : null}
            </span>,
            row.location || '—',
            row.status || row.stage,
            formatCrmDate(row.createdAt),
          ])}
        />
      ) : null}

      {tab === 'accounts' ? (
        <CrmTable
          caption={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
          empty="No organizations match these filters."
          columns={['Organization', 'Type', 'Plan', 'Location', 'Contacts', 'Shop / clinic links', 'Created']}
          rows={accounts.map((row) => [
            <span key={`${row.id}-name`}>
              <Link href={row.href} className="font-semibold hover:text-[var(--gold)]">
                {row.name}
              </Link>
              <div className="text-xs text-[var(--text3)]">{row.email || row.phone || '—'}</div>
            </span>,
            row.typeLabel,
            row.planLabel,
            [row.city, row.state].filter(Boolean).join(', ') || '—',
            row.contactCount,
            row.customerCount || row.shopCount
              ? `${row.customerCount} customers · ${row.shopCount} shops`
              : '—',
            formatCrmDate(row.createdAt),
          ])}
        />
      ) : null}

      {tab === 'contacts' ? (
        <CrmTable
          caption={`${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
          empty="No contacts match this search."
          columns={['Name', 'Organization', 'Email', 'Phone', 'Title']}
          rows={contacts.map((row) => [
            <span key={`${row.id}-name`}>
              <Link href={row.href} className="font-semibold hover:text-[var(--gold)]">
                {row.name}
              </Link>
              {row.isPrimary ? <div className="text-xs text-[var(--gold)]">Primary</div> : null}
            </span>,
            row.orgName || '—',
            row.email || '—',
            row.phone || '—',
            row.title || '—',
          ])}
        />
      ) : null}

      {tab === 'work' ? (
        <CrmTable
          caption={`${work.length} work row${work.length === 1 ? '' : 's'}`}
          empty="No tickets, estimates, or invoices match these filters."
          columns={['Kind', 'Record', 'Customer', 'Shop', 'Status', 'Amount', 'Created']}
          rows={work.map((row) => [
            row.kindLabel,
            <Link key={`${row.id}-title`} href={row.href} className="font-semibold hover:text-[var(--gold)]">
              {row.title}
            </Link>,
            row.customer || '—',
            row.orgName || '—',
            row.status || row.stage,
            formatMoney(row.amount),
            formatCrmDate(row.createdAt),
          ])}
        />
      ) : null}

      {data?.notes?.length ? (
        <section className="mt-8">
          <h2 className="text-xl font-bold mb-2">Notes</h2>
          <ul className="text-sm text-[var(--text3)] space-y-1 max-w-3xl">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            <li>
              Drill-down uses the God table browser:{' '}
              <Link href={godTableHref('organizations')} className="text-[var(--gold)] hover:underline">
                organizations
              </Link>
              ,{' '}
              <Link href={godTableHref('contacts')} className="text-[var(--gold)] hover:underline">
                contacts
              </Link>
              ,{' '}
              <Link href={godTableHref('service_requests')} className="text-[var(--gold)] hover:underline">
                service_requests
              </Link>
              ,{' '}
              <Link href={godTableHref('service_tickets')} className="text-[var(--gold)] hover:underline">
                tickets
              </Link>
              .
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CrmTable({
  caption,
  empty,
  columns,
  rows,
}: {
  caption: string;
  empty: string;
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div>
      <p className="text-sm text-[var(--text3)] mb-3">{caption}</p>
      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              {columns.map((col) => (
                <th key={col} className="p-3">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface3)]">
                {row.map((cell, j) => (
                  <td key={j} className="p-3 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-6 text-center text-[var(--text3)]">
                  {empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
