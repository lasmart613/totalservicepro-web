/**
 * God / catalog insert validation for service manuals.
 * Does not upload bytes — storage_path points at the existing `manuals` bucket.
 */
import { catalogManualKind, normalizeManualDocKind, type ManualDocKind } from './manual-catalog.ts';
import { BIOMED_MANUAL_SEEDS, suggestedManualStoragePath } from './equipment-catalog.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  equipmentTypeOrDefault,
  inferEquipmentType,
  type EquipmentType,
} from './equipment-types.ts';

export type ManualCatalogInsertInput = {
  equipment_type?: unknown;
  equipmentType?: unknown;
  brand?: unknown;
  manufacturer?: unknown;
  model?: unknown;
  title?: unknown;
  doc_kind?: unknown;
  docKind?: unknown;
  storage_path?: unknown;
  storagePath?: unknown;
  filename?: unknown;
};

export type ManualCatalogInsertRow = {
  equipment_type: EquipmentType;
  brand: string;
  model: string;
  title: string;
  doc_kind: ManualDocKind;
  storage_path: string;
};

function clip(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function parseManualCatalogInsert(
  body: ManualCatalogInsertInput
): { ok: true; row: ManualCatalogInsertRow } | { ok: false; error: string } {
  const brand = clip(body.brand ?? body.manufacturer, 80);
  const model = clip(body.model, 80);
  const title = clip(body.title, 200);
  if (brand.length < 2) return { ok: false, error: 'Manufacturer / brand is required.' };
  if (model.length < 1) return { ok: false, error: 'Model is required.' };
  if (title.length < 2) return { ok: false, error: 'Title is required.' };

  const equipment_type = equipmentTypeOrDefault(body.equipment_type ?? body.equipmentType);
  const explicitKind = normalizeManualDocKind(String(body.doc_kind ?? body.docKind ?? ''));
  let doc_kind: ManualDocKind =
    explicitKind ||
    catalogManualKind({ title, brand, model, doc_kind: String(body.doc_kind ?? body.docKind ?? '') });
  if (!explicitKind && /\buser\s+manual\b/i.test(title) && !/\bservice\s+manuals?\b/i.test(title)) {
    doc_kind = 'user';
  }

  let storage_path = clip(body.storage_path ?? body.storagePath, 400);
  if (!storage_path) {
    storage_path = suggestedManualStoragePath({
      brand,
      model,
      filename: clip(body.filename, 120) || `${model}.pdf`,
    });
  }
  if (!storage_path.toLowerCase().endsWith('.pdf') && !/\/$/.test(storage_path)) {
    return { ok: false, error: 'storage_path should be a PDF object path in the manuals bucket.' };
  }
  if (storage_path.startsWith('/') || /^https?:/i.test(storage_path)) {
    return { ok: false, error: 'Use a bucket-relative path such as shared/brand/model/file.pdf.' };
  }

  return {
    ok: true,
    row: { equipment_type, brand, model, title, doc_kind, storage_path },
  };
}

export function defaultEquipmentTypeForManual(fields: {
  equipment_type?: string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
}): EquipmentType {
  return inferEquipmentType(fields) || DEFAULT_EQUIPMENT_TYPE;
}

export function biomedSeedTitles(): string[] {
  return BIOMED_MANUAL_SEEDS.map((s) => s.title);
}
