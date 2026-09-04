'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { fetchGodMe, godAuthHeader } from '@/lib/god-client';
import { EQUIPMENT_TYPES, DEFAULT_EQUIPMENT_TYPE, type EquipmentType } from '@/lib/equipment-types';
import {
  BIOMED_MANUAL_SEEDS,
  EQUIPMENT_CATALOG,
  catalogModelsForManufacturer,
  suggestedManualStoragePath,
} from '@/lib/equipment-catalog';

export default function GodManualsCatalogPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [equipmentType, setEquipmentType] = useState<EquipmentType>(DEFAULT_EQUIPMENT_TYPE);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [docKind, setDocKind] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const god = await fetchGodMe();
      if (cancelled) return;
      setAllowed(!!god);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const manufacturers = useMemo(() => {
    const fromType = EQUIPMENT_CATALOG.filter((m) =>
      m.models.some((row) => row.equipmentType === equipmentType)
    ).map((m) => m.name);
    return fromType.length ? fromType : EQUIPMENT_CATALOG.map((m) => m.name);
  }, [equipmentType]);

  const models = useMemo(
    () => catalogModelsForManufacturer(brand, equipmentType),
    [brand, equipmentType]
  );

  function applySeed(index: number) {
    const seed = BIOMED_MANUAL_SEEDS[index];
    if (!seed) return;
    setEquipmentType(seed.equipmentType);
    setBrand(seed.manufacturer);
    setModel(seed.model);
    setTitle(seed.title);
    setDocKind(seed.docKind);
    setStoragePath(seed.suggestedPath);
  }

  function onBrandModelChange(nextBrand: string, nextModel: string) {
    setBrand(nextBrand);
    setModel(nextModel);
    if (!storagePath || storagePath.startsWith('shared/')) {
      setStoragePath(
        suggestedManualStoragePath({
          brand: nextBrand,
          model: nextModel,
          filename: nextModel,
        })
      );
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const headers = await godAuthHeader();
      const res = await fetch('/api/god/manuals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          equipment_type: equipmentType,
          brand,
          model,
          title,
          doc_kind: docKind || undefined,
          storage_path: storagePath,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.error || 'Could not add catalog row');
        return;
      }
      toast.success('Catalog row added. Upload the PDF to that storage_path in the manuals bucket.');
      setTitle('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add catalog row');
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className="text-[var(--text3)]">Loading manuals catalog…</div>;
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
    <div className="max-w-3xl">
      <p className="text-sm text-[var(--text3)] mb-2">
        <Link href="/admin/god" className="hover:text-[var(--gold)]">
          ← God dashboard
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold mb-2">Manuals catalog</h1>
      <p className="text-[var(--text3)] mb-6">
        Add a bookshelf row after the PDF is in the <code>manuals</code> Storage bucket. Equipment
        type is required so the book lands in the right room. Default room is Laser.
      </p>

      <div className="card p-4 mb-6">
        <div className="text-sm font-semibold mb-2">First five uploads (suggested paths)</div>
        <ul className="text-sm space-y-2">
          {BIOMED_MANUAL_SEEDS.map((seed, i) => (
            <li key={seed.suggestedPath} className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-secondary text-xs" onClick={() => applySeed(i)}>
                Prefill
              </button>
              <span>
                {seed.title} → <code className="text-xs">{seed.suggestedPath}</code>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={submit} className="card p-5 space-y-4">
        <label className="block">
          <span className="text-xs text-[var(--text3)]">Equipment type (room)</span>
          <select
            required
            className="input w-full"
            value={equipmentType}
            onChange={(e) => {
              const next = e.target.value as EquipmentType;
              setEquipmentType(next);
              setBrand('');
              setModel('');
            }}
          >
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.roomLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-[var(--text3)]">Manufacturer</span>
          <input
            className="input w-full"
            required
            list="god-manual-brands"
            value={brand}
            onChange={(e) => onBrandModelChange(e.target.value, model)}
            placeholder="e.g. Quanta System, GE OEC, Candela"
          />
          <datalist id="god-manual-brands">
            {manufacturers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="text-xs text-[var(--text3)]">Model</span>
          <input
            className="input w-full"
            required
            list="god-manual-models"
            value={model}
            onChange={(e) => onBrandModelChange(brand, e.target.value)}
            placeholder="e.g. Litho EVO, 9900"
          />
          <datalist id="god-manual-models">
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.label}
              </option>
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="text-xs text-[var(--text3)]">Title</span>
          <input
            className="input w-full"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="As it should appear on the shelf"
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--text3)]">Document kind</span>
          <select className="input w-full" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
            <option value="">Infer from title</option>
            <option value="service">Service Manual</option>
            <option value="user">User Manual</option>
            <option value="operator">Operator&apos;s Manual</option>
            <option value="technical">Technical Manual</option>
            <option value="parts">Parts Manual</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-[var(--text3)]">Storage path (manuals bucket)</span>
          <input
            className="input w-full font-mono text-sm"
            required
            value={storagePath}
            onChange={(e) => setStoragePath(e.target.value)}
            placeholder="shared/quanta-system/litho/DGM001063.pdf"
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Add catalog row'}
        </button>
      </form>
    </div>
  );
}
