/**
 * Total Service Pro - Shared Laser Service Models & Constants
 *
 * This is the canonical definition of supported laser models for dynamic Service Report forms.
 * PERFORMANCE DATA, wavelengths, power/fluence sets, extra params, special flags (dye, bbl, gas, fiber, wlTest, etc.)
 *
 * SHARED STRATEGY:
 * - Source of truth here (TypeScript) for the web app.
 * - For coexistence with Android WebView app: any additions/changes to MODELS or CL_* checklists
 *   MUST be ported manually to app/src/main/assets/service_report.html (the MODELS const and CL_ arrays).
 * - Recommendation to parent/Android dev: extract this to a root `shared/models.ts` (or JSON + codegen)
 *   in future so both platforms consume same (web TS import, Android can bundle the JS output or duplicate for now).
 * - Checklists and model metadata also affect reports_list filtering, PDF generation, etc.
 *
 * Adding a new model:
 * 1. Add entry here with mfg, label, wavelengths[], params[], and any flags (wlTest, dyeParams, gasTest, fiberTest, bbl*, customChecklist, optional wavelengths).
 * 2. Port the same JS object literal to the Android service_report.html MODELS.
 * 3. Test form rendering, collectData, buildPrintHTML / PDF export.
 */

export interface WavelengthSpec {
  name: string;
  mode: 'SP' | 'PR' | 'CW';
  sets: number[];
  unit: string;
  spotMm?: number;
  tolLabel?: string;
  bblRect?: boolean;
  bblWidthMm?: number;
  bblLengthMm?: number;
  optional?: boolean;
  optionalLabel?: string;
}

export interface ModelDef {
  mfg: string;
  label: string;
  wavelengths: WavelengthSpec[];
  params: string[];
  dyeParams?: boolean;
  wlTest?: boolean;
  gasTest?: boolean;
  fiberTest?: boolean;
  bblTest?: boolean;
  customChecklist?: {
    items?: string[];
    interlocks?: string[];
  };
}

