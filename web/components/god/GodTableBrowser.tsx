'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { godAuthHeader } from '@/lib/god-client';
import {
  deleteConfirmHint,
  GOD_TABLE_GROUP_LABEL,
  godTableHref,
  type GodTableGroup,
} from '@/lib/god-tables';

type CatalogTable = {
  key: string;
  table: string;
  label: string;
  group: GodTableGroup;
  description: string;
  featured?: boolean;
  featuredHref?: string | null;
  virtual?: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  deleteConfirm?: 'DELETE' | 'email' | 'id';
  listColumns?: string[];
  relatedKeys?: string[];
  writeNote?: string | null;
  readOnlyNote?: string | null;
};

type GodColumn = { name: string; readOnly: boolean; secret: boolean };

type ListPayload = {
  table?: CatalogTable;
  columns?: GodColumn[];
  rows?: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  pageSize?: number;
  writeNote?: string | null;
  readOnlyNote?: string | null;
  error?: string;
};

function formatCell(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function fieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }
  return String(value);
}

function emptyForm(columns: GodColumn[], listColumns: string[]): Record<string, string> {
  const names = columns.length ? columns.map((c) => c.name) : listColumns;
  const out: Record<string, string> = {};
  for (const name of names) {
    if (name === 'created_at' || name === 'updated_at') continue;
    out[name] = '';
  }
  return out;
}

