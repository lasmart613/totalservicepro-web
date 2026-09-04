'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { godAuthHeader } from '@/lib/god-client';
import { GOD_TABLE_GROUP_LABEL, godTableHref, type GodTableGroup } from '@/lib/god-tables';

type CatalogTable = {
  key: string;
  label: string;
  group: GodTableGroup;
  description: string;
  featured?: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  virtual?: boolean;
};

type Omitted = { name: string; reason: string };

export default function GodTablesIndexPage() {
  const [tables, setTables] = useState<CatalogTable[]>([]);
  const [omitted, setOmitted] = useState<Omitted[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await godAuthHeader();
        const res = await fetch('/api/god/tables', { headers, cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setError(json.error || 'Could not load tables');
          return;
        }
        if (!cancelled) {
          setTables(json.tables || []);
          setOmitted(json.omitted || []);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load tables');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const visible = tables.filter((t) => {
      if (!query) return true;
      return `${t.label} ${t.key} ${t.description}`.toLowerCase().includes(query);
    });
    const order = Object.keys(GOD_TABLE_GROUP_LABEL) as GodTableGroup[];
    return order
      .map((group) => ({
        group,
        label: GOD_TABLE_GROUP_LABEL[group],
        tables: visible.filter((t) => t.group === group),
      }))
      .filter((g) => g.tables.length);
  }, [tables, q]);

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-2">God Tables</h1>
      <p className="text-[var(--text3)] mb-4 max-w-3xl">
        Browse and edit the live Supabase business tables. Equipment, Users, and Auth / Users
        are also pinned in the God nav. Password hashes, recovery tokens, vault secrets, and
        storage internals are omitted.
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter tables"
        className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[220px] mb-6"
      />
      {error && <div className="card p-4 mb-4 text-sm text-red-300">{error}</div>}
      {groups.map((group) => (
        <section key={group.group} className="mb-8">
          <h2 className="text-xl font-bold mb-3">{group.label}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {group.tables.map((table) => (
              <Link
                key={table.key}
                href={godTableHref(table.key)}
                className="card p-4 hover:border-[var(--gold)]"
              >
                <div className="font-semibold group-hover:text-[var(--gold)]">
                  {table.label}
                  {table.featured ? (
                    <span className="ml-2 text-xs text-[var(--gold)]">Pinned</span>
                  ) : null}
                </div>
                <p className="text-sm text-[var(--text3)] mt-1">{table.description}</p>
                <p className="text-xs text-[var(--text3)] mt-2">
                  {table.canUpdate ? 'View + edit' : 'Read-only'}
                  {table.canCreate ? ' · create' : ''}
                  {table.canDelete ? ' · delete' : ''}
                  {table.virtual ? ' · Auth Admin API' : ''}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {omitted.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-2">Omitted on purpose</h2>
          <ul className="text-sm text-[var(--text3)] space-y-1">
            {omitted.map((row) => (
              <li key={row.name}>
                <strong className="text-[var(--text2)]">{row.name}:</strong> {row.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
