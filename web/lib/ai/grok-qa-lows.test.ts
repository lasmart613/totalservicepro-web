/**
 * QA lows on grok-assistant v72 (ai-rerun-1011, live294). Fixtures copy the
 * layout of the real indexed pages (headers, footers, table rows) with the
 * manual prose shortened.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  indexedExcerptPage,
  indexedExcerptSection,
  sectionHeadingOnPage,
} from './manual-scope.ts';
import {
  indexedExcerptPage as edgeIndexedExcerptPage,
  indexedExcerptSection as edgeIndexedExcerptSection,
  sectionHeadingOnPage as edgeSectionHeadingOnPage,
} from '../../../supabase/functions/grok-assistant/manual-scope.ts';
import {
  answerDeclinesManualCitation,
  stripRefusalCitations,
} from '../../../supabase/functions/grok-assistant/citation-scope.ts';
import { requestedManualDecision } from '../../../supabase/functions/grok-assistant/ai-access.ts';

const both = (raw: string, anchor: number) => {
  const web = sectionHeadingOnPage(raw, anchor);
  assert.equal(edgeSectionHeadingOnPage(raw, anchor), web, 'web and edge copies agree');
  return web;
};
const at = (raw: string, needle: string) => {
  const i = raw.indexOf(needle);
  assert.ok(i >= 0, needle);
  return i;
};

// (a) Section labels only from real numbered headings.
test('(a) the page number is not a section (n762 "§85")', () => {
  const page =
    '[[pdfpage:85]] DGM001063.06 SM LITHO 85 The simmering procedure starts with the igniter. ' +
    'An initial simmering voltage of 1000Vdc is presented across the flashlamp terminals, then drops to around 120Vdc.\f';
  assert.equal(both(page, at(page, '1000Vdc')), undefined);
});

test('(a) a decimal next to a unit is not a section (n131 "§12.7"); the real heading wins', () => {
  const page =
    '[[pdfpage:89]] 96355 OM SW CE ENG 2 Page 6. SPECIFICATIONS 6.1. Laser Q-switched Nd:YAG ' +
    'Output energy per pulse: up to 1600 mJ Max. fluence: up to 12.7 J/cm 2 ' +
    'Pulse repetition rate (frequency): 0.5 Hz - 15 Hz Pulse width: 5 ns\f';
  assert.equal(both(page, at(page, 'Pulse repetition')), '6.1');
  const bare = '[[pdfpage:89]] Max. fluence: up to 12.7 J/cm 2 and 15 mJ pulses.\f';
  assert.equal(both(bare, at(bare, 'pulses')), undefined);
});

test('(a) a printed page before a connector label is not a section (n10 "§83")', () => {
  const page =
    '[[pdfpage:88]] 83 CJ11 CJ11 CJ11 6. Spare Part and Error Code List 6.1. Error Message List ' +
    'Message Code Content Explanation [M-CODE: 0003] Water Error. [M-CODE: 0004] Shutter Error. ' +
    'On Standby/Ready condition, Shutter limit sensor can’t be detected\f';
  assert.equal(both(page, at(page, '[M-CODE: 0004]')), '6.1');
});

test('(a) "Page 63 of 78": neither number is a section; "11. TROUBLESHOOTING" is (n73b)', () => {
  const page =
    '[[pdfpage:1057]] Page 63 of 78 PL35-0154 Rev. C Confidential 11. TROUBLESHOOTING Refer all service issues ' +
    'to Customer Service. PROBLEM ACTION No Power • Check the fuse on the back of the system. ' +
    'Replace it with a 250V (5.0A) fuse.\f';
  assert.equal(both(page, at(page, '250V')), '11');
  const footer = '[[pdfpage:1057]] Check the fuse on the back. Page 63 of 78 Replace with a 250V fuse.\f';
  assert.equal(both(footer, at(footer, '250V')), undefined);
});

test('(a) a running page number in the header is not a section (n73a "§52", n1 "§1")', () => {
  const cryo =
    '[[pdfpage:1123]] 51 PL35-0158-001 Rev. E 3. Attach supply line to the console.\f' +
    '[[pdfpage:1124]] Instructions for Use 52 After the regulator is secured, open the main valve knob. ' +
    'A new tank reads 6,000 psi (41.1 MPa). When the pressure falls below 3,100 psi (21.4 MPa), the cylinder must be replaced. ' +
    'Helium Gas Cylinders 1. Attach the regulator to the helium cylinder.\f' +
    '[[pdfpage:1125]] 53 PL35-0158-001 Rev. E 4. Slowly loosen the nut.\f';
  assert.equal(both(cryo, at(cryo, '3,100 psi')), undefined, '52 is the printed page, "1. Attach" is a list step');
  const sheet =
    '[[pdfpage:1075]]\f' +
    '[[pdfpage:1076]] 1 ® FN2857.7 HA-5320 1 Microsecond Precision Sample and Hold Amplifier. ' +
    'Acquisition time 1.0µs; droop rate 0.08µV/µs at 25°C.\f' +
    '[[pdfpage:1077]] 2 FN2857.7 August 24, 2005 Functional Diagram\f';
  assert.equal(both(sheet, at(sheet, 'droop')), undefined);
});

test('(a) real numbered headings still label (no regressions)', () => {
  const pm = '[[pdfpage:63]] 13 Preventative Maintenance Procedure. Clean the DI water path.\f';
  assert.equal(both(pm, at(pm, 'DI water')), '13');
  const install =
    '[[pdfpage:71]] SPECTRA Chapter 4. Installation Page 1 / 9 4.1 Overview Chapter 4 describes installation. ' +
    '4.2 Installation Component List Before installing the system, check the list.\f';
  assert.equal(both(install, at(install, 'check the list')), '4.2');
  const table = '[[pdfpage:48]] Page 48 of 178 13 Reserved 14,15 Chksum 8.2 Canbus A Can network interface at J23.\f';
  assert.equal(both(table, at(table, 'network interface')), '8.2');
});

// (b) A refusal attaches no chips.
test('(b) q05 and q25 refusals decline the citation, and their own chips are stripped', () => {
  const q05 =
    '**The Bluetooth pairing PIN for the GentleMax Pro Plus service app is not mentioned or documented anywhere ' +
    'in the provided sections of the Candela GentleMAX PRO PLUS Service Manual (8501-00-2410 Revision A).**\n\n' +
    'No references to Bluetooth, pairing PINs, or a service app appear in the retrieved content (including ' +
    'communications/software sections on pages 46–48, system specs on page 8).\n\n' +
    'If this detail exists, it would likely be in an unindexed section. Open that section in the selected manual.';
  const q25 =
    'The retrieved passages from the Lutronic Spectra Service Manual contain no torque specifications ' +
    '(or any tightening values) for articulated arm mounting bolts.\n\n' +
    '— Source: Lutronic Spectra Service Manual (indexed PDF text)\n\n' +
    '— Source: Lutronic Spectra Service Manual, p. 71, §4.2\n[[cite:id=132&p=71&s=4.2&t=Lutronic+Spectra+Service+Manual]]';
  assert.equal(answerDeclinesManualCitation(q05), true);
  assert.equal(answerDeclinesManualCitation(q25), true);
  const stripped = stripRefusalCitations(q25);
  assert.doesNotMatch(stripped, /\[\[cite:|Source:|p\. 71/);
  assert.match(stripped, /contain no torque specifications/);
});

test('(b) real answers keep their chips', () => {
  for (const answer of [
    'Error 13 means Temperature too low: let the laser run in Warm-up Mode until the cooling water is at temperature (page 213).',
    'Fault 2.1 is not described as user-serviceable; call service. Replace the shutter if it does not open.',
    'The simmering voltage starts at 1000 Vdc and drops to about 120 Vdc (page 85).',
    'Use eyewear with OD 5.8 or more at 755 nm. Do not use single-wavelength eyewear.',
  ]) {
    assert.equal(answerDeclinesManualCitation(answer), false, answer);
  }
});

// (c) The cited page follows the matched row, not the table heading.
const auriga =
  '[[pdfpage:211]] Troubleshooting overview. Check the line voltage first.\f' +
  '[[pdfpage:212]] Error Codes and Warnings Page 100 of 106 AURIGA XL Service Manual / Rev. 0 13 ERROR CODES AND WARNINGS ' +
  'Errors are either displayed on the LCD display or the display goes blank. No. Error message Cause Remedy ' +
  '6 Firing error Ignition module defective Notify customer service 7 Footswitch pressed During startup the pedal was ' +
  'activated Release foot pedal 8 System error Fatal device error See table Sub error\f' +
  '[[pdfpage:213]] Error Codes and Warnings AURIGA XL Service Manual / Rev. 0 Page 101 of 106 No. Error message Cause Remedy ' +
  '9 Temperature too high Coolant temperature is too high Switch the device to Standby Mode and wait. 12 Line voltage ' +
  'Line voltage is not within tolerance Notify customer service 13 Temperature too low Cooling water temperature too low ' +
  'Let the laser run in Warm-up Mode until cooling water has reached the operating temperature 14 Please connect applicator\f' +
  '[[pdfpage:214]] Error Codes and Warnings Page 102 of 106 No. Error message Cause Remedy 34 Flash lamp aged Please call service ' +
  'Description of sub errors for the error messages 08 System Error and 25 Energy. No. Error message Cause Remedy ' +
  '1 Water flow No cooling water flow Notify customer service 10 Interpolation Data not plausible\f' +
  '[[pdfpage:215]] Error Codes and Warnings Page 103 of 106 No. Error message Cause Remedy 11 Data table Data not plausible ' +
  'Notify customer service 13 Duty Cycle Maximum duty cycle exceeded Take a break from treatment 16 Overload\f';

test('(c) error 13 cites the row on p.213, not the table heading on p.212 or the sub-error table', () => {
  const q = 'On the AURIGA XL, what does error 13 mean and what is the remedy? Cite the manual page.';
  assert.equal(indexedExcerptPage(auriga, q), 213);
  assert.equal(edgeIndexedExcerptPage(auriga, q), 213);
  assert.equal(indexedExcerptSection(auriga, q), edgeIndexedExcerptSection(auriga, q));
});

test('(c) "Error 13" written out still wins over a bare row elsewhere', () => {
  const raw =
    '[[pdfpage:5]] Fault table. No. Error message Cause 13 Duty Cycle exceeded.\f' +
    '[[pdfpage:9]] Error 13 Temperature too low. Warm up the laser.\f';
  assert.equal(indexedExcerptPage(raw, 'what does error 13 mean'), 9);
  assert.equal(edgeIndexedExcerptPage(raw, 'what does error 13 mean'), 9);
});

// (d) An unpublished id or a stray non-shared path is refused, not run unscoped.
test('(d) requestedManualDecision', () => {
  const owned = [{ id: '501', storage_path: 'orgs/10/private/Board.pdf' }];
  const deny = { ok: false, status: 403, error: 'manual_not_accessible', message: 'This manual is not in your library.' };
  const base = { manualId: null, storagePath: '', resolved: false, owned };
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: true, manualId: 764 }), deny);
  assert.deepEqual(
    requestedManualDecision({ ...base, unpublished: true, manualId: 764, storagePath: 'shared/quanta-system/litho-evo/DGM001435.pdf' }),
    deny
  );
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: false, storagePath: 'org/2655/uploads/manual.pdf' }), deny);
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: false, storagePath: 'shared/x/../../orgs/20/a.pdf' }), deny);
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: false, storagePath: 'orgs/10/private/Board.pdf' }), { ok: true });
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: false, storagePath: 'shared/candela/x.pdf' }), { ok: true });
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: false, storagePath: '' }), { ok: true }, 'no manual');
  assert.deepEqual(requestedManualDecision({ ...base, unpublished: false, storagePath: 'gentlemax' }), { ok: true }, 'alias, not a path');
  assert.deepEqual(
    requestedManualDecision({ ...base, unpublished: false, resolved: true, manualId: 777, storagePath: 'orgs/20/clinic.pdf' }),
    deny
  );
  assert.deepEqual(
    requestedManualDecision({ ...base, unpublished: false, resolved: true, manualId: 1086, storagePath: 'shared/candela/x.pdf' }),
    { ok: true }
  );
});
