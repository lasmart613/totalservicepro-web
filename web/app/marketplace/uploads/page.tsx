'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { canBulkUploadCatalog } from '@/lib/roles';
import { defaultCatalogKind, buildCatalogTemplateCsv, type CatalogKind } from '@/lib/marketplace/catalog-upload-core';
import { toast } from 'sonner';

export const dynamic = 'force-dynamic';

type BatchRow = {
  id: string;
  original_filename: string;
  catalog_kind: string;
  status: string;
  row_count: number;
  listed_count: number;
  error_count: number;
  email_sent: boolean;
  created_at: string;
};

function statusLabel(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'listed') return 'Listed';
  if (s === 'error') return 'Error';
  if (s === 'processing') return 'Processing';
  if (s === 'partial') return 'Partial';
  return 'Pending';
}

export default function MarketplaceUploadsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [kind, setKind] = useState<CatalogKind>('part');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [orgName, setOrgName] = useState('');

  const authHeader = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not signed in');
    return { Authorization: `Bearer ${token}` };
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setAllowed(false);
      setDenyReason('Sign in to upload a catalog.');
      return;
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, organization_id, organizations(name, type)')
      .eq('id', user.id)
      .maybeSingle();
    const org = (profile as { organizations?: { name?: string | null; type?: string | null } | null })?.organizations;
    const role = profile?.role || '';
    const orgType = org?.type || null;
    if (!canBulkUploadCatalog(role, orgType)) {
      setAllowed(false);
      setDenyReason(
        'Bulk catalog upload is for Parts Suppliers and laser marketplace sellers (reseller, clinic, or rental) with owner or supplier permission.'
      );
      return;
    }
    setAllowed(true);
    setOrgName(org?.name || '');
    setKind(defaultCatalogKind(orgType));

    try {
      const headers = await authHeader();
      const res = await fetch('/api/marketplace/uploads', { headers, cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Could not load uploads');
        return;
      }
      setBatches(json.batches || []);
      if (json.catalogKind) setKind(json.catalogKind);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load uploads');
    }
  }, [authHeader]);

  useEffect(() => {
    load();
  }, [load]);

  function downloadTemplate() {
    const csv = buildCatalogTemplateCsv(kind);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'used' ? 'tsp-laser-catalog-template.csv' : 'tsp-parts-catalog-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error('Choose a .csv or .xlsx file.');
      return;
    }
    setBusy(true);
    try {
      const headers = await authHeader();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('catalog_kind', kind);
      const res = await fetch('/api/marketplace/uploads', { method: 'POST', headers, body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Upload failed');
        return;
      }
      toast.success(
        `Staged ${json.rowCount} row${json.rowCount === 1 ? '' : 's'}. A listing agent will turn them into Marketplace listings for your organization.`
      );
      if (json.emailWarning) toast.message(json.emailWarning);
      if (json.errorRowCount) {
        toast.message(`${json.errorRowCount} row${json.errorRowCount === 1 ? '' : 's'} need a title or SKU.`);
      }
      setFile(null);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading…</div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
          <h1 className="text-3xl font-extrabold mb-3">Bulk catalog upload</h1>
          <p className="text-[var(--text3)] mb-6">{denyReason}</p>
          <Link href="/marketplace" className="btn btn-primary">
            Marketplace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">Bulk catalog upload</h1>
            <p className="text-[var(--text3)] mt-1">
              Upload a CSV or Excel file of parts or lasers
              {orgName ? ` for ${orgName}` : ''}. We store the file, stage every row, and notify a listing agent.
              Listings are created under your organization — this is not a QA sandbox.
            </p>
          </div>
          <Link href="/marketplace/my-listings" className="btn btn-secondary whitespace-nowrap">
            My listings
          </Link>
        </div>

        <div className="card p-6 mb-8">
          <h2 className="font-bold text-lg mb-2">1. Download a template</h2>
          <p className="text-sm text-[var(--text3)] mb-4">
            Columns: SKU, title, brand, model, condition, price, qty, description, category (part / consumable / laser),
            photos (optional image URLs). Extra columns are kept but ignored. Headers are matched flexibly
            (Part Number, Manufacturer, Qty, …).
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-sm">
              Default type{' '}
              <select
                className="input ml-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as CatalogKind)}
              >
                <option value="part">Parts</option>
                <option value="consumable">Consumables</option>
                <option value="used">Lasers / used systems</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={downloadTemplate}>
              Download template
            </button>
          </div>
        </div>

        <form className="card p-6 mb-8" onSubmit={onSubmit}>
          <h2 className="font-bold text-lg mb-2">2. Upload .csv or .xlsx</h2>
          <p className="text-sm text-[var(--text3)] mb-4">
            Max 10 MB and 2,000 rows. Clear errors if the type or size is wrong — nothing is posted live until an
            agent lists the row.
          </p>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm mb-4"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          {file && (
            <p className="text-sm text-[var(--text3)] mb-3">
              Selected: {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !file}>
            {busy ? 'Uploading…' : 'Upload catalog'}
          </button>
        </form>

        <div>
          <h2 className="font-bold text-lg mb-3">Your uploads</h2>
          {batches.length === 0 ? (
            <p className="text-sm text-[var(--text3)]">No catalog files uploaded yet.</p>
          ) : (
            <div className="space-y-3">
              {batches.map((b) => (
                <div key={b.id} className="card p-4">
                  <div className="flex justify-between gap-3 items-start">
                    <div>
                      <div className="font-semibold">{b.original_filename}</div>
                      <div className="text-xs text-[var(--text3)] mt-1">
                        {new Date(b.created_at).toLocaleString()} · {b.row_count} rows · {b.catalog_kind}
                        {b.listed_count ? ` · ${b.listed_count} listed` : ''}
                        {b.error_count ? ` · ${b.error_count} errors` : ''}
                      </div>
                    </div>
                    <span className="text-xs uppercase tracking-widest text-[var(--gold)]">
                      {statusLabel(b.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