export const MODELS: Record<string, ModelDef> = {
  PowerSuite: {
    mfg: 'Coherent / Lumenis',
    label: 'PowerSuite 100W Holmium',
    wavelengths: [
      { name: '755 nm', mode: 'PR', sets: [6], unit: 'W' },
      { name: '2100 nm', mode: 'PR', sets: [10, 20, 28, 60, 80, 100], unit: 'W' },
      { name: '1064 nm', mode: 'PR', sets: [6, 10, 20, 30, 44], unit: 'W' }
    ],
    params: ['Brick Values 3.5J', 'Brick Values 2.0J']
  },
  'MedLite C6': {
    mfg: 'ConBio / Hoya',
    label: 'MedLite C6 / IV',
    wavelengths: [
      { name: '1064 nm', mode: 'SP', sets: [0.3, 0.6, 1, 1.5, 2, 2.4], unit: 'J/cm²', spotMm: 8 },
      { name: '532 nm', mode: 'SP', sets: [0.1, 0.4, 0.7, 1, 1.3, 1.6], unit: 'J/cm²', spotMm: 6 }
    ],
    params: []
  },
  'AcuPulse Duo': {
    mfg: 'Lumenis',
    label: 'AcuPulse Duo CO₂',
    wavelengths: [
      { name: '10600 nm (10.6 μm CO₂)', mode: 'CW', sets: [5, 10, 15, 20, 25, 30, 40, 50, 60], unit: 'W' }
    ],
    params: []
  },
  Aura: {
    mfg: 'AMS / Laserscope',
    label: 'AURA XP 15W KTP',
    wavelengths: [
      { name: '532 nm (PR)', mode: 'PR', sets: [1, 5, 10, 15], unit: 'W' },
      { name: '532 nm (SP)', mode: 'SP', sets: [10, 20, 30], tolLabel: 'Tol 9-11%', unit: 'W' }
    ],
    params: []
  },
  Iridex: {
    mfg: 'Iridex',
    label: 'Oculight / Cyclo G6',
    wavelengths: [
      { name: '532 nm (CW)', mode: 'CW', sets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5], unit: 'W' },
      { name: '532 nm (SP)', mode: 'SP', sets: [10, 20, 30], tolLabel: 'Tol 9-11%', unit: 'W' }
    ],
    params: []
  },
  'Sphinx Jr': {
    mfg: 'Lisa Laser',
    label: 'Sphinx Junior 30W',
    wavelengths: [
      { name: '2100 nm', mode: 'PR', sets: [1, 5, 10, 20, 30], unit: 'W' },
      { name: '2100 nm (align)', mode: 'PR', sets: [10], unit: 'W' }
    ],
    params: [],
    customChecklist: {
      items: ['Visual Check', 'Clean Blastshield Installed', 'DI Bag Replaced', 'Cooling Fluid Full', 'Power in Spec (±10%)', 'Laser System Condition'],
      interlocks: ['Emergency Off Interlock', 'Key Switch Interlock', 'Fiber Detection Interlock', 'External Interlock Plug', 'Foot Switch']
    }
  },
  OmniGuide: {
    mfg: 'OmniGuide',
    label: 'InteliGuide CO₂ 25W',
    wavelengths: [
      { name: 'CO₂ CW', mode: 'CW', sets: [4, 10, 15, 20], unit: 'W' },
      { name: 'CO₂ SP (4W)', mode: 'SP', sets: [4], unit: 'W' },
      { name: 'CO₂ SP (10W)', mode: 'SP', sets: [10], unit: 'W' }
    ],
    params: ['Total Lasing Time', 'Laser Light Test Initial', 'Laser Light Test Final', 'High Level/IC11030', 'Low Level/IC11301', 'Error Log Recorded'],
    gasTest: true,
    fiberTest: true
  },
  Perfecta: {
    mfg: 'Candela',
    label: 'VBeam Perfecta (Pulsed Dye)',
    wavelengths: [
      { name: '593.5 nm', mode: 'SP', sets: [4, 6, 8, 10], unit: 'J/cm²', spotMm: 10 }
    ],
    dyeParams: true,
    params: ['Total Pulses', 'Head Pulses', 'Lamp Pulses', 'Dye Pulses', 'Dye Kit S/N', 'WL Filter Correction',
             'Bubble Sense (HP Full)', 'Bubble Sense (HP Empty)', 'Bubble Sense (Can Full)', 'Bubble Sense (Can Empty)',
             'HV Final (VDC)', 'Fiber Transmission %', 'Wavelength'],
    wlTest: true
  },
  V_Beam_1: {
    mfg: 'Candela',
    label: 'V-Beam 1 (Pulsed Dye)',
    wavelengths: [
      { name: '593.5 nm', mode: 'SP', sets: [4, 7, 9, 11, 13, 15], unit: 'J/cm²', spotMm: 7 }
    ],
    dyeParams: true,
    params: ['Total Pulses', 'Head Pulses', 'Lamp Pulses', 'Dye Pulses', 'Dye Kit S/N', 'HV @ 7J @ HD', 'WL Filter Correction',
             'Bubble Sense (HP Full)', 'Bubble Sense (HP Empty)', 'Bubble Sense (Can Full)', 'Bubble Sense (Can Empty)',
             'V4 @ Max Fluence (7mm)', 'Fiber Transmission %', 'DI Temp (°C)', 'Wavelength'],
    wlTest: true
  },
  BioLitec: {
    mfg: 'BioLitec',
    label: 'Diode D-15 15W 810nm',
    wavelengths: [
      { name: '980-1470 nm (CW)', mode: 'CW', sets: [5, 10, 15], unit: 'W' },
      { name: '980-1470 nm (PR)', mode: 'PR', sets: [5, 10, 15], unit: 'W' },
      { name: '980-1470 nm (CW hi)', mode: 'CW', sets: [120, 140, 160, 180], unit: 'W' }
    ],
    params: []
  },
  GentleLase: {
    mfg: 'Candela',
    label: 'GentleLASE Plus',
    wavelengths: [
      { name: '755 nm', mode: 'SP', sets: [10, 14, 20, 25, 30], unit: 'J/cm²', spotMm: 15 }
    ],
    params: ['Total Pulses', 'Head Pulses', 'Lamp Pulses',
             'Bubble Sense (HP Full)', 'Bubble Sense (HP Empty)', 'Bubble Sense (Can Full)', 'Bubble Sense (Can Empty)',
             'HV @ 60J', 'Fiber Transmission %', 'DI Temp (°C)']
  },
  'Candela MGL': {
    mfg: 'Candela',
    label: 'Mini GentleLASE (MGL)',
    wavelengths: [
      { name: '755 nm Alexandrite', mode: 'SP', sets: [5, 8, 10, 12, 15, 18, 20, 22, 25, 30], unit: 'J/cm²', spotMm: 8, tolLabel: 'Tol ±10%' }
    ],
    params: ['Total Pulses', 'Head Pulses', 'Lamp Pulses',
             'Bubble Sense (HP Full)', 'Bubble Sense (HP Empty)', 'Bubble Sense (Can Full)', 'Bubble Sense (Can Empty)',
             'HV @ 60J', 'Fiber Transmission %', 'DI Temp (°C)']
  },
  'Candela VPYag': {
    mfg: 'Candela',
    label: 'Mini GentleYAG (VPYag)',
    wavelengths: [
      { name: '1064 nm @ 3mm spot', mode: 'SP', sets: [10, 20, 30, 40, 50, 60, 70, 80, 90], unit: 'J/cm²', spotMm: 3, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 6mm spot', mode: 'SP', sets: [10, 20, 30, 40, 50, 60, 70, 80, 90], unit: 'J/cm²', spotMm: 6, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 10mm spot', mode: 'SP', sets: [5, 8, 10, 15, 20, 25, 30, 35, 40, 50], unit: 'J/cm²', spotMm: 10, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 12mm spot', mode: 'SP', sets: [5, 8, 10, 15, 20, 25, 30, 35, 40], unit: 'J/cm²', spotMm: 12, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 15mm spot', mode: 'SP', sets: [5, 8, 10, 15, 18, 20, 25, 30], unit: 'J/cm²', spotMm: 15, tolLabel: 'Tol ±10%' }
    ],
    params: [
      'Total System Shots', 'Handpiece Shots', 'Lamp Shots', 'DCD Canister Shots',
      'DCD Delay Set (ms)', 'DCD Delay Measured (ms)', 'DCD Duration Set (ms)', 'DCD Duration Measured (ms)',
      'HV @ Reference Fluence (VDC)', 'Fiber Transmission %',
      'DI Water Temp (°C)', 'DI Conductivity (µS/cm)', 'DI Flow Rate (L/min)',
      'Bubble Sense HP Full', 'Bubble Sense HP Empty', 'Bubble Sense Can Full', 'Bubble Sense Can Empty'
    ]
  },
  'Candela GentleYAG': {
    mfg: 'Candela',
    label: 'GentleYAG (Larger Platform)',
    wavelengths: [
      { name: '1064 nm @ 6mm spot', mode: 'SP', sets: [20, 40, 60, 80, 100, 120, 150, 200, 250, 300], unit: 'J/cm²', spotMm: 6, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 10mm spot', mode: 'SP', sets: [10, 20, 30, 40, 50, 60, 70, 80, 100, 120], unit: 'J/cm²', spotMm: 10, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 14mm spot', mode: 'SP', sets: [5, 8, 10, 15, 20, 25, 30, 40, 50, 60], unit: 'J/cm²', spotMm: 14, tolLabel: 'Tol ±10%' },
      { name: '1064 nm @ 18mm spot', mode: 'SP', sets: [5, 8, 10, 15, 18, 20, 25, 30, 35, 40], unit: 'J/cm²', spotMm: 18, tolLabel: 'Tol ±10%' }
    ],
    params: [
      'Total System Shots', 'Handpiece Shots', 'Lamp Shots', 'DCD Canister Shots',
      'DCD Delay Set (ms)', 'DCD Delay Measured (ms)', 'DCD Duration Set (ms)', 'DCD Duration Measured (ms)',
      'HV @ Reference Fluence (VDC)', 'Fiber Transmission %',
      'DI Water Temp (°C)', 'DI Conductivity (µS/cm)', 'DI Flow Rate (L/min)',
      'Bubble Sense HP Full', 'Bubble Sense HP Empty', 'Bubble Sense Can Full', 'Bubble Sense Can Empty'
    ]
  },
  'Sciton Profile': {
    mfg: 'Sciton',
    label: 'Profile Er:YAG / Nd:YAG',
    wavelengths: [
      { name: '2940 nm Er:YAG (MLP/Peel)', mode: 'SP', sets: [50, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000], unit: 'mJ', tolLabel: 'Tol ±15%' },
      { name: '1064 nm Nd:YAG (Hair Removal)', mode: 'SP', sets: [10, 20, 30, 40, 50, 60, 80, 100, 120, 140, 160], unit: 'J/cm²', spotMm: 30, bblRect: true, bblWidthMm: 30, bblLengthMm: 30, tolLabel: 'Tol ±10%' },
      { name: '1064 nm Nd:YAG (ClearScan/Vascular)', mode: 'SP', sets: [40, 60, 80, 100, 120, 160, 200, 240, 300, 360, 480], unit: 'J/cm²', spotMm: 6, tolLabel: 'Tol ±10%' },
      { name: '1319 nm Nd:YAG (ThermaScan)', mode: 'SP', sets: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 50, 60, 70, 80], unit: 'J/cm²', spotMm: 30, bblRect: true, bblWidthMm: 30, bblLengthMm: 30, tolLabel: 'Tol ±10%' },
      { name: '400–1400 nm BBL Module', mode: 'SP', sets: [5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30], unit: 'J/cm²', bblRect: true, bblWidthMm: 15, bblLengthMm: 45, tolLabel: 'Tol ±15%', optional: true, optionalLabel: 'BBL Module installed on this unit' }
    ],
    params: ['Total Pulses Er:YAG', 'Total Pulses Nd:YAG', 'Lamp Pulses Er:YAG', 'Lamp Pulses Nd:YAG',
             'Er:YAG Energy @ Cal Point (J/cm²)', 'Nd:YAG Energy @ Cal Point (J/cm²)',
             'ThermaScan Skin Temp Set (°C)', 'Water Flow (L/min)', 'DI Conductivity (µS/cm)',
             'Cooling Plate Temp (°C)', 'BBL Lamp Pulses', 'BBL Output @ Cal Point (J/cm²)',
             'BBL Cooling Temp (°C)', 'BBL Lamp S/N', 'BBL Filter Used (nm)']
  },
  'Sciton Joule': {
    mfg: 'Sciton',
    label: 'Joule Platform',
    wavelengths: [
      { name: '2940 nm Er:YAG (Contour TRL)', mode: 'SP', sets: [0.5, 1, 2, 4, 6, 8, 10, 12, 15, 18, 20], unit: 'J/cm²' },
      { name: '1064 nm Nd:YAG', mode: 'SP', sets: [10, 20, 40, 60, 80, 100, 150, 200], unit: 'mJ' },
      { name: '755 nm Alex', mode: 'SP', sets: [10, 15, 20, 25, 30, 40, 50], unit: 'J/cm²' }
    ],
    params: ['Total Pulses Er:YAG', 'Total Pulses Nd:YAG', 'Lamp Pulses', 'Water Flow (L/min)', 'DI Conductivity',
             'Er:YAG Cal Energy', 'Nd:YAG Cal Energy']
  },
  'Sciton mJOULE': {
    mfg: 'Sciton',
    label: 'mJOULE Platform',
    wavelengths: [
      { name: '2940 nm Er:YAG', mode: 'SP', sets: [0.5, 1, 2, 4, 6, 8, 10, 12, 15], unit: 'J/cm²' },
      { name: '1064 nm Nd:YAG', mode: 'SP', sets: [10, 20, 40, 60, 80, 100], unit: 'mJ' }
    ],
    params: ['Total Pulses Er:YAG', 'Total Pulses Nd:YAG', 'Water Flow (L/min)', 'DI Conductivity',
             'Er:YAG Cal Energy', 'Nd:YAG Cal Energy']
  },
  'Sciton HALO': {
    mfg: 'Sciton',
    label: 'HALO Hybrid Fractional',
    wavelengths: [
      { name: '2940 nm Ablative', mode: 'SP', sets: [5, 10, 15, 20, 25, 30, 35, 40], unit: 'mJ/spot' },
      { name: '1470 nm Non-Ablative', mode: 'SP', sets: [5, 10, 15, 20, 25, 30, 35, 40], unit: 'mJ/spot' }
    ],
    params: ['Ablative Diode Output', 'Non-Ablative Diode Output', 'Spot Size Verification',
             'Cooling Temp (°C)', 'Firmware Version']
  },
  'Sciton BBL': {
    mfg: 'Sciton',
    label: 'BBL BroadBand Light',
    wavelengths: [
      { name: '400–1400 nm BBL', mode: 'SP', sets: [5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30], unit: 'J/cm²', bblRect: true, bblWidthMm: 15, bblLengthMm: 45, tolLabel: 'Tol ±15%' }
    ],
    params: ['Lamp Pulses', 'Output @ Cal Point (J/cm²)', 'Cooling Temp Set (°C)',
             'Cooling Temp Measured (°C)', 'Lamp S/N', 'Filter Used (nm)'],
    bblTest: true
  },
  'Sciton Contour TRL': {
    mfg: 'Sciton',
    label: 'Contour TRL (standalone)',
    wavelengths: [
      { name: '2940 nm Er:YAG', mode: 'SP', sets: [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20], unit: 'J/cm²' }
    ],
    params: ['Total Pulses', 'Lamp Pulses', 'Cal Energy Output', 'Water Flow (L/min)', 'DI Conductivity']
  },
  'Other-Non Laser': {
    mfg: 'Other',
    label: 'Non-Laser Equipment',
    wavelengths: [],
    params: []
  }
};

