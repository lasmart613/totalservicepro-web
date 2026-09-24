/**
 * Manufacturer / model values for the calendar "New Service Call" form.
 *
 * Dropdown options come from listManufacturers / listModelsForManufacturer
 * (live public.manufacturers + public.laser_models, merged with static MODELS
 * and EQUIPMENT_CATALOG). These helpers only decide what is written to
 * service_tickets.equipment_make and service_tickets.equipment_model.
 *
 * "Other" is a dropdown sentinel and is never stored. The typed custom
 * name is stored instead. A blank custom value is stored as null.
 */
import { OTHER_MODEL } from './laser-catalog.ts';

/** Same sentinel as OTHER_MODEL so listModelsForManufacturer returns no rows. */
export const OTHER_MANUFACTURER = OTHER_MODEL;

export type TicketEquipmentInput = {
  manufacturer: string;
  customManufacturer?: string;
  model: string;
  customModel?: string;
};

export type TicketEquipmentFields = {
  equipment_make: string | null;
  equipment_model: string | null;
};

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function isOther(value: string): boolean {
  return value === OTHER_MANUFACTURER || value === OTHER_MODEL;
}

/** Catalog label, or the typed Other value. Sentinels become null when blank. */
export function resolveTicketEquipment(input: TicketEquipmentInput): TicketEquipmentFields {
  const manufacturer = clean(input.manufacturer);
  const model = clean(input.model);
  const customManufacturer = clean(input.customManufacturer);
  const customModel = clean(input.customModel);

  const make = isOther(manufacturer) ? customManufacturer : manufacturer;
  const resolvedModel = isOther(manufacturer) || isOther(model) ? customModel : model;

  return {
    equipment_make: make || null,
    equipment_model: resolvedModel || null,
  };
}

/**
 * Clearing or changing manufacturer drops the previous model.
 * Choosing Other pre-selects Other on model so the custom model field is shown.
 */
export function selectionAfterManufacturerChange(
  nextManufacturer: string,
  customManufacturer: string
): {
  equipment_make: string;
  equipment_make_other: string;
  equipment_model: string;
  equipment_model_other: string;
} {
  const next = String(nextManufacturer || '');
  if (!next) {
    return {
      equipment_make: '',
      equipment_make_other: '',
      equipment_model: '',
      equipment_model_other: '',
    };
  }
  if (next === OTHER_MANUFACTURER) {
    return {
      equipment_make: OTHER_MANUFACTURER,
      equipment_make_other: customManufacturer,
      equipment_model: OTHER_MODEL,
      equipment_model_other: '',
    };
  }
  return {
    equipment_make: next,
    equipment_make_other: '',
    equipment_model: '',
    equipment_model_other: '',
  };
}
