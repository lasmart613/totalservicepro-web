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
 * If it already says Operator / User Manual / IFU / Instruction Manual /
 * Operating Instructions, keep OP.
 * Hybrid Operator & Service / Operator / Service stays Service (no OP).
 * Do not scrape or replace PDFs.
 */

export type ManualDocKind = 'service' | 'operator' | 'user' | 'technical' | 'parts';

/** Which public library a row belongs on. Technical/parts stay with Service. */
export type ManualLibraryShelf = 'service' | 'operators';

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
const IFU_RE = /\bifu\b|instructions?\s+for\s+use/i;
/** User-facing instruction titles (not “Service Instruction Manual”). */
const OPERATING_INSTRUCTIONS_RE = /\boperating\s+instructions?\b/i;
const INSTRUCTION_MANUAL_RE = /\b(?:user\s+)?instruction\s+manuals?\b/i;
/** Dutch IFU / user instructions (e.g. Siemens SONOLINE Antares). */
const GEBRUIK_RE = /\bgebruiksaanwijzing\b/i;
/** Service/technical/repair manuals, including “Service Instruction Manual”. */
const SERVICE_RE = /\b(?:service|technical|repair)\s+(?:instruction\s+)?manuals?\b/i;
const REPAIR_RE = /\brepair\b/i;
/** Combined Operator & Service / Operator / Service docs stay on the Service shelf. */
const HYBRID_RE =
  /\boperator(?:'?s|s)?\b\s*(?:\/|&|and)\s*service\b|\bservice\b\s*(?:\/|&|and)\s*operator(?:'?s|s)?\b/i;
/** “not service manual” / “not full SM” must not count as a service signal. */
const SERVICE_NEGATION_RE = /\bnot\s+(?:a(?:n)?\s+|the\s+|full\s+)*(?:service\s+manuals?|sm)\b/gi;
/** Cited OP-in-SM-shelf row: Operators content filed on the Service Manuals shelf. */
const LYRA_767_RE = /\blyra\s*[-_/]?\s*767\b/i;
/** Model suffixes that mean a specific VBeam platform (service docs), not the bare "VBeam" operator row. */
const VBEAM_MODEL_SUFFIX_RE = /\b(perfecta|platinum|aesthetica|classic|pro|[0-9]+)\b/i;

function stripNegatedServicePhrases(text: string): string {
  return text.replace(SERVICE_NEGATION_RE, ' ').replace(/\s+/g, ' ').trim();
}

function hasOperatorFacingSignal(hay: string): boolean {
  return (
    OPERATOR_RE.test(hay) ||
    USER_RE.test(hay) ||
    IFU_RE.test(hay) ||
    OPERATING_INSTRUCTIONS_RE.test(hay) ||
    INSTRUCTION_MANUAL_RE.test(hay) ||
    GEBRUIK_RE.test(hay)
  );
}

function hasServicePrimarySignal(hay: string): boolean {
  return SERVICE_RE.test(hay) || REPAIR_RE.test(hay);
}

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
 * IFU / Instructions for Use / Operating Instructions / Instruction Manual
 * count as Operators (user-facing), not Service — unless Service/Repair/
 * Technical is the primary type (e.g. “Service Instruction Manual”).
 * Negations such as “not service manual” / “not full SM” are ignored.
 */
export function inferKindFromDocumentText(text: string | null | undefined): ManualDocKind | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const hay = stripNegatedServicePhrases(raw);
  if (!hay) return null;
  const hasOperator = hasOperatorFacingSignal(hay);
  const hasService = hasServicePrimarySignal(hay);
  if (HYBRID_RE.test(hay) || (hasService && hasOperator)) return 'service';
  if (hasService) {
    if (/\btechnical\s+manuals?\b/i.test(hay)) return 'technical';
    return 'service';
  }
  if (hasOperator) return 'operator';
  return null;
}

/** Operators content that has been sitting on the Service Manuals shelf. */
export function isKnownMisShelvedOperator(manual: ManualCatalogFields): boolean {
  const hay = [manual.title, manual.model, manual.storage_path, manual.brand]
    .map((s) => String(s || ''))
    .join(' ');
  return LYRA_767_RE.test(hay);
}

function explicitCatalogKind(manual: ManualCatalogFields): ManualDocKind | null {
  const explicit = normalizeManualDocKind(manual.doc_kind);
  if (explicit === 'service' || explicit === 'technical' || explicit === 'parts') return explicit;
  if (explicit === 'operator' || explicit === 'user') return 'operator';
  return null;
}

/**
 * Document type for library UI.
 * 1) Known OP-in-SM-shelf rows (e.g. Lyra 767) go to Operators.
 * 2) Type words on the stored title win (Service Manual vs Operator/User/IFU/
 *    Instruction Manual / Operating Instructions). Hybrids stay service.
 * 3) Bare "VBeam" (no model suffix) is the operator PDF.
 * 4) "VBeam Perfecta" and other model-specific VBeam titles are service.
 * 5) Stored doc_kind (including operator) when title/VBeam rules do not decide.
 * Path / PDF text do not override those named rows.
 */
export function catalogManualKind(manual: ManualCatalogFields): ManualDocKind {
  if (isKnownMisShelvedOperator(manual)) return 'operator';

  const fromTitle = inferKindFromDocumentText(manual.title);
  if (fromTitle) return fromTitle;

  if (isBareVbeamOperatorTitle(manual.title)) return 'operator';
  if (isVbeamModelSpecificTitle(manual.title)) return 'service';

  const explicit = explicitCatalogKind(manual);
  if (explicit) return explicit;

  const fromPath = inferKindFromDocumentText(manual.storage_path);
  if (fromPath) return fromPath;

  const fromPdf = inferKindFromDocumentText(manual.pdfText);
  if (fromPdf) return fromPdf;

  return 'service';
}

export function isOperatorDocKind(kind: ManualDocKind): boolean {
  return kind === 'operator' || kind === 'user';
}

export function manualLibraryShelf(manual: ManualCatalogFields): ManualLibraryShelf {
  return isOperatorDocKind(catalogManualKind(manual)) ? 'operators' : 'service';
}

export function manualLibraryShelfLabel(shelf: ManualLibraryShelf): string {
  return shelf === 'operators' ? 'Operators Manuals' : 'Service Manuals';
}

export function catalogManualKindLabel(kind: ManualDocKind): string {
  return KIND_LABEL[kind];
}

/** Stored title, plus “Operator's Manual” when this row is the bare-VBeam operator PDF. */
export function catalogManualTitle(manual: ManualCatalogFields): string {
  const raw = String(manual.title || '').trim() || 'Manual';
  const kind = catalogManualKind(manual);
  if (kind !== 'operator') return raw;
  if (hasOperatorFacingSignal(raw)) return raw;
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
