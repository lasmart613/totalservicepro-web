/**
 * Dry-run the manuals BOM sweep. Does not read or write production.
 *
 *   node --experimental-strip-types --experimental-transform-types scripts/manual-bom-sweep.ts
 *
 * First manual: Candela Mini GentleYAG / VP YAG (library id 9, 8501-01-1769).
 * Then other Candela manuals, then the rest of the library, 50–100 at a time.
 * --apply is refused here. The long run waits for Larry's yes and a service role.
 */
import { loadMiniGentleYagSeed, miniGentleYagFamilyTreeText } from '../lib/parts-inventory/seed.ts';
import {
  extractBomLines,
  MINI_GENTLEYAG_MANUAL,
  planSweepBatch,
  scoreBomText,
  SWEEP_BATCH_DEFAULT,
  type SweepProgress,
} from '../lib/parts-inventory/sweep.ts';

if (process.argv.includes('--apply')) {
  console.error('Refusing --apply. The library sweep stays queued until Larry says yes.');
  process.exit(2);
}

const text = miniGentleYagFamilyTreeText();
const lines = extractBomLines(text);
const score = scoreBomText(text);
const sample: SweepProgress[] = [
  { manual_id: MINI_GENTLEYAG_MANUAL.libraryId, brand: 'Candela', model: 'vpyag', title: MINI_GENTLEYAG_MANUAL.title, status: 'pending', priority: 0 },
  { manual_id: 24, brand: 'Candela', model: 'gentleyag', title: 'GentleYag', status: 'pending', priority: 10 },
  { manual_id: 100, brand: 'Lumenis', model: 'acupulse', title: 'AcuPulse', status: 'pending', priority: 100 },
];
const sections: Record<string, number> = {};
for (const line of lines) sections[line.section] = (sections[line.section] || 0) + 1;

console.log(JSON.stringify({
  dryRun: true,
  batchSize: SWEEP_BATCH_DEFAULT,
  batchRange: [50, 100],
  firstManual: MINI_GENTLEYAG_MANUAL,
  plannedOrder: planSweepBatch(sample, SWEEP_BATCH_DEFAULT).map((row) => row.manual_id),
  seedParts: loadMiniGentleYagSeed().length,
  extractedParts: lines.length,
  hasBom: score.hasBom,
  sections,
  notRun: 'The ~3500-manual sweep is not started by this script.',
}, null, 2));
