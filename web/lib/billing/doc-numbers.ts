/**
 * Universal document numbering for tickets, service reports, estimates, invoices.
 * Format: {ORG_PREFIX}-{KIND}-{YYYYMMDD}-{NN}
 * Example: LPX-INV-20260724-01
 *
 * Ported from Android assets/doc-numbers.js (source of truth for sequence rules).
 * Sequence advances per org + day by scanning saved numbers (column + JSON fallbacks).
 */

export type DocKind = 'TKT' | 'SR' | 'EST' | 'INV';

export const DOC_KIND = {
  TKT: 'TKT',
  SR: 'SR',
  EST: 'EST',
  INV: 'INV',
} as const;

/** Minimal Supabase-like client surface used by this module. */
export type DocNumberClient = {
  from: (table: string) => any;
};

export type GenerateDocNumberOpts = {
  orgId?: string | number | null;
  kind?: DocKind | string;
  date?: string | Date | null;
  /** Keep existing number if already assigned */
  existing?: string | null;
  client?: DocNumberClient | null;
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

export function ymdFrom(dateLike?: string | Date | null): string {
  let d: Date;
  if (!dateLike) d = new Date();
  else if (dateLike instanceof Date) d = dateLike;
  else {
    const s = String(dateLike).trim();
    if (/^\d{8}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10).replace(/-/g, '');
    }
    d = new Date(s);
    if (isNaN(d.getTime())) d = new Date();
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function sanitizePrefix(raw?: string | null, orgName?: string | null): string {
  let p = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!p && orgName) {
    p = String(orgName)
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 3)
      .toUpperCase();
  }
  if (!p) p = 'TSP';
  return p.slice(0, 8);
}

export async function getOrgDocPrefix(
  orgId: string | number | null | undefined,
  client: DocNumberClient | null | undefined
): Promise<string> {
  const sb = client || null;
  const id = coerceOrgId(orgId);
  if (!sb || id == null) return 'TSP';
  try {
    const res = await sb
      .from('organizations')
      .select('ticket_prefix, name')
      .eq('id', id)
      .maybeSingle();
    if (res?.data) return sanitizePrefix(res.data.ticket_prefix, res.data.name);
  } catch (e) {
    console.warn('DocNumbers.getOrgDocPrefix', e);
  }
  return 'TSP';
}

