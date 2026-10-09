/**
 * Ensure a laser/equipment row exists; serial is stable identity across owner transfers.
 * Port of Android assets/equipment-ensure.js
 */
import { manufacturerNamesEqual } from './equipment-dropdown.ts';
import { exactTextImatch, textsMatchCaseInsensitive } from './email-match.ts';

export type EnsureEquipmentOpts = {
  customerOrgId: string | number | null | undefined;
  manufacturer?: string | null;
  model?: string | null;
  serial?: string | null;
  pulseCount?: string | number | null;
  name?: string | null;
  client: { from: (t: string) => any };
};

function coerceOrgId(orgId: string | number | null | undefined): string | number | null {
  if (orgId == null || orgId === '') return null;
  if (typeof orgId === 'number' && Number.isFinite(orgId)) return orgId;
  const s = String(orgId).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  return orgId;
}

function normSerial(serial?: string | null): string {
  return String(serial || '').trim();
}

function sameSpelling(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** GentleLase, GENTLELASE, and GL-VPYAG / GL VPYAG are the same stored model. "+" stays distinct (Excel V+). */
function looseModelKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]+/g, '');
}

function modelsLooselyEqual(stored: unknown, incoming: unknown): boolean {
  const left = looseModelKey(stored);
  const right = looseModelKey(incoming);
  return Boolean(left) && left === right;
}

/** Fill a blank stored field. A non-blank value, including BioLitec vs Biolitec, stays. */
function fillBlank(stored: unknown, incoming: string): string | null {
  const next = String(incoming || '').trim();
  const current = String(stored || '').trim();
  if (!next || current) return null;
  return next;
}

/**
 * Resolve or create equipment; on serial match, reassign customer org (transfer) and return same id.
 */
export async function ensureEquipment(opts: EnsureEquipmentOpts): Promise<string | number | null> {
  const sb = opts.client;
  const orgId = coerceOrgId(opts.customerOrgId);
  const manufacturer = String(opts.manufacturer || '').trim();
  const model = String(opts.model || '').trim();
  const serial = normSerial(opts.serial);
  const pulse =
    opts.pulseCount != null && opts.pulseCount !== '' ? String(opts.pulseCount).trim() : '';
  const name =
    String(opts.name || '').trim() ||
    [manufacturer, model].filter(Boolean).join(' ').trim();

  if (!sb || !orgId) return null;
  if (!manufacturer && !model && !serial && !name) return null;
  if (/^__other/i.test(manufacturer) || /^__other/i.test(model)) return null;

  try {
    let existing: any = null;

    if (serial) {
      const { data: rows } = await sb
        .from('equipment')
        .select('id, customer_organization_id, manufacturer, model, serial_number')
        .filter('serial_number', 'imatch', exactTextImatch(serial))
        .limit(5);
      const list = rows || [];
      existing =
        list.find((r: any) => textsMatchCaseInsensitive(r.serial_number, serial)) || null;
    }

    // A typed serial that misses must not reuse another laser of the same
    // make and model — that links the wrong machine and never stores the serial.
    // Blank serial reuses the same model under any stored spelling of the make
    // (Lumenis, Coherent, and "Coherent / Lumenis" are one brand). Model text
    // matches without case, spaces, or punctuation (GENTLELASE, GL-VPYAG).
    if (!existing && !serial && manufacturer && model) {
      const { data: rows } = await sb
        .from('equipment')
        .select('id, customer_organization_id, manufacturer, model')
        .eq('customer_organization_id', orgId)
        .limit(200);
      const matches = (rows || []).filter(
        (row: any) =>
          manufacturerNamesEqual(String(row?.manufacturer || ''), manufacturer) &&
          modelsLooselyEqual(row?.model, model)
      );
      existing =
        matches.find(
          (row: any) =>
            sameSpelling(String(row?.manufacturer || ''), manufacturer) &&
            sameSpelling(String(row?.model || ''), model)
        ) ||
        matches.find((row: any) => sameSpelling(String(row?.manufacturer || ''), manufacturer)) ||
        matches[0] ||
        null;
    }

    if (existing?.id) {
      const patch: Record<string, any> = {};
      if (String(existing.customer_organization_id || '') !== String(orgId)) {
        patch.customer_organization_id = orgId;
      }
      // Stored manufacturer and model are identity. Fill them only when blank.
      const keepManufacturer = fillBlank(existing.manufacturer, manufacturer);
      if (keepManufacturer) patch.manufacturer = keepManufacturer;
      const keepModel = fillBlank(existing.model, model);
      if (keepModel) patch.model = keepModel;
      // Live equipment has no name or pulse_count columns. Sending them 400s, then retries.
      if (Object.keys(patch).length) {
        const { error } = await sb.from('equipment').update(patch).eq('id', existing.id);
        if (error) console.warn('ensureEquipment update', error);
      }
      return existing.id;
    }

    // Live equipment.manufacturer and serial_number are NOT NULL, and name/status
    // columns are not on that table. Insert only a complete machine.
    if (!manufacturer || !model || !serial) return null;

    const insert: Record<string, any> = {
      customer_organization_id: orgId,
      manufacturer,
      model,
      serial_number: serial,
    };
    if (pulse) insert.pulse_count = pulse;

    let ins = await sb.from('equipment').insert([insert]).select('id').maybeSingle();
    if (ins.error) {
      if (/unique|duplicate/i.test(ins.error.message || '')) {
        const { data: race } = await sb
          .from('equipment')
          .select('id, serial_number')
          .filter('serial_number', 'imatch', exactTextImatch(serial))
          .limit(1)
          .maybeSingle();
        if (race?.id && textsMatchCaseInsensitive(race.serial_number, serial)) {
          await sb
            .from('equipment')
            .update({ customer_organization_id: orgId })
            .eq('id', race.id);
          return race.id;
        }
      }
      const retry: Record<string, any> = {
        customer_organization_id: orgId,
        manufacturer,
        model,
        serial_number: serial,
      };
      ins = await sb.from('equipment').insert([retry]).select('id').maybeSingle();
      if (ins.error) {
        console.warn('ensureEquipment insert', ins.error);
        return null;
      }
    }
    return ins.data?.id ?? null;
  } catch (e) {
    console.warn('ensureEquipment', e);
    return null;
  }
}

