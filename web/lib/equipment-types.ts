/**
 * Shared biomedical equipment types for RepairPlanet.
 * Same values as clinic find-a-rep leads: laser | lithotriptor | c_arm | other.
 * Lasers stay the default "room" so the existing manuals library is unchanged.
 */

export const EQUIPMENT_TYPE_VALUES = ['laser', 'lithotriptor', 'c_arm', 'other'] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPE_VALUES)[number];

export const DEFAULT_EQUIPMENT_TYPE: EquipmentType = 'laser';

export type EquipmentTypeMeta = {
  value: EquipmentType;
  label: string;
  /** Short hallway label on the manuals library. */
  roomLabel: string;
  blurb: string;
  icon: string;
};

export const EQUIPMENT_TYPES: readonly EquipmentTypeMeta[] = [
  {
    value: 'laser',
    label: 'Laser',
    roomLabel: 'Laser room',
    blurb: 'Aesthetic and surgical lasers — the original bookshelf.',
    icon: '🔦',
  },
  {
    value: 'lithotriptor',
    label: 'Lithotriptor',
    roomLabel: 'Lithotriptor room',
    blurb: 'Holmium / lithotripsy platforms (Quanta Litho, Cyber Ho, and more).',
    icon: '💧',
  },
  {
    value: 'c_arm',
    label: 'C-arm',
    roomLabel: 'C-arm room',
    blurb: 'Mobile fluoroscopy (GE OEC and other C-arms).',
    icon: '🖥️',
  },
  {
    value: 'other',
    label: 'Other',
    roomLabel: 'Other room',
    blurb: 'Extensible catch-all for equipment that is not a laser, litho, or C-arm.',
    icon: '📦',
  },
] as const;

const ALIASES: Record<string, EquipmentType> = {
  laser: 'laser',
  lasers: 'laser',
  lithotriptor: 'lithotriptor',
  litho: 'lithotriptor',
  lithotripsy: 'lithotriptor',
  c_arm: 'c_arm',
  'c-arm': 'c_arm',
  carm: 'c_arm',
  'c arm': 'c_arm',
  other: 'other',
};

export function isEquipmentType(value: unknown): value is EquipmentType {
  return EQUIPMENT_TYPE_VALUES.includes(value as EquipmentType);
}

export function normalizeEquipmentType(value: unknown): EquipmentType | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) return null;
  if (isEquipmentType(raw)) return raw;
  const spaced = raw.replace(/_/g, ' ');
  return ALIASES[raw] || ALIASES[spaced] || null;
}

export function equipmentTypeOrDefault(value: unknown): EquipmentType {
  return normalizeEquipmentType(value) ?? DEFAULT_EQUIPMENT_TYPE;
}

export function equipmentTypeLabel(value: unknown): string {
  const t = normalizeEquipmentType(value);
  return EQUIPMENT_TYPES.find((row) => row.value === t)?.label || 'Laser';
}

export function equipmentTypeMeta(value: unknown): EquipmentTypeMeta {
  const t = equipmentTypeOrDefault(value);
  return EQUIPMENT_TYPES.find((row) => row.value === t) || EQUIPMENT_TYPES[0];
}

/**
 * When equipment_type is missing (pre-migration rows), guess from title / brand / path.
 * Holmium-only titles stay Laser — Cyber Ho / Litho wording is what maps to lithotriptor.
 */
export function inferEquipmentType(fields: {
  equipment_type?: string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
}): EquipmentType {
  const explicit = normalizeEquipmentType(fields.equipment_type);
  if (explicit) return explicit;

  const hay = [fields.title, fields.brand, fields.model, fields.storage_path]
    .map((s) => String(s || ''))
    .join(' ')
    .toLowerCase();

  if (/\bc[-\s_]?arm\b|\boec\b|fluoroscop/.test(hay)) return 'c_arm';
  if (/\blitho|\blithotrips|\bcyber\s*ho\b/.test(hay)) return 'lithotriptor';
  return DEFAULT_EQUIPMENT_TYPE;
}
