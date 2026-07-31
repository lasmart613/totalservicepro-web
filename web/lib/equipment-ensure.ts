/**
 * Ensure a laser/equipment row exists; serial is stable identity across owner transfers.
 * Port of Android assets/equipment-ensure.js
 */

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
        .select('id, customer_organization_id, organization_id, manufacturer, model, name, serial_number')
        .ilike('serial_number', serial)
        .limit(5);
      const list = rows || [];
      existing =
        list.find(
          (r: any) => normSerial(r.serial_number).toLowerCase() === serial.toLowerCase()
        ) ||
        list[0] ||
        null;
    }

    if (!existing && manufacturer && model) {
      let q = await sb
        .from('equipment')
        .select('id, customer_organization_id, organization_id')
        .eq('customer_organization_id', orgId)
        .eq('manufacturer', manufacturer)
        .eq('model', model)
        .limit(1)
        .maybeSingle();
      if (!q.data) {
        q = await sb
          .from('equipment')
          .select('id, customer_organization_id, organization_id')
          .eq('organization_id', orgId)
          .eq('manufacturer', manufacturer)
          .eq('model', model)
          .limit(1)
          .maybeSingle();
      }
      existing = q.data;
    }

    if (existing?.id) {
      const patch: Record<string, any> = {};
      if (String(existing.customer_organization_id || '') !== String(orgId)) {
        patch.customer_organization_id = orgId;
      }
      if (String(existing.organization_id || '') !== String(orgId)) {
        patch.organization_id = orgId;
      }
      if (manufacturer) patch.manufacturer = manufacturer;
      if (model) patch.model = model;
      if (name) patch.name = name;
      if (pulse) patch.pulse_count = pulse;
      if (Object.keys(patch).length) {
        let { error } = await sb.from('equipment').update(patch).eq('id', existing.id);
        if (error && /column|schema cache/i.test(error.message || '')) {
          if (/pulse_count/i.test(error.message || '')) delete patch.pulse_count;
          if (/organization_id/i.test(error.message || '')) delete patch.organization_id;
          if (/name/i.test(error.message || '')) delete patch.name;
          if (Object.keys(patch).length) {
            await sb.from('equipment').update(patch).eq('id', existing.id);
          }
        }
      }
      return existing.id;
    }

    const safeModel = model || manufacturer || serial || name || 'Unknown Laser';
    const insert: Record<string, any> = {
      customer_organization_id: orgId,
      organization_id: orgId,
      manufacturer: manufacturer || null,
      model: safeModel,
      serial_number: serial || null,
      name: name || safeModel,
      status: 'Active',
    };
    if (pulse) insert.pulse_count = pulse;

    let ins = await sb.from('equipment').insert([insert]).select('id').maybeSingle();
    if (ins.error) {
      if (serial && /unique|duplicate/i.test(ins.error.message || '')) {
        const { data: race } = await sb
          .from('equipment')
          .select('id')
          .ilike('serial_number', serial)
          .limit(1)
          .maybeSingle();
        if (race?.id) {
          await sb
            .from('equipment')
            .update({ customer_organization_id: orgId, organization_id: orgId })
            .eq('id', race.id);
          return race.id;
        }
      }
      ins = await sb
        .from('equipment')
        .insert([
          {
            customer_organization_id: orgId,
            manufacturer: manufacturer || null,
            model: safeModel,
            serial_number: serial || null,
          },
        ])
        .select('id')
        .maybeSingle();
      if (ins.error) {
        ins = await sb
          .from('equipment')
          .insert([
            {
              organization_id: orgId,
              manufacturer: manufacturer || null,
              model: safeModel,
              serial_number: serial || null,
            },
          ])
          .select('id')
          .maybeSingle();
        if (ins.error) {
          console.warn('ensureEquipment insert', ins.error);
          return null;
        }
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
      let q = sb.from('service_reports').select(select).ilike('serial_number', serial);
      if (status) q = q.eq('status', status);
      const { data } = await q.order('created_at', { ascending: false }).limit(limit);
      merge(data);
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