export function GodTableBrowser({
  tableKey,
  related = [],
  title,
}: {
  tableKey: string;
  related?: string[];
  title?: string;
}) {
  const [catalog, setCatalog] = useState<CatalogTable[]>([]);
  const [meta, setMeta] = useState<CatalogTable | null>(null);
  const [columns, setColumns] = useState<GodColumn[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [writeNote, setWriteNote] = useState<string | null>(null);
  const [readOnlyNote, setReadOnlyNote] = useState<string | null>(null);

  const info = meta || catalog.find((t) => t.key === tableKey) || null;
  const relatedKeys = related.length ? related : info?.relatedKeys || [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await godAuthHeader();
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q.trim()) params.set('q', q.trim());
      const [listRes, catRes] = await Promise.all([
        fetch(`/api/god/tables/${encodeURIComponent(tableKey)}?${params}`, {
          headers,
          cache: 'no-store',
        }),
        catalog.length
          ? Promise.resolve(null)
          : fetch('/api/god/tables', { headers, cache: 'no-store' }),
      ]);
      const listJson = (await listRes.json().catch(() => ({}))) as ListPayload;
      if (catRes) {
        const catJson = await catRes.json().catch(() => ({}));
        setCatalog(catJson.tables || []);
      }
      if (!listRes.ok) {
        setError(listJson.error || 'Could not load table');
        setRows([]);
        setTotal(0);
        return;
      }
      setMeta((listJson.table as CatalogTable) || null);
      setColumns(listJson.columns || []);
      setRows(listJson.rows || []);
      setTotal(listJson.total || 0);
      setWriteNote(listJson.writeNote || null);
      setReadOnlyNote(listJson.readOnlyNote || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load table');
    } finally {
      setLoading(false);
    }
  }, [tableKey, page, pageSize, q, catalog.length]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleColumns = useMemo(() => {
    const preferred = info?.listColumns || [];
    if (!columns.length) {
      return preferred.slice(0, 8).map((name) => ({ name, readOnly: false, secret: false }));
    }
    const featuredNames = new Set(preferred.length ? preferred : columns.slice(0, 8).map((c) => c.name));
    const ordered = [
      ...columns.filter((c) => featuredNames.has(c.name)),
      ...columns.filter((c) => !featuredNames.has(c.name)),
    ];
    return ordered.slice(0, 8);
  }, [columns, info]);

  function openEdit(row: Record<string, unknown>) {
    const next: Record<string, string> = {};
    const names = columns.length ? columns.map((c) => c.name) : Object.keys(row);
    for (const name of names) next[name] = fieldValue(row[name]);
    setForm(next);
    setEditingId(row.id as string | number);
    setCreating(false);
    setConfirming(false);
    setConfirmText('');
  }

  function openCreate(prefill?: Record<string, unknown>) {
    const base = emptyForm(columns, info ? ['id'] : []);
    if (prefill) {
      for (const [k, v] of Object.entries(prefill)) {
        if (k === 'id' || k === 'created_at' || k === 'updated_at') continue;
        base[k] = fieldValue(v);
      }
    }
    if (info?.virtual) {
      base.email = base.email || '';
      base.phone = base.phone || '';
      base.password = '';
      base.email_confirm = 'true';
      base.ban_duration = '';
      base.first_name = base.first_name || '';
      base.last_name = base.last_name || '';
    }
    setForm(base);
    setEditingId(null);
    setCreating(true);
    setConfirming(false);
    setConfirmText('');
  }

  function cancelForm() {
    setCreating(false);
    setEditingId(null);
    setForm({});
    setConfirming(false);
    setConfirmText('');
  }

  async function save() {
    setSaving(true);
    try {
      const headers = await godAuthHeader();
      const path = editingId != null
        ? `/api/god/tables/${encodeURIComponent(tableKey)}/${encodeURIComponent(String(editingId))}`
        : `/api/god/tables/${encodeURIComponent(tableKey)}`;
      const res = await fetch(path, {
        method: editingId != null ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify({ row: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Save failed');
        return;
      }
      toast.success(editingId != null ? 'Row updated' : 'Row created');
      cancelForm();
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (editingId == null) return;
    setSaving(true);
    try {
      const headers = await godAuthHeader();
      const res = await fetch(
        `/api/god/tables/${encodeURIComponent(tableKey)}/${encodeURIComponent(String(editingId))}`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ confirm: true, confirmText }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || json.hint || 'Delete failed');
        return;
      }
      toast.success('Row deleted');
      cancelForm();
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const formOpen = creating || editingId != null;
  const heading = title || info?.label || tableKey;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h1 className="text-3xl font-extrabold">{heading}</h1>
          <p className="text-[var(--text3)] mt-1 max-w-3xl">
            {info?.description || 'God-only table browser.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {info?.canCreate && (
            <button type="button" className="btn btn-primary text-sm" onClick={() => openCreate()}>
              New row
            </button>
          )}
        </div>
      </div>

      {relatedKeys.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {relatedKeys.map((key) => (
            <Link key={key} href={godTableHref(key)} className="btn btn-secondary text-xs">
              {catalog.find((t) => t.key === key)?.label || key}
            </Link>
          ))}
        </div>
      )}

      {(writeNote || readOnlyNote || info?.virtual) && (
        <div className="card p-4 mb-4 text-sm text-[var(--text2)] space-y-1">
          {info?.virtual && (
            <p>
              <strong>Auth:</strong> password hashes, recovery tokens, and MFA secrets are never
              loaded. Identities are read-only. Ban uses <code>ban_duration</code> (
              <code>none</code> to unban, e.g. <code>876000h</code> to ban).
            </p>
          )}
          {writeNote && <p>{writeNote}</p>}
          {readOnlyNote && <p>{readOnlyNote}</p>}
          {!info?.canUpdate && !info?.canCreate && (
            <p>This table is read-only in God Dashboard.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search"
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1);
              setQ(qDraft);
            }
          }}
          placeholder="Search"
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[220px]"
        />
        <button
          type="button"
          className="btn btn-secondary text-sm"
          onClick={() => {
            setPage(1);
            setQ(qDraft);
          }}
        >
          Search
        </button>
        <span className="text-sm text-[var(--text3)] self-center">
          {total} row{total === 1 ? '' : 's'}
          {info?.group ? ` · ${GOD_TABLE_GROUP_LABEL[info.group]}` : ''}
        </span>
      </div>

      {loading && <div className="text-[var(--text3)] mb-4">Loading…</div>}
      {error && (
        <div className="card p-4 mb-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto card mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              {visibleColumns.map((col) => (
                <th key={col.name} className="p-3 whitespace-nowrap">
                  {col.name}
                </th>
              ))}
              <th className="p-3"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)} className="border-b border-[var(--border)] hover:bg-[var(--surface3)]">
                {visibleColumns.map((col) => (
                  <td key={col.name} className="p-3 max-w-[220px] truncate" title={formatCell(row[col.name])}>
                    {formatCell(row[col.name])}
                  </td>
                ))}
                <td className="p-3 whitespace-nowrap">
                  <button
                    type="button"
                    className="text-[var(--gold)] bg-transparent border-0 p-0 cursor-pointer"
                    onClick={() => openEdit(row)}
                  >
                    {info?.canUpdate ? 'Edit' : 'Open'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="p-6 text-center text-[var(--text3)]">
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex gap-2 mb-8">
          <button
            type="button"
            className="btn btn-secondary text-xs"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text3)] self-center">
            Page {page} / {pages}
          </span>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      {formOpen && (
        <section className="card p-5 mb-10">
          <div className="flex flex-wrap justify-between gap-2 mb-3">
            <h2 className="text-xl font-bold">
              {creating ? 'New row' : `Edit ${editingId}`}
            </h2>
            <div className="flex gap-2">
              {editingId != null && info?.canCreate && (
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => {
                    const row = rows.find((r) => String(r.id) === String(editingId));
                    openCreate(row || form);
                  }}
                >
                  Prefill new from this
                </button>
              )}
              <button type="button" className="btn btn-secondary text-xs" onClick={cancelForm}>
                Close
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.keys(form).map((name) => {
              const col = columns.find((c) => c.name === name);
              const readOnly =
                name === 'id'
                  ? !(creating && info?.key === 'user_profiles')
                  : name === 'password' || name === 'ban_duration' || name === 'email_confirm'
                    ? false
                    : Boolean(col?.readOnly);
              const long = form[name].length > 80 || form[name].includes('\n');
              return (
                <label key={name} className={long ? 'md:col-span-2 block text-sm' : 'block text-sm'}>
                  <span className="text-[var(--text3)]">
                    {name}
                    {readOnly ? ' · read-only' : ''}
                  </span>
                  {long ? (
                    <textarea
                      className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-[88px] font-mono text-xs"
                      value={form[name]}
                      readOnly={readOnly}
                      onChange={(e) => setForm((prev) => ({ ...prev, [name]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
                      value={form[name]}
                      readOnly={readOnly}
                      onChange={(e) => setForm((prev) => ({ ...prev, [name]: e.target.value }))}
                    />
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {(creating ? info?.canCreate : info?.canUpdate) && (
              <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            {editingId != null && info?.canDelete && !confirming && (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
                Delete…
              </button>
            )}
          </div>
          {confirming && editingId != null && (
            <div className="mt-4 p-4 rounded-lg border border-red-500/40 bg-red-500/10">
              <p className="text-sm mb-2">
                {deleteConfirmHint(
                  {
                    deleteConfirm: info?.deleteConfirm || 'DELETE',
                    pk: 'id',
                  } as Parameters<typeof deleteConfirmHint>[0],
                  { id: editingId, email: form.email }
                )}
              </p>
              <input
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 mb-3"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Confirmation"
              />
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={destroy}>
                  {saving ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
