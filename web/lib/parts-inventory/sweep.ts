/**
 * Resumable manuals BOM sweep.
 *
 * Order: Candela Mini GentleYAG (VP YAG) first, then other Candela manuals,
 * then the rest of the library. One batch is 50–100 manuals. Already
 * extracted or confirmed no-BOM rows are skipped, so a rerun continues
 * where the last batch stopped.
 */

import { isStockedBomPart, sectionForDescription, type BomLine } from './bom.ts';
import { acceptEvidenceLines, MANUAL_NINE_SOURCES, manualNineCoverage, type SourceFileStatus } from './manual-nine.ts';
import { normalizeMpn } from './mpn.ts';
import { reattachSystemLines, type AssemblyEvidence, type SystemLine } from './reattach.ts';

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

export type SweepStatus = 'pending' | 'no_bom' | 'extracted' | 'error' | 'held';

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
  manual_id?: number | null;
  brand?: string | null;
  model?: string | null;
  title?: string | null;
}): number {
  if (manual.manual_id === MINI_GENTLEYAG_MANUAL.libraryId) return 0;
  const blob = `${manual.brand || ''} ${manual.model || ''} ${manual.title || ''}`.toLowerCase();
  if (blob.includes('candela')) return 10;
  return 100;
}

export function clampBatchSize(size: number | null | undefined): number {
  const n = Number(size);
  if (!Number.isFinite(n)) return SWEEP_BATCH_DEFAULT;
  return Math.min(SWEEP_BATCH_MAX, Math.max(SWEEP_BATCH_MIN, Math.trunc(n)));
}

/**
 * Pending and errored manuals. manuals.id 9 blocks every other manual.
 * The 37 Section 4 paths are required evidence. Omitting them, or passing an
 * empty or partial list, does not release the rest of the library.
 */
export function planSweepBatch(
  manuals: SweepProgress[],
  batchSize = SWEEP_BATCH_DEFAULT,
  files?: { storage_path?: string; status?: SourceFileStatus | string | null }[] | null,
): SweepProgress[] {
  const size = clampBatchSize(batchSize);
  const eligible = manuals
    .filter((row) => row.status === 'pending' || row.status === 'error')
    .map((row) => ({ ...row, priority: row.manual_id === MINI_GENTLEYAG_MANUAL.libraryId ? 0 : (row.priority ?? sweepPriority(row)) }))
    .sort((a, b) => a.priority - b.priority || a.manual_id - b.manual_id);
  const nineOpen = eligible.some((row) => row.manual_id === MINI_GENTLEYAG_MANUAL.libraryId);
  if (nineOpen || !manualNineCoverage(files).complete) {
    return eligible.filter((row) => row.manual_id === MINI_GENTLEYAG_MANUAL.libraryId).slice(0, size);
  }
  return eligible.slice(0, size);
}

/**
 * Read one manual-9 file. Lines from any other path are rejected.
 * Parent assignments are a plan only: this function does not write device_bom.
 */
export function ingestManualNineSource(sourcePath: string, text: string, evidence: AssemblyEvidence[] = []) {
  const allowed = MANUAL_NINE_SOURCES.some((source) => source.storage_path === sourcePath);
  if (!allowed) {
    return {
      accepted: [],
      rejected: [{ mpn: '', description: '', source_path: sourcePath }],
      plan: { persisted: false as const, candidates: [] as SystemLine[], sourceVerified: [] as SystemLine[], unassigned: [] as string[] },
    };
  }
  const extracted = extractBomLines(text);
  const gate = acceptEvidenceLines(extracted.map((line) => ({
    mpn: line.mpn,
    description: line.description,
    source_path: sourcePath,
    qty: line.qtyPerAssembly,
  })));
  const system: SystemLine[] = gate.accepted.map((line) => ({
    mpn: line.mpn,
    description: line.description,
    section: 'System',
    provenance: sourcePath,
    parent_mpn: null,
    assembly_confidence: 'unassigned' as const,
  }));
  const planned = reattachSystemLines(system, evidence);
  return {
    accepted: gate.accepted,
    rejected: gate.rejected,
    plan: {
      persisted: false as const,
      candidates: planned.filter((row) => row.provenance_kind === 'candidate'),
      sourceVerified: planned.filter((row) => row.provenance_kind === 'source-verified'),
      unassigned: planned.filter((row) => row.provenance_kind !== 'candidate').map((row) => row.mpn),
    },
  };
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
