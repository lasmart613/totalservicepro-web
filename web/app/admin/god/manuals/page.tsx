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
import {
  catalogManualKind,
  catalogManualKindLabel,
  manualLibraryShelf,
  manualLibraryShelfLabel,
} from '@/lib/manual-catalog';

export default function GodManualsCatalogPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [equipmentType, setEquipmentType] = useState<EquipmentType>(DEFAULT_EQUIPMENT_TYPE);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [docKind, setDocKind] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [isIncomplete, setIsIncomplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexNote, setReindexNote] = useState('');
  const [reindexManualId, setReindexManualId] = useState('');

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
    setIsIncomplete(false);
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

  async function reindexBatch(force = false, manualId?: string, attachCollection = false) {
    setReindexing(true);
    try {
      const headers = await godAuthHeader();
      const target = String(manualId || '').trim();
      const attachAll = attachCollection && !target;
      let indexed = 0;
      let processed = 0;
      let attached = 0;
      let afterId: number | undefined;
      let lastRemaining = 0;
      let lastCollection: { ok?: boolean; skipped?: string; collectionId?: string } | undefined;
      const maxLoops = target ? 1 : attachAll ? 250 : 80;
      for (let i = 0; i < maxLoops; i++) {
        const res = await fetch('/api/god/manuals/reindex', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            limit: target || attachAll ? 1 : 4,
            force: force && i === 0,
            manualId: target || undefined,
            attachCollection: attachCollection || undefined,
            afterId: attachAll ? afterId : undefined,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          processed?: number;
          indexed?: number;
          remaining?: number;
          afterId?: number | null;
          attachableMissing?: number;
          results?: Array<{ manualId?: string; ok?: boolean; skipped?: string; chars?: number }>;
          collection?: { ok?: boolean; skipped?: string; collectionId?: string };
          collections?: Array<{ ok?: boolean; skipped?: string; collectionId?: string }>;
        };
        if (!res.ok || !json.ok) {
          toast.error(json.error || 'Reindex failed');
          return;
        }
        processed += json.processed || 0;
        indexed += json.indexed || 0;
        lastRemaining = json.remaining || 0;
        lastCollection = json.collection;
        const batchCollections = json.collections?.length ? json.collections : json.collection ? [json.collection] : [];
        attached += batchCollections.filter((c) => c.ok).length;
        if (json.afterId != null) afterId = json.afterId;
        if (!json.processed || !json.remaining) break;
      }
      const collectionNote = attachCollection
        ? attachAll
          ? ` Attached ${attached} Grok collection(s). Remaining unstamped after cursor: ${lastRemaining}. Repeat until remaining is 0, then start over once to retry failures.`
          : lastCollection?.ok
            ? ` Grok collection ${lastCollection.collectionId || ''} stamped.`
            : ` Grok collection attach failed (${lastCollection?.skipped || 'see logs'}). Search index still wrote.`
        : '';
      const detail = target
        ? `Catalog id ${target}: indexed ${indexed} (${processed} attempted). Incomplete PDFs are included when storage_path is a real file.${collectionNote}`
        : attachAll
          ? `Catch-up: indexed ${indexed} PDF text row(s), attached ${attached} to Grok (${processed} attempted).${collectionNote}`
          : `Indexed ${indexed} PDF(s) this run (${processed} attempted). Repeat if the catalog is large.`;
      setReindexNote(detail);
      toast.success(detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reindex failed');
    } finally {
      setReindexing(false);
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
          is_incomplete: isIncomplete,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast.error(json.error || 'Could not add catalog row');
        return;
      }
      toast.success('Catalog row added. Upload the PDF to that storage_path in the manuals bucket.');
      setTitle('');
      setIsIncomplete(false);
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
        type is the room (default Laser). Document kind chooses the public library:{' '}
        <strong className="text-[var(--text)]">Service Manuals</strong> or{' '}
        <strong className="text-[var(--text)]">Operators Manuals</strong> — not one mixed shelf.
        Operators / IFU / user docs belong on Operators, including OP-in-SM cases such as Lyra 767.
      </p>

      <div className="card p-4 mb-6">
        <div className="text-sm font-semibold mb-2">PDF text index (library search)</div>
        <p className="text-sm text-[var(--text3)] mb-3">
          Two indexes: <strong className="text-[var(--text)]">Index missing PDF text</strong> fills{' '}
          <code>manual_search_index</code> (library search + AI fallback).{' '}
          <strong className="text-[var(--text)]">Attach missing Grok collections</strong> uploads
          every unstamped file/folder PDF into the shared xAI collection and stamps{' '}
          <code>xai_collection_id</code> (Larry only; one PDF per request — repeat until remaining
          is 0). Use a catalog id + <strong className="text-[var(--text)]">Attach to Grok
          collection</strong> for a single row. Live grok-assistant still searches the shared
          collection; the stamp marks that this PDF was uploaded. <code>is_incomplete</code> does
          not skip either action. Clear the Incomplete badge separately in God → Tables → manuals
          if the PDF is actually complete.
        </p>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <button
            type="button"
            className="btn btn-secondary text-sm"
            disabled={reindexing}
            onClick={() => reindexBatch(false)}
          >
            {reindexing ? 'Indexing…' : 'Index missing PDF text'}
          </button>
          <button
            type="button"
            className="btn btn-secondary text-sm"
            disabled={reindexing}
            onClick={() => reindexBatch(false, undefined, true)}
          >
            {reindexing ? 'Indexing…' : 'Attach missing Grok collections'}
          </button>
          <label className="text-sm">
            <span className="block text-xs text-[var(--text3)]">Catalog id</span>
            <input
              className="input w-28 font-mono text-sm"
              inputMode="numeric"
              placeholder="721"
              value={reindexManualId}
              onChange={(e) => setReindexManualId(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary text-sm"
            disabled={reindexing || !reindexManualId.trim()}
            onClick={() => reindexBatch(true, reindexManualId)}
          >
            Index this manual
          </button>
          <button
            type="button"
            className="btn btn-secondary text-sm"
            disabled={reindexing || !reindexManualId.trim()}
            onClick={() => reindexBatch(true, reindexManualId, true)}
          >
            Attach to Grok collection
          </button>
        </div>
        {reindexNote ? <p className="text-xs text-[var(--text3)] mt-2">{reindexNote}</p> : null}
      </div>

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
            placeholder="e.g. Quanta System, GE OEC, Candela, Dornier"
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
            placeholder="e.g. Litho EVO, 9900, H20"
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
          <span className="text-xs text-[var(--text3)]">Document kind (library shelf)</span>
          <select className="input w-full" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
            <option value="">Infer from title / IFU wording</option>
            <option value="service">Service Manual → Service library</option>
            <option value="user">User Manual → Operators library</option>
            <option value="operator">Operator&apos;s Manual → Operators library</option>
            <option value="technical">Technical Manual → Service library</option>
            <option value="parts">Parts Manual → Service library</option>
          </select>
          <span className="block text-xs text-[var(--text3)] mt-1">
            Preview:{' '}
            {manualLibraryShelfLabel(
              manualLibraryShelf({ title, brand, model, doc_kind: docKind || undefined })
            )}{' '}
            · {catalogManualKindLabel(catalogManualKind({ title, brand, model, doc_kind: docKind || undefined }))}
          </span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isIncomplete}
            onChange={(e) => setIsIncomplete(e.target.checked)}
          />
          <span className="text-sm">Incomplete document (shows an Incomplete badge on the shelf and in the viewer)</span>
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
