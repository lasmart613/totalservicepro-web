/**
 * Shop-scoped test equipment (meters, analyzers) on test_equipment.
 * Reuses the existing table + assigned_to_fse. Live may lag the SQL —
 * omit-and-retry and treat a missing table as "unavailable", never toast raw SQL.
 */

import { writeWithColumnRetry } from './billing/save-helpers.ts';

export type TestEquipmentRow = {
  id: string;
  type?: string | null;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  asset_tag?: string | null;
  cal_date?: string | null;
  cal_due?: string | null;
  cal_lab?: string | null;
  notes?: string | null;
  user_id?: string | null;
  organization_id?: number | string | null;
  owned_by?: string | null;
  assigned_to_fse?: string | null;
  is_active?: boolean | null;
};

export const TEST_EQUIPMENT_TYPES = [
  'Power Meter',
  'Energy Meter',
  'Multimeter',
  'Oscilloscope',
  'Thermometer',
  'Beam Profiler',
  'Laser Energy/Power Sensor',
  'Flow Meter',
  'Conductivity Meter',
  'Laser Safety Glasses',
  'Electrical Safety Tester',
  'Other',
] as const;

const SELECT_FULL =
  'id, type, make, model, serial_number, asset_tag, cal_date, cal_due, cal_lab, notes, user_id, organization_id, owned_by, assigned_to_fse, is_active';
const SELECT_SAFE =
  'id, type, make, model, serial_number, asset_tag, cal_date, cal_due, notes, user_id, is_active';

export function isMissingTableError(message?: string | null): boolean {
  const m = String(message || '');
  return /relation .* does not exist|could not find the table|Could not find the table/i.test(m);
}

export function isSchemaDriftError(message?: string | null): boolean {
  const m = String(message || '');
  return /column|schema cache|does not exist|value too long|character\(3\)|char\(3\)/i.test(m);
}

export function testEquipmentLabel(row: TestEquipmentRow): string {
  return [row.make, row.model].filter(Boolean).join(' ') || row.type || 'Test equipment';
}

export type LoadTestEquipmentResult = {
  rows: TestEquipmentRow[];
  unavailable: boolean;
  schemaLag: boolean;
};

type Supa = { from: (t: string) => any };

function sameOrg(left: unknown, right: unknown): boolean {
  if (left == null || right == null || left === '' || right === '') return false;
  return String(left) === String(right);
}

/**
 * Shop list: rows for this organization. Client-filters org so a missing
 * organization_id column still cannot leak another shop after a broad retry.
 */
export async function loadShopTestEquipment(
  supabase: Supa,
  opts: { orgId: number | string | null; userId?: string | null }
): Promise<LoadTestEquipmentResult> {
  const empty: LoadTestEquipmentResult = { rows: [], unavailable: false, schemaLag: false };
  if (opts.orgId == null && !opts.userId) return empty;

  const trySelect = async (cols: string, orgScoped: boolean) => {
    let q = supabase.from('test_equipment').select(cols);
    if (opts.orgId != null && orgScoped) {
      q = q.or(
        `organization_id.eq.${opts.orgId},user_id.eq.${opts.userId || '00000000-0000-0000-0000-000000000000'}`
      );
    } else if (opts.userId) {
      q = q.eq('user_id', opts.userId);
    }
    return q.eq('is_active', true).order('type');
  };

  let { data, error } = await trySelect(SELECT_FULL, opts.orgId != null);
  let schemaLag = false;

  if (error && isMissingTableError(error.message)) {
    return { rows: [], unavailable: true, schemaLag: false };
  }

  if (error && isSchemaDriftError(error.message)) {
    schemaLag = true;
    ({ data, error } = await trySelect(SELECT_SAFE, false));
    if (error && isMissingTableError(error.message)) {
      return { rows: [], unavailable: true, schemaLag: true };
    }
    if (error && isSchemaDriftError(error.message)) {
      ({ data, error } = await supabase
        .from('test_equipment')
        .select('id, type, make, model, serial_number, user_id, is_active'));
      if (error && isMissingTableError(error.message)) {
        return { rows: [], unavailable: true, schemaLag: true };
      }
      if (error && isSchemaDriftError(error.message)) {
        return { rows: [], unavailable: false, schemaLag: true };
      }
    }
  }

  if (error) {
    if (isMissingTableError(error.message)) {
      return { rows: [], unavailable: true, schemaLag: false };
    }
    return { rows: [], unavailable: false, schemaLag };
  }

  let rows = (data || []) as TestEquipmentRow[];
  if (opts.orgId != null) {
    const orgRows = rows.filter((r) => sameOrg(r.organization_id, opts.orgId));
    // If organization_id was stripped from the select, keep user_id rows only
    // rather than showing every org the RLS retry might have returned.
    if (orgRows.length || rows.some((r) => r.organization_id != null)) {
      rows = orgRows;
    } else if (opts.userId) {
      rows = rows.filter((r) => String(r.user_id || '') === String(opts.userId));
    } else {
      rows = [];
    }
  }
  return { rows, unavailable: false, schemaLag };
}

export type SaveTestEquipmentResult = {
  id: string | number | null;
  unavailable: boolean;
  schemaLag: boolean;
  error?: { message?: string } | null;
};

export async function saveShopTestEquipment(
  supabase: Supa,
  payload: Record<string, unknown>,
  existingId: string | number | null
): Promise<SaveTestEquipmentResult> {
  const result = await writeWithColumnRetry(supabase, 'test_equipment', payload, existingId);
  if (!result.error) {
    return { id: result.id, unavailable: false, schemaLag: false };
  }
  const msg = String(result.error?.message || '');
  if (isMissingTableError(msg)) {
    return { id: existingId, unavailable: true, schemaLag: false, error: result.error };
  }
  if (isSchemaDriftError(msg)) {
    return { id: existingId, unavailable: false, schemaLag: true, error: result.error };
  }
  return { id: existingId, unavailable: false, schemaLag: false, error: result.error };
}

export type AssignResult = {
  ok: boolean;
  unavailable?: boolean;
  schemaLag?: boolean;
  error?: { message?: string } | null;
};

/** Assign / unassign a shop asset to an FSE (member id). */
export async function assignTestEquipmentToFse(
  supabase: Supa,
  id: string,
  fseId: string | null
): Promise<AssignResult> {
  const payload = {
    assigned_to_fse: fseId || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('test_equipment').update(payload).eq('id', id);
  if (!error) return { ok: true };
  const msg = String(error.message || '');
  if (isMissingTableError(msg)) return { ok: false, unavailable: true, error };
  if (isSchemaDriftError(msg)) return { ok: false, schemaLag: true, error };
  return { ok: false, error };
}
