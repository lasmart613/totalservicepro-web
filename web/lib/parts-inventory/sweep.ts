/**
 * Resumable manuals BOM sweep.
 *
 * Order: Candela Mini GentleYAG (VP YAG) first, then other Candela manuals,
 * then the rest of the library. One batch is 50–100 manuals. Already
 * extracted or confirmed no-BOM rows are skipped, so a rerun continues
 * where the last batch stopped.
 */

import { isStockedBomPart, sectionForDescription, type BomLine } from './bom.ts';
import { normalizeMpn } from './mpn.ts';

export const SWEEP_BATCH_DEFAULT = 75;
export const SWEEP_BATCH_MIN = 50;
export const SWEEP_BATCH_MAX = 100;

export const MINI_GENTLEYAG_MANUAL = {
  libraryId: 9,
  brand: 'Candela',
  model: 'vpyag',
  title: 'Mini GentleYAG (VPYag)',
  document: '8501-01-1769 Revision B',
  priority: 0,
} as const;

export type SweepStatus = 'pending' | 'no_bom' | 'extracted' | 'error';

export type SweepManual = {
  manual_id: number;
  brand?: string | null;
  model?: string | null;
  title?: string | null;
  status?: SweepStatus | null;
  priority?: number | null;
};

export type SweepProgress = SweepManual & {
  status: SweepStatus;
  priority: number;
  parts_added?: number;
  bom_lines_added?: number;
  attempts?: number;
  last_error?: string | null;
};

export function sweepPriority(manual: {
  brand?: string | null;
  model?: string | null;
  title?: string | null;
}): number {
  const blob = `${manual.brand || ''} ${manual.model || ''} ${manual.title || ''}`.toLowerCase();
  const compact = blob.replace(/[^a-z0-9]+/g, '');
  if (
    compact.includes('vpyag') ||
    compact.includes('pvyag') ||
    compact.includes('minigentleyag') ||
    /mini\s*gentle\s*yag|vp[\s-]*yag/.test(blob)
  ) {
    return 0;
  }
  if (blob.includes('candela')) return 10;
  return 100;
}

export function clampBatchSize(size: number | null | undefined): number {
  const n = Number(size);
  if (!Number.isFinite(n)) return SWEEP_BATCH_DEFAULT;
  return Math.min(SWEEP_BATCH_MAX, Math.max(SWEEP_BATCH_MIN, Math.trunc(n)));
}

/** Pending and errored manuals. Manual 9 (Mini GentleYAG) blocks every other manual until it is extracted or marked no BOM. */
export function planSweepBatch(manuals: SweepProgress[], batchSize = SWEEP_BATCH_DEFAULT): SweepProgress[] {
  const size = clampBatchSize(batchSize);
  const eligible = manuals
    .filter((row) => row.status === 'pending' || row.status === 'error')
    .map((row) => ({ ...row, priority: row.priority ?? sweepPriority(row) }))
    .sort((a, b) => a.priority - b.priority || a.manual_id - b.manual_id);
  const gate = eligible.filter((row) => row.priority === 0 || row.manual_id === MINI_GENTLEYAG_MANUAL.libraryId);
  return (gate.length ? gate : eligible).slice(0, size);
}

export function scoreBomText(text: string): { score: number; hasBom: boolean } {
  const body = String(text || '');
  const partHits = body.match(/\b\d{4}-\d{2}-\d{3,4}\b/g)?.length || 0;
  const cues = (body.match(/parts list|item\s+qty|bill of material|\bBOM\b|R=\s*\.?/gi) || []).length;
  const score = partHits + cues * 5;
  return { score, hasBom: partHits >= 3 && cues >= 1 };
}

const BOM_ROW = /(\d{4}-\d{2}-\d{3,4})\s+((?:(?!\d{4}-\d{2}-\d{3,4}|R=).){3,100}?)\s+R=\s*\.?\s*([0-9A-Z.]{1,6})\s+(\d+)/g;

/** Every structured BOM row in a manual extract. Does not stop after a sample section. */
export function extractBomLines(text: string, brand = 'Candela'): BomLine[] {
  const seen = new Set<string>();
  const lines: BomLine[] = [];
  const body = String(text || '');
  for (const match of body.matchAll(BOM_ROW)) {
    const mpn = match[1];
    const description = match[2].replace(/\s+/g, ' ').trim().replace(/[,.\s]+$/g, '');
    if (!isStockedBomPart(mpn, description)) continue;
    const key = normalizeMpn(mpn);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const qty = Number(match[4]);
    lines.push({
      mpn,
      description,
      section: sectionForDescription(mpn, description),
      lineRef: mpn,
      qtyPerAssembly: Number.isFinite(qty) && qty > 0 ? qty : null,
      brand,
    });
  }
  return lines;
}

export function newCatalogLines(existingMpns: Iterable<string>, lines: BomLine[]): BomLine[] {
  const have = new Set([...existingMpns].map((pn) => normalizeMpn(pn)));
  return lines.filter((line) => !have.has(normalizeMpn(line.mpn)));
}

export function applySweepOutcome(
  row: SweepProgress,
  outcome: { lines: BomLine[]; error?: string | null },
): SweepProgress {
  const attempts = (row.attempts || 0) + 1;
  if (outcome.error) {
    return {
      ...row,
      status: 'error',
      attempts,
      last_error: outcome.error.slice(0, 500),
      parts_added: row.parts_added || 0,
      bom_lines_added: row.bom_lines_added || 0,
    };
  }
  if (!outcome.lines.length) {
    return {
      ...row,
      status: 'no_bom',
      attempts,
      last_error: null,
      parts_added: 0,
      bom_lines_added: 0,
    };
  }
  return {
    ...row,
    status: 'extracted',
    attempts,
    last_error: null,
    parts_added: outcome.lines.length,
    bom_lines_added: outcome.lines.length,
  };
}
