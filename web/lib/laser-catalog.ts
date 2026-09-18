/**
 * Shared manufacturer / model lists for estimates, invoices, My Lasers, etc.
 * Prefers live manufacturers + laser_models (passed in) and always merges
 * static MODELS + EQUIPMENT_CATALOG so a missing static entry cannot empty
 * a brand that exists in the database.
 */
import {
  listCatalogManufacturers,
  listCatalogModels,
  type LiveCatalog,
} from './equipment-dropdown.ts';
import type { EquipmentType } from './equipment-types.ts';

export function listManufacturers(live?: LiveCatalog): string[] {
  return listCatalogManufacturers(live);
}

/** Models for a manufacturer (alphabetized). Optional live DB rows + equipment_type. */
export function listModelsForManufacturer(
  mfr: string,
  live?: LiveCatalog & { equipmentType?: string | null | EquipmentType }
): string[] {
  return listCatalogModels(mfr, live);
}

export const OTHER_MODEL = '__other__';
export const OTHER_LASER = '__other__';