function parseSeq(num: string, stem: string): number {
  if (!num || !stem) return 0;
  const s = String(num).trim().toUpperCase();
  const st = String(stem).trim().toUpperCase();
  if (s.indexOf(st) === 0) {
    const rest = s.slice(st.length);
    const n = parseInt(rest, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const m = s.match(/-(\d{1,4})$/);
  if (m && s.indexOf(st.replace(/-$/, '')) >= 0) {
    const n2 = parseInt(m[1], 10);
    return Number.isFinite(n2) && n2 > 0 ? n2 : 0;
  }
  return 0;
}

function extractNumberFromRow(row: any, kind: string): string {
  if (!row) return '';
  if (kind === 'TKT') return row.ticket_number || '';
  if (kind === 'SR') return row.report_number || '';
  if (kind === 'EST') {
    let ed = row.estimate_data;
    if (typeof ed === 'string') {
      try {
        ed = JSON.parse(ed);
      } catch {
        ed = {};
      }
    }
    return row.estimate_number || (ed && (ed.estimate_number || ed.estNumber)) || '';
  }
  if (kind === 'INV') {
    let idata = row.invoice_data;
    if (typeof idata === 'string') {
      try {
        idata = JSON.parse(idata);
      } catch {
        idata = {};
      }
    }
    return row.invoice_number || (idata && (idata.invoice_number || idata.invNumber)) || '';
  }
  return '';
}

function considerRows(rows: any[] | null | undefined, kind: string, stem: string, maxSeq: number): number {
  (rows || []).forEach((r) => {
    maxSeq = Math.max(maxSeq, parseSeq(extractNumberFromRow(r, kind), stem));
  });
  return maxSeq;
}

async function nextSequence(
  sb: DocNumberClient,
  orgId: string | number | null,
  kind: string,
  stem: string
): Promise<number> {
  let maxSeq = 0;
  const id = coerceOrgId(orgId);
  try {
    if (kind === 'TKT') {
      const t = await sb
        .from('service_tickets')
        .select('ticket_number')
        .eq('organization_id', id)
        .ilike('ticket_number', stem + '%')
        .limit(200);
      maxSeq = considerRows(t.data, kind, stem, maxSeq);
      const t2 = await sb
        .from('service_tickets')
        .select('ticket_number')
        .ilike('ticket_number', stem + '%')
        .limit(100);
      maxSeq = considerRows(t2.data, kind, stem, maxSeq);
    } else if (kind === 'SR') {
      const sr = await sb
        .from('service_reports')
        .select('report_number')
        .eq('organization_id', id)
        .ilike('report_number', stem + '%')
        .limit(200);
      maxSeq = considerRows(sr.data, kind, stem, maxSeq);
      const sr2 = await sb
        .from('service_reports')
        .select('report_number')
        .ilike('report_number', stem + '%')
        .limit(100);
      maxSeq = considerRows(sr2.data, kind, stem, maxSeq);
    } else if (kind === 'EST') {
      let est = await sb
        .from('service_estimates')
        .select('estimate_number, estimate_data, organization_id, created_at')
        .eq('organization_id', id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (est.error) {
        est = await sb
          .from('service_estimates')
          .select('estimate_data, organization_id, created_at')
          .eq('organization_id', id)
          .order('created_at', { ascending: false })
          .limit(200);
      }
      maxSeq = considerRows(est.data, kind, stem, maxSeq);
      try {
        const est2 = await sb
          .from('service_estimates')
          .select('estimate_number, estimate_data, created_at')
          .ilike('estimate_number', stem + '%')
          .order('created_at', { ascending: false })
          .limit(100);
        maxSeq = considerRows(est2.data, kind, stem, maxSeq);
      } catch {
        /* column may not exist */
      }
      try {
        const est3 = await sb
          .from('service_estimates')
          .select('estimate_number, estimate_data, created_at')
          .order('created_at', { ascending: false })
          .limit(120);
        maxSeq = considerRows(est3.data, kind, stem, maxSeq);
      } catch {
        /* ignore */
      }
    } else if (kind === 'INV') {
      let inv = await sb
        .from('service_invoices')
        .select('invoice_number, invoice_data, organization_id, created_at')
        .eq('organization_id', id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (inv.error) {
        inv = await sb
          .from('service_invoices')
          .select('invoice_data, organization_id, created_at')
          .eq('organization_id', id)
          .order('created_at', { ascending: false })
          .limit(200);
      }
      maxSeq = considerRows(inv.data, kind, stem, maxSeq);
      try {
        const inv2 = await sb
          .from('service_invoices')
          .select('invoice_number, invoice_data, created_at')
          .ilike('invoice_number', stem + '%')
          .order('created_at', { ascending: false })
          .limit(100);
        maxSeq = considerRows(inv2.data, kind, stem, maxSeq);
      } catch {
        /* ignore */
      }
      try {
        const inv3 = await sb
          .from('service_invoices')
          .select('invoice_number, invoice_data, created_at')
          .order('created_at', { ascending: false })
          .limit(120);
        maxSeq = considerRows(inv3.data, kind, stem, maxSeq);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('DocNumbers.nextSequence', e);
  }
  return maxSeq + 1;
}

/**
 * Generate next document number.
 *
 * Supports both call styles used in the codebase:
 *   generateDocNumber(supabase, { orgId, kind, date })
 *   generateDocNumber({ orgId, kind, date, client })
 */
export async function generateDocNumber(
  clientOrOpts: DocNumberClient | GenerateDocNumberOpts,
  maybeOpts?: GenerateDocNumberOpts
): Promise<string> {
  let opts: GenerateDocNumberOpts;
  if (maybeOpts != null && clientOrOpts && typeof (clientOrOpts as DocNumberClient).from === 'function') {
    opts = { ...maybeOpts, client: clientOrOpts as DocNumberClient };
  } else {
    opts = (clientOrOpts as GenerateDocNumberOpts) || {};
  }

  if (opts.existing && String(opts.existing).trim()) {
    return String(opts.existing).trim();
  }

  let kind = String(opts.kind || 'INV').toUpperCase();
  if (!(kind in DOC_KIND)) kind = 'INV';

  const sb = opts.client || null;
  const orgId = coerceOrgId(opts.orgId);
  const prefix = await getOrgDocPrefix(orgId, sb);
  const ymd = ymdFrom(opts.date);
  const stem = `${prefix}-${kind}-${ymd}-`;

  let seq = 1;
  if (sb && orgId != null) {
    seq = await nextSequence(sb, orgId, kind, stem);
  } else if (sb) {
    seq = await nextSequence(sb, 0, kind, stem);
    if (seq <= 1) {
      seq = (new Date().getHours() * 60 + new Date().getMinutes()) % 90 + 1;
    }
  } else {
    seq = (new Date().getHours() * 60 + new Date().getMinutes()) % 99 + 1;
  }

  const pad = seq < 100 ? 2 : String(seq).length;
  return stem + String(seq).padStart(pad, '0');
}

const DocNumbers = {
  KIND: DOC_KIND,
  ymdFrom,
  sanitizePrefix,
  getOrgDocPrefix,
  generateDocNumber,
};

export default DocNumbers;
