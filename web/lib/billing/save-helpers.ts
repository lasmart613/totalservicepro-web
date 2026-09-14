/** Shared helpers for estimates / invoices Supabase writes (schema-drift tolerant). */

export function isValidOrgId(val: unknown): boolean {
  if (val == null) return false;
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return true;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s.includes('-') && s.length > 10) return true;
    if (/^\d+$/.test(s)) return true;
  }
  return false;
}

export function coerceOrgId(val: unknown): string | number | null {
  if (!isValidOrgId(val)) return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  return s;
}

export function parseJsonField(val: unknown): Record<string, any> {
  if (!val) return {};
  if (typeof val === 'object' && !Array.isArray(val)) return val as Record<string, any>;
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

export type LineItem = {
  id: string;
  part_number: string;
  description: string;
  qty: number;
  unit_price: number;
  ext: number;
};

export function emptyLineItem(prefix = 'LI'): LineItem {
  return {
    id: `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    part_number: '',
    description: '',
    qty: 1,
    unit_price: 0,
    ext: 0,
  };
}

export function recomputeExt(item: LineItem): LineItem {
  const qty = Number(item.qty) || 0;
  const price = Number(item.unit_price) || 0;
  return { ...item, ext: Math.round(qty * price * 100) / 100 };
}

export function lineItemsSubtotal(items: LineItem[]): number {
  return Math.round(items.reduce((s, i) => s + (Number(i.ext) || 0), 0) * 100) / 100;
}

/**
 * Insert/update with retry stripping columns PostgREST reports as missing.
 * Matches NewServiceReportClient / Android stripOptionalCols pattern.
 */
export async function writeWithColumnRetry(
  supabase: { from: (t: string) => any },
  table: string,
  payload: Record<string, any>,
  existingId: string | number | null
): Promise<{ id: string | number | null; error: any }> {
  let body = { ...payload };
  for (let attempt = 0; attempt < 8; attempt++) {
    if (existingId != null && existingId !== '') {
      const { data, error } = await supabase
        .from(table)
        .update(body)
        .eq('id', existingId)
        .select('id');
      if (!error) {
        const rid =
          (Array.isArray(data) && data[0]?.id) ||
          (data as any)?.id ||
          existingId;
        return { id: rid, error: null };
      }
      const m = String(error.message || '');
      const col =
        m.match(/Could not find the '([^']+)' column/i)?.[1] ||
        m.match(/column ["']?(\w+)["']? of relation/i)?.[1];
      if (col && col in body) {
        console.warn(`${table} missing column, retry without:`, col);
        delete body[col];
        continue;
      }
      // CHAR(3) / value-too-long — omit the field instead of toasting
      if (/value too long|character\(3\)|char\(3\)/i.test(m)) {
        let strippedChar = false;
        for (const key of ['customer_state', 'state', 'tech_company_state']) {
          if (key in body) {
            delete body[key];
            strippedChar = true;
          }
        }
        if (strippedChar) continue;
      }
      // Broad optional strips used by Android
      let stripped = false;
      if (/estimate_number/i.test(m) && 'estimate_number' in body) {
        delete body.estimate_number;
        stripped = true;
      }
      if (/invoice_number/i.test(m) && 'invoice_number' in body) {
        delete body.invoice_number;
        stripped = true;
      }
      if (/po_number/i.test(m) && 'po_number' in body) {
        delete body.po_number;
        stripped = true;
      }
      if (/customer_organization/i.test(m) && 'customer_organization_id' in body) {
        delete body.customer_organization_id;
        stripped = true;
      }
      if (/estimate_id/i.test(m) && 'estimate_id' in body) {
        delete body.estimate_id;
        stripped = true;
      }
      if (/invoice_data/i.test(m) && 'invoice_data' in body) {
        delete body.invoice_data;
        stripped = true;
      }
      if (/estimate_data/i.test(m) && 'estimate_data' in body) {
        delete body.estimate_data;
        stripped = true;
      }
      if (stripped || /column|schema cache/i.test(m)) {
        if (stripped) continue;
      }
      return { id: existingId, error };
    }

    const { data, error } = await supabase.from(table).insert(body).select('id');
    if (!error) {
      const rid =
        (Array.isArray(data) && data[0]?.id) || (data as any)?.id || null;
      return { id: rid, error: null };
    }
    const m = String(error.message || '');
    const col =
      m.match(/Could not find the '([^']+)' column/i)?.[1] ||
      m.match(/column ["']?(\w+)["']? of relation/i)?.[1];
    if (col && col in body) {
      console.warn(`${table} missing column, retry without:`, col);
      delete body[col];
      continue;
    }
    if (/value too long|character\(3\)|char\(3\)/i.test(m)) {
      let strippedChar = false;
      for (const key of ['customer_state', 'state', 'tech_company_state']) {
        if (key in body) {
          delete body[key];
          strippedChar = true;
        }
      }
      if (strippedChar) continue;
    }
    let stripped = false;
    if (/estimate_number/i.test(m) && 'estimate_number' in body) {
      delete body.estimate_number;
      stripped = true;
    }
    if (/invoice_number/i.test(m) && 'invoice_number' in body) {
      delete body.invoice_number;
      stripped = true;
    }
    if (/customer_organization/i.test(m) && 'customer_organization_id' in body) {
      delete body.customer_organization_id;
      stripped = true;
    }
    if (/estimate_id/i.test(m) && 'estimate_id' in body) {
      delete body.estimate_id;
      stripped = true;
    }
    if (/invoice_data/i.test(m) && 'invoice_data' in body) {
      delete body.invoice_data;
      stripped = true;
    }
    if (/estimate_data/i.test(m) && 'estimate_data' in body) {
      delete body.estimate_data;
      stripped = true;
    }
    if (stripped) continue;
    return { id: null, error };
  }
  return { id: null, error: new Error(`Could not save ${table} after schema retries`) };
}

export const SERVICE_TYPES = [
  'Preventative Maintenance',
  'Flashlamp Replacement',
  'Laser Head',
  'Optic replacement',
  'Calibration',
  'Diagnostic',
  'Evaluation',
  'System Relocation',
  'Install/De-install',
  'Delivery System Repair/Replace',
  'Repair',
] as const;

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  'Preventative Maintenance': 'Routine PM Visit',
  'Flashlamp Replacement': 'Flashlamp(s) Replacement',
  'Laser Head': 'Laser Head Rebuild/Replacement',
  'Optic replacement': 'Optic replacement',
  Calibration: 'Calibration',
  Diagnostic: 'Diagnostic / Troubleshooting',
  Evaluation: 'Evaluation',
  'System Relocation': 'System Relocation',
  'Install/De-install': 'Install/De-install',
  'Delivery System Repair/Replace': 'Delivery System Repair/Replace',
  Repair: 'Repair (specify below)',
};

export const ESTIMATE_VALID_DAYS = 30;

export function estimateAgeDays(createdAt?: string | null): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

export function isEstimateExpired(est: { status?: string | null; created_at?: string | null }): boolean {
  const st = String(est.status || '').toLowerCase();
  if (st === 'expired') return true;
  if (st === 'invoiced' || st === 'cancelled' || st === 'completed') return false;
  return estimateAgeDays(est.created_at) >= ESTIMATE_VALID_DAYS;
}

export function validUntilLabel(createdAt?: string | null): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + ESTIMATE_VALID_DAYS);
  return d.toLocaleDateString();
}

export type CustomerActionKind = 'approved' | 'rejected' | 'changes_requested';
export type EstimateEmailAction = 'approve' | 'reject' | 'modify';

export const CUSTOMER_ACTION_KINDS: readonly CustomerActionKind[] = [
  'approved',
  'rejected',
  'changes_requested',
];

/** Map email / API aliases onto the stored customer_action value. */
export function parseCustomerActionKind(raw: unknown): CustomerActionKind | null {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'approved' || v === 'approve') return 'approved';
  if (v === 'rejected' || v === 'reject') return 'rejected';
  if (
    v === 'changes_requested' ||
    v === 'request_changes' ||
    v === 'modify' ||
    v === 'modification_requested' ||
    v === 'modification'
  ) {
    return 'changes_requested';
  }
  return null;
}

export function parseEstimateEmailAction(raw: unknown): EstimateEmailAction | null {
  const kind = parseCustomerActionKind(raw);
  if (kind === 'approved') return 'approve';
  if (kind === 'rejected') return 'reject';
  if (kind === 'changes_requested') return 'modify';
  return null;
}

export function isTerminalCustomerAction(action: CustomerActionKind | null | undefined): boolean {
  return action === 'approved' || action === 'rejected';
}

/**
 * Same-action re-clicks are idempotent. Approved / rejected are terminal.
 * A prior modification request can still be followed by approve or reject.
 */
export function resolveCustomerActionApply(
  previous: CustomerActionKind | null | undefined,
  next: CustomerActionKind
): { already: boolean; apply: boolean; conflict: boolean } {
  if (!previous) return { already: false, apply: true, conflict: false };
  if (previous === next) return { already: true, apply: false, conflict: false };
  if (isTerminalCustomerAction(previous)) {
    return { already: true, apply: false, conflict: true };
  }
  return { already: false, apply: true, conflict: false };
}

/** Read customer CTA response without treating it as the estimate status. */
export function customerActionFromEstimate(est: {
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
  estimate_data?: unknown;
}): {
  action: CustomerActionKind | null;
  at: string | null;
  note: string | null;
  token: string | null;
} {
  const ed = parseJsonField(est.estimate_data);
  const action = parseCustomerActionKind(est.customer_action || ed.customer_action);
  const token = String(est.customer_action_token || ed.customer_action_token || '').trim() || null;
  const at = est.customer_action_at || ed.customer_action_at || null;
  const note = est.customer_action_note || ed.customer_action_note || null;
  return {
    action,
    at: at ? String(at) : null,
    note: note != null && String(note).trim() ? String(note) : null,
    token,
  };
}

export function customerActionLabel(action: CustomerActionKind | null | undefined): string {
  if (action === 'approved') return 'Approved';
  if (action === 'rejected') return 'Rejected';
  if (action === 'changes_requested') return 'Modification requested';
  return '';
}

export function customerActionConfirmationTitle(
  action: CustomerActionKind | null | undefined
): string {
  if (action === 'approved') return 'Estimate approved';
  if (action === 'rejected') return 'Estimate rejected';
  if (action === 'changes_requested') return 'Modification requested';
  return '';
}

/** Sent estimates the clinic can still Approve / Reject / Modify. */
export function isEstimateAwaitingCustomerAction(est: {
  status?: string | null;
  created_at?: string | null;
  customer_action?: string | null;
  customer_action_at?: string | null;
  customer_action_note?: string | null;
  customer_action_token?: string | null;
  estimate_data?: unknown;
}): boolean {
  const st = String(est.status || '').toLowerCase();
  if (['draft', 'invoiced', 'cancelled', 'canceled', 'completed', 'expired'].includes(st)) {
    return false;
  }
  if (isEstimateExpired(est)) return false;
  return !isTerminalCustomerAction(customerActionFromEstimate(est).action);
}
