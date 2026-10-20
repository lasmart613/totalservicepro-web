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

const CORE_CATALOG: EquipmentCatalogManufacturer[] = [
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
    aliases: ['OEC', 'GE/OEC'],
    models: [{ name: '9900', label: 'OEC 9900', equipmentType: 'c_arm', aliases: ['OEC 9900'] }],
  },
];


/**
 * Non-laser biomed catalog (000937 seeds the same rows into manufacturers +
 * laser_models). Real, well-known product names only. Keeps the type →
 * manufacturer → model cascade working offline and before the seed is applied.
 */
export const BIOMED_CATALOG: EquipmentCatalogManufacturer[] = [
  {
    name: "B. Braun",
    models: [
      { name: "Infusomat Space", label: "Infusomat Space", equipmentType: 'infusion_pump' },
      { name: "Perfusor Space", label: "Perfusor Space", equipmentType: 'infusion_pump' },
    ],
  },
  {
    name: "Baxter",
    models: [
      { name: "Sigma Spectrum", label: "Sigma Spectrum", equipmentType: 'infusion_pump' },
      { name: "Colleague", label: "Colleague", equipmentType: 'infusion_pump' },
    ],
  },
  {
    name: "BD",
    models: [
      { name: "Alaris 8015 PC Unit", label: "Alaris 8015 PC Unit", equipmentType: 'infusion_pump' },
      { name: "Alaris 8100 LVP Module", label: "Alaris 8100 LVP Module", equipmentType: 'infusion_pump' },
    ],
  },
  {
    name: "Cardiac Science",
    models: [
      { name: "Powerheart G5", label: "Powerheart G5", equipmentType: 'defibrillator' },
    ],
  },
  {
    name: "Dornier",
    models: [
      { name: "Compact Delta II", label: "Compact Delta II", equipmentType: 'lithotriptor' },
      { name: "Compact Sigma", label: "Compact Sigma", equipmentType: 'lithotriptor' },
      { name: "Delta III", label: "Delta III", equipmentType: 'lithotriptor' },
      { name: "Gemini", label: "Gemini", equipmentType: 'lithotriptor' },
    ],
  },
  {
    name: "Draeger",
    models: [
      { name: "Fabius GS", label: "Fabius GS", equipmentType: 'anesthesia' },
      { name: "Fabius Plus", label: "Fabius Plus", equipmentType: 'anesthesia' },
      { name: "Apollo", label: "Apollo", equipmentType: 'anesthesia' },
      { name: "Perseus A500", label: "Perseus A500", equipmentType: 'anesthesia' },
      { name: "Narkomed 2B", label: "Narkomed 2B", equipmentType: 'anesthesia' },
      { name: "Narkomed 6000", label: "Narkomed 6000", equipmentType: 'anesthesia' },
      { name: "Evita V500", label: "Evita V500", equipmentType: 'ventilator' },
      { name: "Savina 300", label: "Savina 300", equipmentType: 'ventilator' },
    ],
  },
  {
    name: "Fujifilm",
    models: [
      { name: "EPX-4450HD", label: "EPX-4450HD", equipmentType: 'endoscope' },
    ],
  },
  {
    name: "FUJIFILM Sonosite",
    models: [
      { name: "Edge II", label: "Edge II", equipmentType: 'ultrasound' },
      { name: "M-Turbo", label: "M-Turbo", equipmentType: 'ultrasound' },
      { name: "X-Porte", label: "X-Porte", equipmentType: 'ultrasound' },
    ],
  },
  {
    name: "GE Healthcare",
    models: [
      { name: "Aisys CS2", label: "Aisys CS2", equipmentType: 'anesthesia' },
      { name: "Aespire 7900", label: "Aespire 7900", equipmentType: 'anesthesia' },
      { name: "Avance CS2", label: "Avance CS2", equipmentType: 'anesthesia' },
      { name: "Carestation 650", label: "Carestation 650", equipmentType: 'anesthesia' },
      { name: "Dash 4000", label: "Dash 4000", equipmentType: 'patient_monitor' },
      { name: "CARESCAPE B450", label: "CARESCAPE B450", equipmentType: 'patient_monitor' },
      { name: "CARESCAPE V100", label: "CARESCAPE V100", equipmentType: 'patient_monitor' },
      { name: "LOGIQ E10", label: "LOGIQ E10", equipmentType: 'ultrasound' },
      { name: "LOGIQ P9", label: "LOGIQ P9", equipmentType: 'ultrasound' },
      { name: "Vivid E95", label: "Vivid E95", equipmentType: 'ultrasound' },
      { name: "Voluson E10", label: "Voluson E10", equipmentType: 'ultrasound' },
      { name: "Venue", label: "Venue", equipmentType: 'ultrasound' },
      { name: "CARESCAPE R860", label: "CARESCAPE R860", equipmentType: 'ventilator' },
    ],
  },
  {
    name: "GE OEC",
    models: [
      { name: "9800", label: "9800", equipmentType: 'c_arm' },
      { name: "OEC Elite", label: "OEC Elite", equipmentType: 'c_arm' },
    ],
  },
  {
    name: "Hamilton Medical",
    models: [
      { name: "HAMILTON-C1", label: "HAMILTON-C1", equipmentType: 'ventilator' },
      { name: "HAMILTON-C3", label: "HAMILTON-C3", equipmentType: 'ventilator' },
      { name: "HAMILTON-C6", label: "HAMILTON-C6", equipmentType: 'ventilator' },
      { name: "HAMILTON-T1", label: "HAMILTON-T1", equipmentType: 'ventilator' },
      { name: "HAMILTON-G5", label: "HAMILTON-G5", equipmentType: 'ventilator' },
    ],
  },
  {
    name: "Hill-Rom",
    models: [
      { name: "Progressa", label: "Progressa", equipmentType: 'beds' },
      { name: "VersaCare", label: "VersaCare", equipmentType: 'beds' },
      { name: "TotalCare", label: "TotalCare", equipmentType: 'beds' },
      { name: "Centrella", label: "Centrella", equipmentType: 'beds' },
      { name: "Advanta 2", label: "Advanta 2", equipmentType: 'beds' },
      { name: "CareAssist ES", label: "CareAssist ES", equipmentType: 'beds' },
    ],
  },
  {
    name: "ICU Medical",
    models: [
      { name: "Plum 360", label: "Plum 360", equipmentType: 'infusion_pump' },
      { name: "Plum A+", label: "Plum A+", equipmentType: 'infusion_pump' },
      { name: "Medfusion 3500", label: "Medfusion 3500", equipmentType: 'infusion_pump' },
    ],
  },
  {
    name: "Karl Storz",
    models: [
      { name: "IMAGE1 S", label: "IMAGE1 S", equipmentType: 'endoscope' },
    ],
  },
  {
    name: "Medtronic",
    models: [
      { name: "Puritan Bennett 840", label: "Puritan Bennett 840", equipmentType: 'ventilator' },
      { name: "Puritan Bennett 980", label: "Puritan Bennett 980", equipmentType: 'ventilator' },
    ],
  },
  {
    name: "Midmark",
    models: [
      { name: "Ritter 111", label: "Ritter 111", equipmentType: 'beds' },
      { name: "Ritter 112", label: "Ritter 112", equipmentType: 'beds' },
      { name: "Ritter 119", label: "Ritter 119", equipmentType: 'beds' },
      { name: "Ritter 204", label: "Ritter 204", equipmentType: 'beds' },
      { name: "223", label: "223", equipmentType: 'beds' },
      { name: "224", label: "224", equipmentType: 'beds' },
      { name: "626", label: "626", equipmentType: 'beds' },
      { name: "641", label: "641", equipmentType: 'beds' },
      { name: "M11 UltraClave", label: "M11 UltraClave", equipmentType: 'sterile_processing' },
      { name: "M9 UltraClave", label: "M9 UltraClave", equipmentType: 'sterile_processing' },
    ],
  },
  {
    name: "Mindray",
    models: [
      { name: "A7", label: "A7", equipmentType: 'anesthesia' },
      { name: "WATO EX-65", label: "WATO EX-65", equipmentType: 'anesthesia' },
      { name: "ePM 10M", label: "ePM 10M", equipmentType: 'patient_monitor' },
      { name: "Passport 12", label: "Passport 12", equipmentType: 'patient_monitor' },
      { name: "BeneView T5", label: "BeneView T5", equipmentType: 'patient_monitor' },
    ],
  },
  {
    name: "Olympus",
    models: [
      { name: "CV-190", label: "CV-190", equipmentType: 'endoscope' },
      { name: "CV-180", label: "CV-180", equipmentType: 'endoscope' },
      { name: "GIF-H190", label: "GIF-H190", equipmentType: 'endoscope' },
      { name: "CF-HQ190", label: "CF-HQ190", equipmentType: 'endoscope' },
    ],
  },
  {
    name: "Pentax Medical",
    models: [
      { name: "EPK-i7000", label: "EPK-i7000", equipmentType: 'endoscope' },
    ],
  },
  {
    name: "Philips",
    models: [
      { name: "BV Pulsera", label: "BV Pulsera", equipmentType: 'c_arm' },
      { name: "Zenition 70", label: "Zenition 70", equipmentType: 'c_arm' },
      { name: "HeartStart MRx", label: "HeartStart MRx", equipmentType: 'defibrillator' },
      { name: "HeartStart XL", label: "HeartStart XL", equipmentType: 'defibrillator' },
      { name: "HeartStart FRx", label: "HeartStart FRx", equipmentType: 'defibrillator' },
      { name: "IntelliVue MX450", label: "IntelliVue MX450", equipmentType: 'patient_monitor' },
      { name: "IntelliVue MX800", label: "IntelliVue MX800", equipmentType: 'patient_monitor' },
      { name: "IntelliVue MP50", label: "IntelliVue MP50", equipmentType: 'patient_monitor' },
      { name: "SureSigns VS4", label: "SureSigns VS4", equipmentType: 'patient_monitor' },
      { name: "EPIQ 7", label: "EPIQ 7", equipmentType: 'ultrasound' },
      { name: "Affiniti 70", label: "Affiniti 70", equipmentType: 'ultrasound' },
      { name: "CX50", label: "CX50", equipmentType: 'ultrasound' },
      { name: "Lumify", label: "Lumify", equipmentType: 'ultrasound' },
      { name: "Respironics V60", label: "Respironics V60", equipmentType: 'ventilator' },
      { name: "Trilogy 100", label: "Trilogy 100", equipmentType: 'ventilator' },
    ],
  },
  {
    name: "Physio-Control",
    models: [
      { name: "LIFEPAK 15", label: "LIFEPAK 15", equipmentType: 'defibrillator' },
      { name: "LIFEPAK 20e", label: "LIFEPAK 20e", equipmentType: 'defibrillator' },
      { name: "LIFEPAK 1000", label: "LIFEPAK 1000", equipmentType: 'defibrillator' },
      { name: "LIFEPAK CR2", label: "LIFEPAK CR2", equipmentType: 'defibrillator' },
    ],
  },
  {
    name: "Richard Wolf",
    models: [
      { name: "Piezolith 3000", label: "Piezolith 3000", equipmentType: 'lithotriptor' },
    ],
  },
  {
    name: "Samsung Medison",
    models: [
      { name: "HS60", label: "HS60", equipmentType: 'ultrasound' },
      { name: "RS80A", label: "RS80A", equipmentType: 'ultrasound' },
      { name: "HM70A", label: "HM70A", equipmentType: 'ultrasound' },
    ],
  },
  {
    name: "Siemens Healthineers",
    models: [
      { name: "Cios Alpha", label: "Cios Alpha", equipmentType: 'c_arm' },
      { name: "Arcadis Orbic", label: "Arcadis Orbic", equipmentType: 'c_arm' },
      { name: "ACUSON Sequoia", label: "ACUSON Sequoia", equipmentType: 'ultrasound' },
      { name: "ACUSON Juniper", label: "ACUSON Juniper", equipmentType: 'ultrasound' },
    ],
  },
  {
    name: "Spacelabs",
    models: [
      { name: "Xprezzon", label: "Xprezzon", equipmentType: 'patient_monitor' },
      { name: "Qube", label: "Qube", equipmentType: 'patient_monitor' },
    ],
  },
  {
    name: "STERIS",
    models: [
      { name: "Amsco Century", label: "Amsco Century", equipmentType: 'sterile_processing' },
      { name: "Amsco 400", label: "Amsco 400", equipmentType: 'sterile_processing' },
      { name: "Reliance 444", label: "Reliance 444", equipmentType: 'sterile_processing' },
      { name: "V-PRO maX", label: "V-PRO maX", equipmentType: 'sterile_processing' },
    ],
  },
  {
    name: "Storz Medical",
    models: [
      { name: "Modulith SLX-F2", label: "Modulith SLX-F2", equipmentType: 'lithotriptor' },
    ],
  },
  {
    name: "Stryker",
    models: [
      { name: "S3 MedSurg Bed", label: "S3 MedSurg Bed", equipmentType: 'beds' },
      { name: "InTouch Critical Care Bed", label: "InTouch Critical Care Bed", equipmentType: 'beds' },
      { name: "ProCuity", label: "ProCuity", equipmentType: 'beds' },
      { name: "Secure II", label: "Secure II", equipmentType: 'beds' },
      { name: "Prime Series Stretcher", label: "Prime Series Stretcher", equipmentType: 'beds' },
    ],
  },
  {
    name: "Tuttnauer",
    models: [
      { name: "2540M", label: "2540M", equipmentType: 'sterile_processing' },
      { name: "3870EA", label: "3870EA", equipmentType: 'sterile_processing' },
      { name: "EZ10", label: "EZ10", equipmentType: 'sterile_processing' },
    ],
  },
  {
    name: "Welch Allyn",
    models: [
      { name: "Connex Spot Monitor", label: "Connex Spot Monitor", equipmentType: 'patient_monitor' },
      { name: "Spot Vital Signs LXi", label: "Spot Vital Signs LXi", equipmentType: 'patient_monitor' },
    ],
  },
  {
    name: "Ziehm Imaging",
    models: [
      { name: "Ziehm Vision RFD", label: "Ziehm Vision RFD", equipmentType: 'c_arm' },
      { name: "Ziehm Solo", label: "Ziehm Solo", equipmentType: 'c_arm' },
    ],
  },
  {
    name: "ZOLL",
    models: [
      { name: "R Series", label: "R Series", equipmentType: 'defibrillator' },
      { name: "X Series", label: "X Series", equipmentType: 'defibrillator' },
      { name: "M Series", label: "M Series", equipmentType: 'defibrillator' },
      { name: "AED Plus", label: "AED Plus", equipmentType: 'defibrillator' },
    ],
  },
];

/** Core holmium / C-arm seeds plus BIOMED_CATALOG, one entry per manufacturer. */
export const EQUIPMENT_CATALOG: EquipmentCatalogManufacturer[] = (() => {
  const out = CORE_CATALOG.map((m) => ({ ...m, models: [...m.models] }));
  for (const extra of BIOMED_CATALOG) {
    const hit = out.find((m) => m.name.toLowerCase() === extra.name.toLowerCase());
    if (hit) hit.models.push(...extra.models);
    else out.push({ ...extra, models: [...extra.models] });
  }
  return out;
})();

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
