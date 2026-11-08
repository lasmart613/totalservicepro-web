/**
 * Family-tree lines filed as "System" stay there unless a manual-9 source
 * passage names both the child part and a parent assembly. No guessing.
 * This plans a parent. It does not write device_bom.
 */

import { MANUAL_NINE_SOURCES } from './manual-nine.ts';

const MANUAL_NINE_PATHS = new Set(MANUAL_NINE_SOURCES.map((source) => source.storage_path));

export type ProvenanceKind = 'unassigned' | 'candidate' | 'source-verified';

export type AssemblyConfidence = 'evidenced' | 'unassigned';

export type SystemLine = {
  mpn: string;
  description: string;
  section: string;
  provenance: string;
  parent_mpn: string | null;
  assembly_confidence: AssemblyConfidence;
  /**
   * candidate: a quote string on an allowed path named both numbers.
   * That quote was not read back from the file. source-verified is never
   * set here. evidenced assembly_confidence is only for a source-verified row.
   */
  provenance_kind?: ProvenanceKind;
};

export type AssemblyEvidence = {
  child_mpn: string;
  parent_mpn: string;
  source_path: string;
  /** Passage that contains both part numbers. */
  quote: string;
};

function compact(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * A quote that contains both numbers on a manual-9 path is a candidate.
 * It is not a source-verified parent, and this function does not write device_bom.
 * assembly_confidence stays unassigned. source-verified is not produced.
 */
export function reattachSystemLines(lines: SystemLine[], evidence: AssemblyEvidence[]): SystemLine[] {
  return lines.map((line) => {
    if (line.section !== 'System') return line;
    const child = compact(line.mpn);
    const hit = evidence.find((item) => {
      if (compact(item.child_mpn) !== child) return false;
      if (!MANUAL_NINE_PATHS.has(item.source_path)) return false;
      if (!item.parent_mpn || !item.quote) return false;
      const quote = compact(item.quote);
      return quote.includes(child) && quote.includes(compact(item.parent_mpn));
    });
    if (!hit) {
      return {
        ...line,
        parent_mpn: null,
        assembly_confidence: 'unassigned',
        provenance_kind: 'unassigned',
        provenance: line.provenance || 'family-tree-ocr',
      };
    }
    return {
      ...line,
      parent_mpn: hit.parent_mpn,
      assembly_confidence: 'unassigned',
      provenance_kind: 'candidate',
      provenance: `candidate ${hit.source_path}: ${hit.quote.slice(0, 180)}`,
    };
  });
}
