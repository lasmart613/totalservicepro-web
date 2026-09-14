'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { persistCustomerLogo } from '@/lib/customer-form';
import { LOGO_ACCEPT, validateLogoFile } from '@/lib/customer-logo';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type PreviewRow = {
  rowNumber: number;
  action: 'create' | 'update' | 'skip' | 'error';
  sku: string | null;
  title: string;
  price: number | null;
  qty: number | null;
  existingListingId: string | null;
  errorMessage: string | null;
};

type StorefrontState = {
  eligible: boolean;
  enabled: boolean;
  public: boolean;
  featured: boolean;
  plan: string;
  name: string;
  slug: string | null;
  bio: string;
  logo_url: string | null;
  href: string | null;
  upgrade: string;
  organizationId?: string | number | null;
};

export default function SupplierStorefrontSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [state, setState] = useState<StorefrontState | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [bio, setBio] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    filename: string;
    counts: { create: number; update: number; skip: number; error: number };
    rows: PreviewRow[];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const supabase = getSupabaseClient();

  const load = async () => {
    setLoading(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch('/api/marketplace/storefront', { cache: 'no-store', headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Could not load storefront settings');
        setState(null);
        return;
      }
      setState(json);
      setName(json.name || '');
      setSlug(json.slug || '');
      setBio(json.bio || '');
      setEnabled(!!json.enabled);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!state?.eligible) return;
    setSaving(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch('/api/marketplace/storefront', {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled, name, slug, bio }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Could not save storefront');
        return;
      }
      setState((prev) => (prev ? { ...prev, ...json } : json));
      setSlug(json.slug || slug);
      toast.success(json.enabled ? 'Storefront saved' : 'Storefront turned off');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (chosen: File) => {
    const orgId = state?.organizationId;
    if (!orgId) {
      toast.error('Save the storefront once, then upload a logo.');
      return;
    }
    const invalid = validateLogoFile(chosen);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setUploadingLogo(true);
    try {
      const url = await persistCustomerLogo(supabase, orgId, chosen);
      if (!url) throw new Error('Upload did not return a logo URL');
      setState((prev) => (prev ? { ...prev, logo_url: url } : prev));
      toast.success('Logo uploaded');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
    }
  };

  const downloadTemplate = async (format: 'csv' | 'xlsx') => {
    const headers = await marketplaceAuthHeaders();
    const res = await fetch(`/api/marketplace/uploads/template?format=${format}`, { headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error || 'Could not download template');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      format === 'xlsx' ? 'repairplanet-parts-catalog-template.xlsx' : 'repairplanet-parts-catalog-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runPreview = async () => {
    if (!file) {
      toast.error('Choose a .csv or .xlsx file first.');
      return;
    }
    setPreviewing(true);
    try {
      const headers = await marketplaceAuthHeaders();
      delete headers['Content-Type'];
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/marketplace/uploads', { method: 'POST', headers, body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Could not read that spreadsheet');
        return;
      }
      setPreview({ filename: json.filename, counts: json.counts, rows: json.rows || [] });
      toast.success('Preview ready — review the rows, then confirm.');
    } finally {
      setPreviewing(false);
    }
  };

  const commitUpload = async () => {
    if (!file || !preview) return;
    if (!confirm(`Publish ${preview.counts.create} new and ${preview.counts.update} updated listings?`)) return;
    setCommitting(true);
    try {
      const headers = await marketplaceAuthHeaders();
      delete headers['Content-Type'];
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/marketplace/uploads?commit=1', { method: 'POST', headers, body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Could not publish listings');
        return;
      }
      toast.success(
        `Published ${json.counts?.created || 0} new and ${json.counts?.updated || 0} updated listings.`
      );
      setPreview(null);
      setFile(null);
    } finally {
      setCommitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading storefront…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold">Supplier storefront</h1>
          <p className="text-[var(--text3)] mt-1">
            Optional public page for Premium and Team parts sellers. Soft beta — no paid ads.
          </p>
        </div>

        {!state?.eligible ? (
          <div className="card p-6">
            <p className="mb-4">
              Storefronts and bulk inventory upload are for Premium and Team parts suppliers. Free sellers stay on
              the marketplace without a public shop page.
            </p>
            <Link href="/plans?role=supplier" className="btn btn-primary">
              See supplier plans
            </Link>
          </div>
        ) : (
          <>
            <div className="card p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-bold text-lg">Public profile</h2>
                {state.featured && (
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[var(--gold)] text-black">
                    Featured seller
                  </span>
                )}
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 accent-[var(--gold)]"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span className="text-sm font-semibold leading-snug">
                  Enable my public storefront
                  <span className="block text-[11px] font-normal text-[var(--text3)] mt-0.5">
                    Off by default. When on, buyers can open /marketplace/sellers/{slug || 'your-slug'}.
                  </span>
                </span>
              </label>
              <div>
                <label className="label">Display name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">URL slug</label>
                <input
                  className="input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="luxor-photonix"
                />
              </div>
              <div>
                <label className="label">Short bio</label>
                <textarea
                  className="input min-h-[100px]"
                  value={bio}
                  maxLength={800}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="What you sell, brands you stock, turnaround…"
                />
              </div>
              <div>
                <label className="label">Logo</label>
                {state.logo_url && (
                  <img src={state.logo_url} alt="" className="mb-3 max-h-20 rounded border border-[var(--border)]" />
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept={LOGO_ACCEPT}
                  className="block w-full text-sm"
                  disabled={uploadingLogo}
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    if (chosen) void uploadLogo(chosen);
                  }}
                />
                <p className="text-xs text-[var(--text3)] mt-1">PNG, JPG, WebP, or SVG. Max 2 MB.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save storefront'}
                </button>
                {state.href && enabled && (
                  <Link href={state.href} className="btn btn-secondary">
                    View public page
                  </Link>
                )}
              </div>
            </div>

            <div className="card p-6 space-y-4">
              <h2 className="font-bold text-lg">Bulk inventory upload</h2>
              <p className="text-sm text-[var(--text3)]">
                Upload CSV or Excel. Rows with a matching SKU / part number update that listing; new SKUs create
                listings. Preview first, then confirm.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary text-sm" onClick={() => void downloadTemplate('csv')}>
                  Download template (CSV)
                </button>
                <button type="button" className="btn btn-secondary text-sm" onClick={() => void downloadTemplate('xlsx')}>
                  Download template (Excel)
                </button>
              </div>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="block w-full text-sm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setPreview(null);
                }}
              />
              <button type="button" className="btn btn-primary" disabled={previewing || !file} onClick={() => void runPreview()}>
                {previewing ? 'Reading…' : 'Preview rows'}
              </button>
              {preview && (
                <div className="space-y-3">
                  <p className="text-sm">
                    {preview.filename}: {preview.counts.create} new, {preview.counts.update} updates,{' '}
                    {preview.counts.skip} skipped, {preview.counts.error} errors.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[var(--text3)]">
                          <th className="py-1 pr-3">#</th>
                          <th className="py-1 pr-3">Action</th>
                          <th className="py-1 pr-3">SKU</th>
                          <th className="py-1 pr-3">Title</th>
                          <th className="py-1 pr-3">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 40).map((row) => (
                          <tr key={row.rowNumber} className="border-t border-[var(--border)]">
                            <td className="py-1 pr-3">{row.rowNumber}</td>
                            <td className="py-1 pr-3">{row.action}</td>
                            <td className="py-1 pr-3 font-mono">{row.sku || '—'}</td>
                            <td className="py-1 pr-3">{row.title}</td>
                            <td className="py-1 pr-3">{row.qty ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={committing || preview.counts.create + preview.counts.update === 0}
                    onClick={() => void commitUpload()}
                  >
                    {committing ? 'Publishing…' : 'Confirm and publish listings'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <p className="text-sm text-[var(--text3)]">
          <Link href="/marketplace/my-listings" className="text-[var(--gold)] hover:underline">
            My listings
          </Link>
          {' · '}
          <Link href="/marketplace/list?type=part" className="text-[var(--gold)] hover:underline">
            Add one listing
          </Link>
          {' · '}
          <Link href="/company" className="text-[var(--gold)] hover:underline">
            Supplier profile
          </Link>
        </p>
      </div>
    </div>
  );
}
