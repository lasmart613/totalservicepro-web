/**
 * Shared manufacturer / model lists for clinic onboarding, My Lasers, service requests.
 * Prefers MODELS map (always available offline); can merge DB-driven lists later.
 */
import { extraManufacturerNames } from './equipment-catalog';
import { MODELS } from './models';

const FALLBACK_MFRS = [
  'Alma', 'Candela', 'Coherent', 'Cutera', 'Cynosure', 'Fotona',
  'HOYA ConBio', 'InMode', 'Iridex', 'Lumenis', 'Lutronic', 'Quanta', 'Sciton', 'Syneron',
  ...extraManufacturerNames(),
];

/** Alphabetized manufacturer names from MODELS (+ fallbacks). */
export function listManufacturers(): string[] {
  const set = new Set<string>(FALLBACK_MFRS);
  Object.values(MODELS).forEach((m) => {
    if (m?.mfg) {
      // Split compound names like "Coherent / Lumenis"
      m.mfg.split('/').forEach((part) => {
        const n = part.trim();
        if (n) set.add(n);
      });
      set.add(m.mfg.trim());
    }
  });
  return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Models for a manufacturer (alphabetized). */
export function listModelsForManufacturer(mfr: string): string[] {
  if (!mfr) return [];
  const mfrL = mfr.toLowerCase().trim();
  const names: string[] = [];
  Object.entries(MODELS).forEach(([key, def]) => {
    const mf = (def.mfg || '').toLowerCase();
    if (
      mf === mfrL ||
      mf.includes(mfrL) ||
      mfrL.includes(mf) ||
      mf.split('/').some((p) => p.trim() === mfrL)
    ) {
      names.push(def.label || key);
    }
  });
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export const OTHER_MODEL = '__other__';
export const OTHER_LASER = '__other__';
