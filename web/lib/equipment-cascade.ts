/**
 * Pure state rules for the shared Equipment type → Manufacturer → Model cascade.
 * React-free so the reset rules are unit tested; see use-equipment-cascade.ts.
 */
import {
  manufacturerNamesEqual,
  modelDedupeKey,
  type CatalogChoice,
  type LiveCatalog,
} from './equipment-dropdown.ts';
import { listManufacturerChoices, listModelChoices } from './laser-catalog.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  EQUIPMENT_TYPE_VALUES,
  equipmentTypeOrDefault,
  normalizeEquipmentType,
  type EquipmentType,
} from './equipment-types.ts';

export const OTHER_VALUE = '__other__';

export type CascadeState = {
  equipmentType: EquipmentType;
  /** Picker value: a catalog manufacturer, OTHER_VALUE, or ''. */
  manufacturer: string;
  customManufacturer: string;
  /** Picker value: a catalog model, OTHER_VALUE, or ''. */
  model: string;
  customModel: string;
};

export function emptyCascade(type: EquipmentType = DEFAULT_EQUIPMENT_TYPE): CascadeState {
  return { equipmentType: type, manufacturer: '', customManufacturer: '', model: '', customModel: '' };
}

export function manufacturerChoicesForType(catalog: LiveCatalog, type: EquipmentType): CatalogChoice[] {
  return listManufacturerChoices({ ...catalog, equipmentType: type });
}

export function modelChoicesFor(
  catalog: LiveCatalog,
  type: EquipmentType,
  manufacturer: string
): CatalogChoice[] {
  if (!manufacturer || manufacturer === OTHER_VALUE) return [];
  return listModelChoices(manufacturer, { ...catalog, equipmentType: type });
}

/** Changing the type clears manufacturer and model (and their free text). */
export function changeEquipmentType(state: CascadeState, next: unknown): CascadeState {
  const type = equipmentTypeOrDefault(next);
  if (type === state.equipmentType) return state;
  return emptyCascade(type);
}

/** Changing the manufacturer clears the model (and its free text). */
export function changeManufacturer(state: CascadeState, next: string): CascadeState {
  if (next === state.manufacturer) return state;
  return {
    ...state,
    manufacturer: next,
    customManufacturer: next === OTHER_VALUE ? state.customManufacturer : '',
    model: next === OTHER_VALUE ? OTHER_VALUE : '',
    customModel: '',
  };
}

export function changeModel(state: CascadeState, next: string): CascadeState {
  if (next === state.model) return state;
  return { ...state, model: next, customModel: next === OTHER_VALUE ? state.customModel : '' };
}

/**
 * Load saved text (type, manufacturer, model) into picker state. A saved value
 * that is not in the filtered list becomes Other + free text so nothing is lost.
 */
export function hydrateCascade(
  catalog: LiveCatalog,
  saved: { equipmentType?: unknown; manufacturer?: string | null; model?: string | null }
): CascadeState {
  const type =
    normalizeEquipmentType(saved.equipmentType) ??
    guessEquipmentType(catalog, saved.manufacturer, saved.model);
  const state = emptyCascade(type);
  const mfr = String(saved.manufacturer || '').trim();
  const mdl = String(saved.model || '').trim();
  if (mfr) {
    const hit = manufacturerChoicesForType(catalog, type).find(
      (c) => c.value === mfr || manufacturerNamesEqual(c.value, mfr)
    );
    if (hit) state.manufacturer = hit.value;
    else {
      state.manufacturer = OTHER_VALUE;
      state.customManufacturer = mfr;
    }
  }
  if (mdl) {
    const options = state.manufacturer === OTHER_VALUE ? [] : modelChoicesFor(catalog, type, state.manufacturer);
    const key = modelDedupeKey(mdl);
    const hit = options.find(
      (c) => c.value === mdl || modelDedupeKey(c.value) === key || modelDedupeKey(c.label) === key
    );
    if (hit) state.model = hit.value;
    else {
      state.model = OTHER_VALUE;
      state.customModel = mdl;
    }
  }
  return state;
}

/**
 * Legacy rows saved before the type was stored: the first type whose lists hold
 * both the manufacturer and the model (laser first), else the manufacturer alone.
 */
export function guessEquipmentType(
  catalog: LiveCatalog,
  manufacturer?: string | null,
  model?: string | null
): EquipmentType {
  const mfr = String(manufacturer || '').trim();
  if (!mfr) return DEFAULT_EQUIPMENT_TYPE;
  const key = modelDedupeKey(String(model || ''));
  let mfrOnly: EquipmentType | null = null;
  for (const type of EQUIPMENT_TYPE_VALUES) {
    const hit = manufacturerChoicesForType(catalog, type).find(
      (c) => c.value === mfr || manufacturerNamesEqual(c.value, mfr)
    );
    if (!hit) continue;
    if (!key) return type;
    const models = modelChoicesFor(catalog, type, hit.value);
    if (models.some((c) => modelDedupeKey(c.value) === key || modelDedupeKey(c.label) === key)) return type;
    mfrOnly = mfrOnly ?? type;
  }
  return mfrOnly ?? DEFAULT_EQUIPMENT_TYPE;
}

/** Text to save. Other uses the free text; blanks stay blank. */
export function resolveCascade(state: CascadeState): {
  equipment_type: EquipmentType;
  manufacturer: string;
  model: string;
} {
  const manufacturer =
    state.manufacturer === OTHER_VALUE ? state.customManufacturer.trim() : state.manufacturer.trim();
  const model = state.model === OTHER_VALUE ? state.customModel.trim() : state.model.trim();
  return { equipment_type: state.equipmentType, manufacturer, model };
}
