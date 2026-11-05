'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/Header';
import { useT } from '@/lib/fa/locale';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { rankPartsForDevice, type PartPick } from '@/lib/parts-inventory/bom';

type InventoryRow = {
  id: number | string;
  mpn_normalized?: string | null;
  internal_part_number?: string | null;
  preferred_vendor_name?: string | null;
  vendor_part_number?: string | null;
  unit_cost?: number | string | null;
  sell_price?: number | string | null;
  avg_lead_time_days?: number | null;
  expected_lead_time_days?: number | null;
  quantity_on_hand?: number | null;
  description_override?: string | null;
  parts_catalog?: { part_number?: string | null; name?: string | null; description?: string | null; brand?: string | null } | null;
};

function money(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InventoryPage() {
  const t = useT();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [hideZero, setHideZero] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [make, setMake] = useState('Candela');
  const [model, setModel] = useState('Mini GentleYAG');
  const [bomHits, setBomHits] = useState<PartPick[]>([]);
  const [mpn, setMpn] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [vendor, setVendor] = useState('');
  const [vendorPn, setVendorPn] = useState('');
  const [cost, setCost] = useState('');
  const [sell, setSell] = useState('');
  const [avgLead, setAvgLead] = useState('');
  const [expectedLead, setExpectedLead] = useState('');
  const [qty, setQty] = useState('0');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch(`/api/inventory?hideZero=${hideZero ? '1' : '0'}`, { headers });
      const json = (await res.json()) as { rows?: InventoryRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'load');
      setRows(json.rows || []);
    } catch {
      setError('load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [hideZero]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadBom = useCallback(async () => {
    if (!make && !model) {
      setBomHits([]);
      return;
    }
    const headers = await marketplaceAuthHeaders();
    const qs = new URLSearchParams({ manufacturer: make, model, q });
    const res = await fetch(`/api/inventory/bom?${qs}`, { headers });
    if (!res.ok) {
      setBomHits([]);
      return;
    }
    const json = (await res.json()) as { hits?: PartPick[] };
    setBomHits(rankPartsForDevice(json.hits || [], [], q));
  }, [make, model, q]);

  useEffect(() => {
    void loadBom();
  }, [loadBom]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [
        row.mpn_normalized,
        row.internal_part_number,
        row.preferred_vendor_name,
        row.vendor_part_number,
        row.description_override,
        row.parts_catalog?.part_number,
        row.parts_catalog?.name,
        row.parts_catalog?.brand,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [rows, q]);

  async function savePart(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'link',
          mpn,
          brand: make,
          description,
          internal_part_number: sku,
          preferred_vendor_name: vendor,
          vendor_part_number: vendorPn,
          unit_cost: cost,
          sell_price: sell,
          avg_lead_time_days: avgLead,
          expected_lead_time_days: expectedLead,
          quantity_on_hand: qty,
        }),
      });
      const json = (await res.json()) as { error?: string; reused?: boolean };
      if (!res.ok) throw new Error(json.error || 'save');
      setNotice(json.reused ? t('That part is already in this organization.') : t('Part saved.'));
      setMpn('');
      setDescription('');
      setSku('');
      setVendorPn('');
      await load();
    } catch {
      setError('save');
    } finally {
      setSaving(false);
    }
  }

  function useBomHit(hit: PartPick) {
    setMpn(hit.part_number);
    const desc = hit.description.split(' · ').slice(1).join(' · ') || hit.description;
    setDescription(desc);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto w-full px-4 py-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold">{t('Parts inventory')}</h1>
            <p className="text-[var(--text3)]">
              {t('Your cost, sell price, and lead time stay in this organization. The shared catalog has no prices.')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!hideZero} onChange={(e) => setHideZero(!e.target.checked)} />
            {t('Show zero quantity')}
          </label>
        </div>

        <div className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search parts')} />
          <input className="input" value={make} onChange={(e) => setMake(e.target.value)} placeholder={t('Manufacturer')} />
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('Model')} />
        </div>

        {bomHits.length > 0 && (
          <div className="card p-4">
            <h2 className="font-bold mb-2">{t('Parts for this device')}</h2>
            <p className="text-sm text-[var(--text3)] mb-3">
              {t('Bill of materials parts are listed first. Search still finds the rest of your inventory.')}
            </p>
            <div className="flex flex-wrap gap-2">
              {bomHits.slice(0, 24).map((hit) => (
                <button key={hit.key} type="button" className="btn btn-secondary text-sm" onClick={() => useBomHit(hit)}>
                  {hit.part_number}
                </button>
              ))}
            </div>
          </div>
        )}

        <form className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={savePart}>
          <h2 className="md:col-span-3 font-bold">{t('Add or reuse a part')}</h2>
          <input className="input" required value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder={t('Manufacturer part number')} />
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Description')} />
          <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={t('Internal part number')} />
          <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder={t('Preferred vendor')} />
          <input className="input" value={vendorPn} onChange={(e) => setVendorPn(e.target.value)} placeholder={t('Vendor part number')} />
          <input className="input" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={t('Cost')} inputMode="decimal" />
          <input className="input" value={sell} onChange={(e) => setSell(e.target.value)} placeholder={t('Sell price')} inputMode="decimal" />
          <input className="input" value={avgLead} onChange={(e) => setAvgLead(e.target.value)} placeholder={t('Average lead time (days)')} inputMode="numeric" />
          <input className="input" value={expectedLead} onChange={(e) => setExpectedLead(e.target.value)} placeholder={t('Expected lead time (days)')} inputMode="numeric" />
          <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={t('Quantity on hand')} inputMode="numeric" />
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? t('Saving…') : t('Save part')}
          </button>
        </form>

        {notice && <p className="text-sm">{notice}</p>}
        {error && (
          <p className="text-sm text-red-500">
            {error === 'load'
              ? t('Could not load inventory. Apply the parts migration, then sign in to a QA organization.')
              : t('Could not save this part.')}
          </p>
        )}

        {loading ? (
          <p>{t('Loading inventory…')}</p>
        ) : visible.length === 0 ? (
          <div className="card p-8 text-center">{t('No parts to show.')}</div>
        ) : (
          <div className="overflow-x-auto card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="p-3">{t('Part number')}</th>
                  <th className="p-3">{t('Description')}</th>
                  <th className="p-3">{t('Qty')}</th>
                  <th className="p-3">{t('Cost')}</th>
                  <th className="p-3">{t('Sell price')}</th>
                  <th className="p-3">{t('Lead time')}</th>
                  <th className="p-3">{t('Preferred vendor')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--line)]">
                    <td className="p-3">
                      <div className="font-medium">{row.parts_catalog?.part_number || row.mpn_normalized}</div>
                      {row.internal_part_number && (
                        <div className="text-[var(--text3)]">{row.internal_part_number}</div>
                      )}
                    </td>
                    <td className="p-3">{row.description_override || row.parts_catalog?.name || row.parts_catalog?.description}</td>
                    <td className="p-3">{row.quantity_on_hand ?? 0}</td>
                    <td className="p-3">{money(row.unit_cost)}</td>
                    <td className="p-3">{money(row.sell_price)}</td>
                    <td className="p-3">
                      {row.expected_lead_time_days ?? row.avg_lead_time_days ?? '—'}
                    </td>
                    <td className="p-3">
                      {row.preferred_vendor_name || '—'}
                      {row.vendor_part_number ? ` · ${row.vendor_part_number}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
