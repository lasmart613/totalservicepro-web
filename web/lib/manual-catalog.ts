/**
 * Manual library catalog labels.
 *
 * Larry’s mapping (PR #70 preview):
 * - Title essentially **"VBeam"** (V-Beam / Vbeam, no model suffix) is the
 *   Operator’s Manual → OP badge + “Operator’s Manual”.
 * - Title **"VBeam Perfecta"** (and other model-specific VBeam titles:
 *   Platinum, Aesthetica, 2, …) is a Service Manual → no OP badge.
 * Do not blanket-remap the VBeam family. Do not require the stored title
 * to already contain the words “Operator’s Manual”.
 *
 * If the stored title already says Service Manual, leave it service.
 * If it already says Operator / User Manual, keep OP.
 * Do not scrape or replace PDFs.
 */

export type ManualDocKind = 'service' | 'operator' | 'user' | 'technical' | 'parts';

export type ManualCatalogFields = {
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
  doc_kind?: string | null;
  is_incomplete?: unknown;
  isIncomplete?: unknown;
  completeness_note?: string | null;
  /** First-page PDF text when reachable without an org login. Never fetched from live orgs. */
  pdfText?: string | null;
};

const KIND_LABEL: Record<ManualDocKind, string> = {
  service: 'Service Manual',
  operator: "Operator's Manual",
  user: 'User Manual',
  technical: 'Technical Manual',
  parts: 'Parts Manual',
};

const EXPLICIT_KINDS = new Set<string>(Object.keys(KIND_LABEL));

const OPERATOR_RE = /operator'?s?\s+manual|\boperator\s+manual\b/i;
const USER_RE = /\buser\s+manual\b/i;
const SERVICE_RE = /\bservice\s+manuals?\b|\btechnical\s+manuals?\b|\brepair\s+manuals?\b/i;
const REPAIR_RE = /\brepair\b/i;
/** Model suffixes that mean a specific VBeam platform (service docs), not the bare "VBeam" operator row. */
const VBEAM_MODEL_SUFFIX_RE = /\b(perfecta|platinum|aesthetica|classic|pro|[0-9]+)\b/i;

export function normalizeManualDocKind(raw: string | null | undefined): ManualDocKind | null {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  if (k === "operator's" || k === 'operators') return 'operator';
  return EXPLICIT_KINDS.has(k) ? (k as ManualDocKind) : null;
}

/** Candela VBeam family (identity only — does not decide document type). */
export function isVbeamFamily(manual: ManualCatalogFields): boolean {
  const hay = [manual.title, manual.model, manual.storage_path, manual.brand]
    .map((s) => String(s || ''))
    .join(' ');
  if (/v[\s_-]*beam/i.test(hay)) return true;
  if (/perfecta|aesthetica/i.test(hay) && /candela|pulsed\s*dye|\bpdl\b/i.test(hay)) return true;
  if (/platinum/i.test(hay) && /candela/i.test(hay) && /dye|595|\bpdl\b/i.test(hay)) return true;
  return false;
}

function strippedBrandPrefix(title: string): string {
  return String(title || '')
    .replace(/^\s*syneron(?:\s*candela)?\b[\s\-:\/]*/i, '')
    .replace(/^\s*candela\b[\s\-:\/]*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Catalog title is just VBeam / V-Beam / Vbeam (optional Candela prefix),
 * with no Perfecta / Platinum / Aesthetica / 2 / … suffix.
 */
export function isBareVbeamOperatorTitle(title: string | null | undefined): boolean {
  const t = strippedBrandPrefix(String(title || ''));
  if (!t || VBEAM_MODEL_SUFFIX_RE.test(t)) return false;
  return /^v[\s_-]*beam$/i.test(t);
}

/** VBeam + a model/trim word — Larry: these are service docs (e.g. VBeam Perfecta). */
export function isVbeamModelSpecificTitle(title: string | null | undefined): boolean {
  const t = strippedBrandPrefix(String(title || ''));
  return /v[\s_-]*beam/i.test(t) && VBEAM_MODEL_SUFFIX_RE.test(t);
}

/**
 * Type from title / path / PDF cover text. Service+operator in the same
 * string → service (when in doubt, do not apply OP).
 */
export function inferKindFromDocumentText(text: string | null | undefined): ManualDocKind | null {
  const hay = String(text || '').trim();
  if (!hay) return null;
  const hasOperator = OPERATOR_RE.test(hay);
  const hasUser = USER_RE.test(hay);
  const hasService = SERVICE_RE.test(hay) || REPAIR_RE.test(hay);
  if (hasService && !hasOperator && !hasUser) {
    if (/\btechnical\s+manuals?\b/i.test(hay)) return 'technical';
    return 'service';
  }
  if ((hasOperator || hasUser) && !hasService) return 'operator';
  if (hasService && (hasOperator || hasUser)) return 'service';
  return null;
}

/**
 * Document type for library UI.
 * 1) Type words on the stored title win (Service Manual vs Operator/User).
 * 2) Bare "VBeam" (no model suffix) is the operator PDF.
 * 3) "VBeam Perfecta" and other model-specific VBeam titles are service.
 * Path / PDF text do not override those two named rows.
 */
export function catalogManualKind(manual: ManualCatalogFields): ManualDocKind {
  const fromTitle = inferKindFromDocumentText(manual.title);
  if (fromTitle) return fromTitle;

  if (isBareVbeamOperatorTitle(manual.title)) return 'operator';
  if (isVbeamModelSpecificTitle(manual.title)) return 'service';

  const fromPath = inferKindFromDocumentText(manual.storage_path);
  if (fromPath) return fromPath;

  const fromPdf = inferKindFromDocumentText(manual.pdfText);
  if (fromPdf) return fromPdf;

  const explicit = normalizeManualDocKind(manual.doc_kind);
  if (explicit === 'service' || explicit === 'technical' || explicit === 'parts') return explicit;
  if (explicit === 'user') return 'operator';
  return 'service';
}

export function catalogManualKindLabel(kind: ManualDocKind): string {
  return KIND_LABEL[kind];
}

/** Stored title, plus “Operator's Manual” when this row is the bare-VBeam operator PDF. */
export function catalogManualTitle(manual: ManualCatalogFields): string {
  const raw = String(manual.title || '').trim() || 'Manual';
  const kind = catalogManualKind(manual);
  if (kind !== 'operator') return raw;
  if (OPERATOR_RE.test(raw) || USER_RE.test(raw)) return raw;
  return `${raw} Operator's Manual`;
}

export function presentManual<T extends ManualCatalogFields>(manual: T): T & {
  displayTitle: string;
  docKind: ManualDocKind;
  docKindLabel: string;
} {
  const docKind = catalogManualKind(manual);
  return {
    ...manual,
    displayTitle: catalogManualTitle(manual),
    docKind,
    docKindLabel: catalogManualKindLabel(docKind),
  };
}

/** OP badge only when the document is actually an operator/user manual. */
export function showOperatorBadge(manual: ManualCatalogFields): boolean {
  return catalogManualKind(manual) === 'operator';
}

/** Incomplete badge from the durable manuals.is_incomplete flag — not a title hardcode. */
export function isManualIncomplete(manual: ManualCatalogFields | null | undefined): boolean {
  const v = manual?.is_incomplete ?? manual?.isIncomplete;
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 't') return true;
  if (String(manual?.completeness_note || '').trim()) return true;
  return false;
}

export function showIncompleteBadge(manual: ManualCatalogFields | null | undefined): boolean {
  return isManualIncomplete(manual);
}
