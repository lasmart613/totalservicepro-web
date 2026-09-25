/**
 * Shared manufacturer / model lists for estimates, invoices, My Lasers, etc.
 * Prefers live manufacturers + laser_models (passed in) and always merges
 * static MODELS + EQUIPMENT_CATALOG so a missing static entry cannot empty
 * a brand that exists in the database.
 */
import {
  listCatalogManufacturerChoices,
  listCatalogManufacturers,
  listCatalogModelChoices,
  listCatalogModels,
  type CatalogChoice,
  type LiveCatalog,
} from './equipment-dropdown.ts';
import type { EquipmentType } from './equipment-types.ts';

export function listManufacturers(live?: LiveCatalog): string[] {
  return listCatalogManufacturers(live);
}

export function listManufacturerChoices(live?: LiveCatalog): CatalogChoice[] {
  return listCatalogManufacturerChoices(live);
}

/** Models for a manufacturer (alphabetized). Optional live DB rows + equipment_type. */
export function listModelsForManufacturer(
  mfr: string,
  live?: LiveCatalog & { equipmentType?: string | null | EquipmentType }
): string[] {
  return listCatalogModels(mfr, live);
}

export function listModelChoices(
  mfr: string,
  live?: LiveCatalog & { equipmentType?: string | null | EquipmentType }
): CatalogChoice[] {
  return listCatalogModelChoices(mfr, live);
}

export const OTHER_MODEL = '__other__';
export const OTHER_LASER = '__other__';
