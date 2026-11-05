import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStockedBomPart, sectionForDescription, type BomLine } from './bom.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Structured BOM rows from the Mini GentleYAG (VP YAG) service manual
 * family tree and the subassembly BOMs that OCR'd into part / qty / rev lines
 * (manual library id 9, document 8501-01-1769 Rev B).
 * Schematics, procedures, and assembly drawings are dropped.
 * Laser-head and laser-rail assemblies are included. Their exploded
 * drawing sheets did not OCR into line items; the sweep retries those PDFs.
 */
export function loadMiniGentleYagSeed(path = join(here, 'fixtures/mini-gentleyag-bom.psv')): BomLine[] {
  const text = readFileSync(path, 'utf8');
  const lines: BomLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('mpn|')) continue;
    const [mpn, qtyRaw, ...rest] = line.split('|');
    const description = rest.join('|').trim();
    if (!mpn || !isStockedBomPart(mpn, description)) continue;
    const qty = Number(qtyRaw);
    lines.push({
      mpn: mpn.trim(),
      description,
      section: sectionForDescription(mpn, description),
      lineRef: mpn.trim(),
      qtyPerAssembly: Number.isFinite(qty) && qty > 0 ? qty : null,
      brand: 'Candela',
    });
  }
  return lines;
}

/** Family-tree shaped text so the sweep extractor sees every section, not a sample. */
export function miniGentleYagFamilyTreeText(lines: BomLine[] = loadMiniGentleYagSeed()): string {
  const header =
    'Mini GentleYAG (VPYag) Service Manual 8501-01-1769 Revision B\nParts list Item Qty Laser head Laser rail Fluid section DCD Calport\n';
  const body = lines
    .map((line) => `${line.mpn} ${line.description} R= .01 ${line.qtyPerAssembly ?? 0} 2-Mar-2004 EACH`)
    .join('\n');
  return `${header}${body}\n`;
}