// Build manufacturer grouping (used for selects)
export function buildManufacturers() {
  const MANUFACTURERS: Record<string, Array<{ key: string; label: string }>> = {};
  Object.entries(MODELS).forEach(([key, m]) => {
    if (!MANUFACTURERS[m.mfg]) MANUFACTURERS[m.mfg] = [];
    MANUFACTURERS[m.mfg].push({ key, label: m.label });
  });
  return MANUFACTURERS;
}

// Shared Safety / Condition Checklists (exact from original for fidelity + PDF)
export const CL_ELECTRICAL = [
  'Power Cord & Plug integrity',
  'Foot Pedal & Strain Relief function',
  'Circuit Breaker function',
  'Key Switch test',
  'E-Stop Button operates properly',
  'Display functioning properly',
  'High/Low Supplies correct voltage',
  'Faults/Errors documented & cleared'
];

export const CL_MECHANICAL = [
  'Aiming Beam brightness',
  'Wheels & Castors integrity',
  'Optics inspected & cleaned',
  'Full Alignment Check',
  'Coolant flushed & topped off',
  'DI & Coolant Filters changed',
  'Interior dust & pollutant free',
  'Servos/Gears/Solenoids to spec'
];

export const CL_AESTHETIC = [
  'Condition of Skins',
  'Foot Pedal inspection',
  'Screen condition',
  'Control Panel condition',
  'Accessory Cables',
  'Accessories of the Unit'
];

// Default test equipment fallback (if no user test_equipment rows)
export const DEFAULT_TEST_EQUIPMENT = [
  { type: 'Electrical Safety Tester', model: '', serial: '', calDue: '' },
  { type: 'Energy Detector / Power Meter', model: '', serial: '', calDue: '' },
  { type: 'Digital Multimeter', model: '', serial: '', calDue: '' },
  { type: 'Oscilloscope', model: '', serial: '', calDue: '' }
];

// Helper to compute % deviation for perf data (used in form live + PDF)
export function computeDeviation(setVal: number, actual: number | null): { pct: string; result: string; pass: boolean } {
  if (actual == null || isNaN(actual) || setVal === 0) {
    return { pct: '—', result: '—', pass: false };
  }
  const ratio = actual / setVal;
  const pctNum = (ratio - 1) * 100;
  const pct = pctNum.toFixed(1) + '%';
  const pass = Math.abs(pctNum) <= 10; // typical ±10% tolerance; model specific can override in UI
  return { pct, result: pass ? 'PASS' : 'FAIL', pass };
}
