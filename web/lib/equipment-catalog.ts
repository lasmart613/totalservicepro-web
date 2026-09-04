/**
 * Seed catalog for biomed expansion manuals (no PDF binaries).
 * Manufacturers / models Larry will attach the first holmium Litho + C-arm PDFs to.
 * Quanta Litho / Cyber Ho / Litho EVO and Dornier H20 / H30 (Medilas) are
 * holmium lasers, not lithotriptors. True ESWL (Compact Delta, etc.) stays lithotriptor.
 */
import {
  DEFAULT_EQUIPMENT_TYPE,
  type EquipmentType,
} from './equipment-types.ts';

export type EquipmentCatalogModel = {
  name: string;
  label: string;
  equipmentType: EquipmentType;
  aliases?: string[];
};

export type EquipmentCatalogManufacturer = {
  name: string;
  aliases?: string[];
  models: EquipmentCatalogModel[];
};

/** First manuals Larry will upload after merge (storage only — not git). */
export const BIOMED_MANUAL_SEEDS = [
  {
    equipmentType: 'c_arm' as const,
    manufacturer: 'GE OEC',
    model: '9900',
    title: 'GE OEC 9900 Service Manual',
    docKind: 'service',
    docNo: null as string | null,
    suggestedPath: 'shared/ge-oec/9900/GE-OEC-9900-Service-Manual.pdf',
  },
  {
    equipmentType: 'laser' as const,
    manufacturer: 'Quanta System',
    model: 'Litho',
    title: 'Quanta System Litho Service Manual DGM001063',
    docKind: 'service',
    docNo: 'DGM001063',
    suggestedPath: 'shared/quanta-system/litho/DGM001063.pdf',
  },
  {
    equipmentType: 'laser' as const,
    manufacturer: 'Quanta System',
    model: 'Litho 60',
    title: 'Quanta System Cyber Ho 60 / Litho 60 Service Manual DGM001311',
    docKind: 'service',
    docNo: 'DGM001311',
    suggestedPath: 'shared/quanta-system/litho-60/DGM001311.pdf',
  },
  {
    equipmentType: 'laser' as const,
    manufacturer: 'Quanta System',
    model: 'Litho 100',
    title: 'Quanta System Cyber Ho 100 / Litho 100 Service Manual DGM001341',
    docKind: 'service',
    docNo: 'DGM001341',
    suggestedPath: 'shared/quanta-system/litho-100/DGM001341.pdf',
  },
  {
    equipmentType: 'laser' as const,
    manufacturer: 'Quanta System',
    model: 'Litho EVO',
    title: 'Quanta System Litho EVO User Manual DGM001435',
    docKind: 'user',
    docNo: 'DGM001435',
    suggestedPath: 'shared/quanta-system/litho-evo/DGM001435.pdf',
  },
] as const;

export const EQUIPMENT_CATALOG: EquipmentCatalogManufacturer[] = [
  {
    name: 'Quanta System',
    aliases: ['Quanta', 'QuantaSystem'],
    models: [
      { name: 'Litho', label: 'Litho', equipmentType: 'laser' },
      {
        name: 'Litho 60',
        label: 'Litho 60 / Cyber Ho 60',
        equipmentType: 'laser',
        aliases: ['Cyber Ho 60', 'Litho60'],
      },
      {
        name: 'Litho 100',
        label: 'Litho 100 / Cyber Ho 100',
        equipmentType: 'laser',
        aliases: ['Cyber Ho 100', 'Litho100'],
      },
      { name: 'Litho EVO', label: 'Litho EVO', equipmentType: 'laser', aliases: ['LithoEVO'] },
    ],
  },
  {
    name: 'Dornier',
    aliases: ['Dornier MedTech', 'Dornier Medilas', 'Medilas'],
    models: [
      {
        name: 'H20',
        label: 'H20 (Medilas holmium)',
        equipmentType: 'laser',
        aliases: ['H-20', 'Medilas H20', 'H20/H30'],
      },
      {
        name: 'H30',
        label: 'H30 (Medilas holmium)',
        equipmentType: 'laser',
        aliases: ['H-30', 'Medilas H30'],
      },
    ],
  },
  {
    name: 'GE OEC',
    aliases: ['GE Healthcare', 'OEC', 'GE'],
    models: [{ name: '9900', label: 'OEC 9900', equipmentType: 'c_arm', aliases: ['OEC 9900'] }],
  },
];

export function catalogManufacturers(): string[] {
  return EQUIPMENT_CATALOG.map((m) => m.name);
}

export function catalogModelsForManufacturer(
  manufacturer: string,
  type?: EquipmentType | null
): EquipmentCatalogModel[] {
  const mfr = EQUIPMENT_CATALOG.find(
    (m) =>
      m.name.toLowerCase() === String(manufacturer || '').toLowerCase() ||
      (m.aliases || []).some((a) => a.toLowerCase() === String(manufacturer || '').toLowerCase())
  );
  if (!mfr) return [];
  if (!type) return mfr.models;
  return mfr.models.filter((model) => model.equipmentType === type);
}

export function suggestedManualStoragePath(opts: {
  brand: string;
  model?: string | null;
  filename?: string | null;
}): string {
  const brand = slugPart(opts.brand) || 'manuals';
  const model = slugPart(opts.model || '') || 'general';
  const file = String(opts.filename || opts.model || 'manual.pdf')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\.pdf$/i, '')
    .slice(0, 80);
  return `shared/${brand}/${model}/${file || 'manual'}.pdf`;
}

function slugPart(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Keep laser-catalog fallbacks in sync without renaming existing "Quanta". */
export function extraManufacturerNames(): string[] {
  return catalogManufacturers().filter((name) => name !== 'Quanta');
}

export function defaultTypeForNewManual(): EquipmentType {
  return DEFAULT_EQUIPMENT_TYPE;
}
