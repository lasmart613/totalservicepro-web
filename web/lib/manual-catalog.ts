/**
 * Manual library catalog labels.
 *
 * Rows live in production `public.manuals` (not a repo seed JSON). The
 * bookshelf shows `manuals.title` and an OP badge when the document is an
 * Operator's Manual.
 *
 * Larry (live repairplanet.net after #69): do NOT blanket-remap every
 * VBeam / Perfecta / Platinum / Aesthetica title. Real VBeam Service
 * Manuals stay Service Manual with no OP badge. Only the document whose
 * title (or PDF first pages, when we have that text) already says
 * Operator / Operator's / User Manual gets OP + Operator's Manual.
 *
 * When the title already says Service Manual / Technical Manual / repair,
 * treat as service — never retitle those to Operator's Manual.
 * Do not scrape or replace PDFs. Do not infer type from brand/model alone.
 */

export type ManualDocKind = 'service' | 'operator' | 'user' | 'technical' | 'parts';

export type ManualCatalogFields = {
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
  doc_kind?: string | null;
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
 * Document type for library UI. Title / path / PDF text decide.
 * Brand or "this is a VBeam" never implies operator.
 * A blanket `doc_kind = operator` without title evidence is ignored
 * (that was the #69 SQL mistake).
 */
export function catalogManualKind(manual: ManualCatalogFields): ManualDocKind {
  const fromTitle = inferKindFromDocumentText(manual.title);
  if (fromTitle) return fromTitle;

  const fromPath = inferKindFromDocumentText(manual.storage_path);
  if (fromPath) return fromPath;

  const fromPdf = inferKindFromDocumentText(manual.pdfText);
  if (fromPdf) return fromPdf;

  const explicit = normalizeManualDocKind(manual.doc_kind);
  if (explicit === 'service' || explicit === 'technical' || explicit === 'parts') return explicit;
  if (explicit === 'user') return 'operator';
  // explicit === 'operator' with no title/path/PDF evidence: do not badge OP
  return 'service';
}

export function catalogManualKindLabel(kind: ManualDocKind): string {
  return KIND_LABEL[kind];
}

/** Display title: stored title as-is. Never rewrite Service Manual → Operator's Manual. */
export function catalogManualTitle(manual: ManualCatalogFields): string {
  return String(manual.title || '').trim() || 'Manual';
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