export type ServiceHistoryReport = {
  id: string;
  report_number?: string | null;
  status?: string | null;
  model_type?: string | null;
  equipment_name?: string | null;
  serial_number?: string | null;
  date_out?: string | null;
  created_at?: string | null;
  service_type?: string | null;
  service_engineer?: string | null;
  equipment_id?: number | string | null;
  customer_name?: string | null;
};

/** Load service reports for a laser by equipment_id and/or serial (transfer-safe). */
export async function loadServiceHistoryForLaser(opts: {
  client: { from: (t: string) => any };
  equipmentId?: string | number | null;
  serial?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<ServiceHistoryReport[]> {
  const sb = opts.client;
  const serial = normSerial(opts.serial);
  const limit = opts.limit || 40;
  const status = opts.status || null;
  const all: ServiceHistoryReport[] = [];
  const seen: Record<string, boolean> = {};

  const merge = (rows: any[] | null | undefined) => {
    (rows || []).forEach((r) => {
      if (!r?.id || seen[String(r.id)]) return;
      seen[String(r.id)] = true;
      all.push(r);
    });
  };

  const select =
    'id, report_number, status, model_type, equipment_name, serial_number, date_out, created_at, service_type, service_engineer, equipment_id, customer_name, customer_organization_id';

  try {
    if (opts.equipmentId != null) {
      let q = sb.from('service_reports').select(select).eq('equipment_id', opts.equipmentId);
      if (status) q = q.eq('status', status);
      const { data } = await q.order('created_at', { ascending: false }).limit(limit);
      merge(data);
    }
    if (serial) {
      let q = sb
        .from('service_reports')
        .select(select)
        .filter('serial_number', 'imatch', exactTextImatch(serial));
      if (status) q = q.eq('status', status);
      const { data } = await q.order('created_at', { ascending: false }).limit(limit);
      merge((data || []).filter((r: any) => textsMatchCaseInsensitive(r.serial_number, serial)));
    }
  } catch (e) {
    console.warn('loadServiceHistoryForLaser', e);
  }

  all.sort(
    (a, b) =>
      new Date(b.date_out || b.created_at || 0).getTime() -
      new Date(a.date_out || a.created_at || 0).getTime()
  );
  return all.slice(0, limit);
}

/** Service requests for a laser by equipment id and/or an exact serial. */
export async function loadServiceRequestsForLaser(opts: {
  client: { from: (t: string) => any };
  equipmentId?: string | number | null;
  serial?: string | null;
  limit?: number;
}): Promise<Array<Record<string, any>>> {
  const sb = opts.client;
  const serial = normSerial(opts.serial);
  const limit = opts.limit || 20;
  const select =
    'id, title, status, urgency, created_at, service_type, equipment_id, serial_number';
  const all: Array<Record<string, any>> = [];
  const seen: Record<string, boolean> = {};
  const merge = (rows: any[] | null | undefined) => {
    (rows || []).forEach((r) => {
      if (!r?.id || seen[String(r.id)]) return;
      seen[String(r.id)] = true;
      all.push(r);
    });
  };

  try {
    if (opts.equipmentId != null && opts.equipmentId !== '') {
      const { data } = await sb
        .from('service_requests')
        .select(select)
        .eq('equipment_id', opts.equipmentId)
        .order('created_at', { ascending: false })
        .limit(limit);
      merge(data);
    }
    if (serial) {
      const { data } = await sb
        .from('service_requests')
        .select(select)
        .filter('serial_number', 'imatch', exactTextImatch(serial))
        .order('created_at', { ascending: false })
        .limit(limit);
      merge((data || []).filter((r: any) => textsMatchCaseInsensitive(r.serial_number, serial)));
    }
  } catch (e) {
    console.warn('loadServiceRequestsForLaser', e);
  }

  all.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  return all.slice(0, limit);
}
