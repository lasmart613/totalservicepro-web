/**
 * Device bill of materials is one list per make/model, not per serial.
 * When a tech is on that device, those parts are offered before a general search.
 * Sell price still comes from the org parts row, never from the shared catalog.
 */

import { normalizeMpn } from './mpn.ts';

export type BomLine = {
  mpn: string;
  description: string;
  section: string;
  lineRef?: string | null;
  qtyPerAssembly?: number | null;
  brand?: string | null;
};

export type PartPick = {
  key: string;
  part_number: string;
  description: string;
  unit_price: number | null;
  source: 'bom' | 'catalog' | 'marketplace' | 'org';
  section?: string | null;
};

export function deviceModelKeys(make: string | null | undefined, model: string | null | undefined): string[] {
  const blob = `${make || ''} ${model || ''}`.toLowerCase();
  const keys = new Set<string>();
  const compact = blob.replace(/[^a-z0-9]+/g, '');
  if (compact) keys.add(compact);
  if (/vpyag|vpyag|pvyag|minigentleyag|gentleyagmini|glyag|glvpyag/.test(compact) || /mini\s*gentle\s*yag|vp[\s-]*yag/.test(blob)) {
    keys.add('vpyag');
    keys.add('minigentleyag');
  }
  return [...keys];
}

export function isMiniGentleYag(make: string | null | undefined, model: string | null | undefined): boolean {
  return deviceModelKeys(make, model).includes('vpyag');
}

/** BOM hits stay in manual order and ahead of catalog / marketplace hits. */
export function rankPartsForDevice(bom: PartPick[], other: PartPick[], query = ''): PartPick[] {
  const q = query.trim().toLowerCase();
  const match = (hit: PartPick) =>
    !q || `${hit.part_number} ${hit.description} ${hit.section || ''}`.toLowerCase().includes(q);
  const seen = new Set<string>();
  const out: PartPick[] = [];
  for (const hit of [...bom, ...other]) {
    if (!match(hit)) continue;
    const key = normalizeMpn(hit.part_number) || hit.key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

export function bomLineToPick(line: BomLine, orgPrice: number | null): PartPick {
  return {
    key: `bom-${normalizeMpn(line.mpn)}`,
    part_number: line.mpn,
    description: [line.section, line.description].filter(Boolean).join(' · '),
    unit_price: orgPrice,
    source: 'bom',
    section: line.section,
  };
}

export function sectionForDescription(pn: string, description: string): string {
  const d = description.toUpperCase();
  const part = pn.toUpperCase();
  if (d.includes('LSR HD') || d.includes('LASER HEAD')) return 'Laser head';
  if (d.includes('LASER RAIL')) return 'Laser rail';
  if (d.includes('AIMING')) return 'Laser rail — aiming beam';
  if (d.includes('APERT')) return 'Laser rail — aperture';
  if (d.includes('FIBER RCPT') || d.includes('LENS FOCUS') || d.includes('HSG LENS') || d.includes('HSG,LENS')) {
    return 'Laser rail — fiber receptacle';
  }
  if (d.includes('BEAM BLOCK')) return 'Laser rail — beam blocker';
  if (d.includes('HEAD DETECT') || d.includes('ENERGY DETECT')) return 'Laser rail — head detector';
  if (d.includes('CALPORT') || d.includes('CLPRT')) return 'Calport';
  if (d.includes('DCD') || d.includes('CRYO')) return 'DCD';
  if (
    d.includes('FLUID') ||
    d.includes('HEAT EXCH') ||
    d.includes('HEATER') ||
    d.includes('RESERVOIR') ||
    d.includes('WTR RSVR') ||
    d.includes('TUBING KIT') ||
    d.includes('DI PUMP') ||
    d.includes('DI FILTER') ||
    d.includes('MANIFOLD') ||
    /\bDI\b/.test(d)
  ) {
    return 'Fluid section';
  }
  if (d.includes('HV SECTION') || d.includes('DUMP') || d.includes(',HV') || d.includes('HV CNTRL') || d.includes('HV,')) {
    return 'HV section';
  }
  if (d.includes('AC INPUT') || d.includes('LINECORD') || d.includes('CIRCUIT BREAKER') || d.includes('EMI')) {
    return 'AC input';
  }
  if (
    d.includes('DLVY') ||
    d.includes('DELIV') ||
    d.includes('FIBER') ||
    d.includes('FBR') ||
    d.includes('H/P') ||
    d.includes('HNDPC') ||
    d.includes('HAND P') ||
    d.includes('HANDPIECE')
  ) {
    return 'Delivery system';
  }
  if (d.includes('CHASSIS') || d.includes('FRAME') || d.includes('SKIN') || d.includes('BEZEL') || d.includes('UP CHAS')) {
    return 'Chassis';
  }
  if (part.startsWith('7122-00-3497') || part.startsWith('7122-99-3497')) return 'Laser head';
  if (part.startsWith('7122-00-3446') || part.startsWith('7122-99-3446')) return 'Laser rail';
  return 'System';
}

/** Drawings, schematics, and procedures are not stocked parts. */
export function isStockedBomPart(pn: string, description: string): boolean {
  const d = description.trim().toUpperCase();
  const part = pn.trim().toUpperCase();
  if (!part || !d) return false;
  if (/^(SCHEM|SCH,|SCH |SCG,|SCHE?M)/.test(d)) return false;
  if (/\b(MFG PRCD|TEST PRCD|TST PRCD|FQC|RFGF|FAMILY TREE|INSTR,|FTP,|PRCD,)\b/.test(d)) return false;
  if (d.startsWith('ASSY DWG') || d.startsWith('ASSYDWG')) return false;
  if (/^7111-80-/.test(part) || /^9914-8/.test(part) || /^9914-9/.test(part)) return false;
  if (/^85\d\d-/.test(part) || /^9514-/.test(part)) return false;
  if (/^7122-99-/.test(part) || /^9914-99-/.test(part)) return false;
  return true;
}
