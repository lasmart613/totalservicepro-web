/**
 * Manual library catalog labels.
 *
 * Rows live in production `public.manuals` (not a repo seed JSON). The web
 * bookshelf, AI picker, and Android library all show `manuals.title` as the
 * document name. This overlay corrects known mislabels so we do not present
 * the wrong document type while the production title is still wrong.
 *
 * Larry confirmed on live repairplanet.net: the Candela VBeam PDF in the
 * Service Manual Library is an Operator's Manual, not a Service Manual.
 * Do not scrape or replace that PDF.
 *
 * Escape hatch: set `doc_kind = 'service'` on a future real VBeam service
 * manual and this overlay will leave it alone.
 */

export type ManualDocKind = 'service' | 'operator' | 'user' | 'technical' | 'parts';

export type ManualCatalogFields = {
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
  doc_kind?: string | null;
};

const KIND_LABEL: Record<ManualDocKind, string> = {
  service: 'Service Manual',
  operator: "Operator's Manual",
  user: 'User Manual',
  technical: 'Technical Manual',
  parts: 'Parts Manual',
};

const EXPLICIT_KINDS = new Set<string>(Object.keys(KIND_LABEL));

export function normalizeManualDocKind(raw: string | null | undefined): ManualDocKind | null {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  if (k === "operator's" || k === 'operators') return 'operator';
  return EXPLICIT_KINDS.has(k) ? (k as ManualDocKind) : null;
}

/** Candela VBeam / VBeam 2 (Perfecta, Platinum, Aesthetica) / V-Beam 1. */
export function isVbeamFamily(manual: ManualCatalogFields): boolean {
  const hay = [manual.title, manual.model, manual.storage_path, manual.brand]
    .map((s) => String(s || ''))
    .join(' ');
  if (/v[\s_-]*beam/i.test(hay)) return true;
  // VBeam 2 trims are sometimes stored as Perfecta / Aesthetica without "VBeam"
  if (/perfecta|aesthetica/i.test(hay) && /candela|pulsed\s*dye|\bpdl\b/i.test(hay)) return true;
  if (/platinum/i.test(hay) && /candela/i.test(hay) && /dye|595|\bpdl\b/i.test(hay)) return true;
  return false;
}

/**
 * Document type for library UI. Explicit `doc_kind` wins. Otherwise VBeam
 * family defaults to operator (known catalog error), not service.
 */
export function catalogManualKind(manual: ManualCatalogFields): ManualDocKind {
  const explicit = normalizeManualDocKind(manual.doc_kind);
  if (explicit) return explicit;

  const title = String(manual.title || '');
  if (/operator'?s?\s+manual/i.test(title)) return 'operator';
  if (/\buser\s+manual/i.test(title)) return 'user';
  if (/\btechnical\s+manual/i.test(title)) return 'technical';
  if (/\bparts\s+manual/i.test(title)) return 'parts';
  if (isVbeamFamily(manual)) return 'operator';
  if (/\bservice\s+manual/i.test(title)) return 'service';
  return 'service';
}

export function catalogManualKindLabel(kind: ManualDocKind): string {
  return KIND_LABEL[kind];
}

/** Title shown in the library, add-to-library prompt, and viewer chrome. */
export function catalogManualTitle(manual: ManualCatalogFields): string {
  const raw = String(manual.title || '').trim();
  const kind = catalogManualKind(manual);
  if (kind !== 'operator') return raw || 'Manual';

  if (/operator'?s?\s+manual/i.test(raw) && !/\bservice\s+manuals?\b/i.test(raw)) {
    return raw;
  }

  if (/\b(service|user|technical)\s+manuals?\b/i.test(raw)) {
    return raw
      .replace(/\b(service|user|technical)\s+manuals?\b/gi, "Operator's Manual")
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  if (!raw) return "VBeam Operator's Manual";
  return `${raw.replace(/\s+$/, '')} Operator's Manual`;
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
