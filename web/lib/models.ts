/**
 * Total Service Pro - Shared Laser Service Models & Constants
 *
 * This is the canonical definition of supported laser models for *rich performance data* in Service Report forms.
 * (wavelengths, sets, params, special test flags etc.)
 *
 * Dropdown population for manufacturers / laser models now comes from Supabase tables:
 *   - manufacturers (id, name)
 *   - laser_models (id, name, label, manufacturer_id)
 *
 * The tables drive selects in NewServiceReportClient, company equipment, service-tickets editing, etc.
 * MODELS object kept for the detailed perf testing UI (can be synced to laser_models json columns later).
 *
 * SHARED STRATEGY:
 * - Web now prefers DB tables for basic make/model dropdowns.
 * - For coexistence with Android: port DB-driven population to the assets HTML (service_report.html etc.).
 * - Rich MODELS data still used for perf tables / deviation calcs.
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
      { name: '595 nm', mode: 'SP', sets: [4, 6, 8, 10, 12], unit: 'J/cm²', spotMm: 10 }
    ],
    dyeParams: true,
    params: [
      'Total Pulses',
      'Head Pulses',
      'Lamp Pulses',
      'Dye Pulses',
      'Dye Kit S/N',
      'WL Filter Correction',
      'Bubble Sense (HP Full)',
      'Bubble Sense (HP Empty)',
      'Bubble Sense (Can Full)',
      'Bubble Sense (Can Empty)',
      'HV Final (VDC)',
      'Fiber Transmission %',
      'Wavelength (nm)',
      'Calibration Energy (J)',
      'DI Conductivity',
      'Coolant Level / Status',
    ],
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
  'Candela GentleMAX_PRO': {
    mfg: 'Candela',
    label: 'GentleMAX PRO (755 + 1064 nm)',
    wavelengths: [
      {
        name: '755 nm Alexandrite',
        mode: 'SP',
        sets: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
        unit: 'J/cm²',
        spotMm: 15,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '1064 nm Nd:YAG @ 6mm',
        mode: 'SP',
        sets: [20, 40, 60, 80, 100, 120, 150, 200, 250, 300],
        unit: 'J/cm²',
        spotMm: 6,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '1064 nm Nd:YAG @ 10mm',
        mode: 'SP',
        sets: [10, 20, 30, 40, 50, 60, 70, 80, 100, 120],
        unit: 'J/cm²',
        spotMm: 10,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '1064 nm Nd:YAG @ 12mm',
        mode: 'SP',
        sets: [10, 15, 20, 25, 30, 35, 40, 50, 60],
        unit: 'J/cm²',
        spotMm: 12,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '1064 nm Nd:YAG @ 15mm',
        mode: 'SP',
        sets: [8, 10, 15, 18, 20, 25, 30, 35, 40],
        unit: 'J/cm²',
        spotMm: 15,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '1064 nm Nd:YAG @ 18mm',
        mode: 'SP',
        sets: [5, 8, 10, 12, 15, 18, 20, 25, 30, 35],
        unit: 'J/cm²',
        spotMm: 18,
        tolLabel: 'Tol ±10%'
      }
    ],
    params: [
      'Total System Shots',
      'Handpiece Shots',
      'Lamp Shots',
      'DCD Canister Shots',
      'DCD Delay Set (ms)',
      'DCD Delay Measured (ms)',
      'DCD Duration Set (ms)',
      'DCD Duration Measured (ms)',
      'HV @ Reference Fluence (VDC)',
      'Fiber Transmission %',
      'DI Water Temp (°C)',
      'DI Conductivity (µS/cm)',
      'DI Flow Rate (L/min)',
      'Bubble Sense HP Full',
      'Bubble Sense HP Empty',
      'Bubble Sense Can Full',
      'Bubble Sense Can Empty'
    ]
  },

  PicoWay: {
    mfg: 'Candela',
    label: 'PicoWay Picosecond Laser',
    wavelengths: [
      {
        name: '1064 nm (Zoom / Resolve)',
        mode: 'SP',
        sets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0],
        unit: 'J/cm²',
        spotMm: 10,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '532 nm (Zoom)',
        mode: 'SP',
        sets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
        unit: 'J/cm²',
        spotMm: 6,
        tolLabel: 'Tol ±10%'
      },
      {
        name: '785 nm (Resolve)',
        mode: 'SP',
        sets: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2],
        unit: 'J/cm²',
        spotMm: 4,
        tolLabel: 'Tol ±10%',
        optional: true,
        optionalLabel: '785nm handpiece installed'
      }
    ],
    params: [
      'Total System Shots',
      'Handpiece Shots',
      'Lamp Shots',
      'HV @ Reference Fluence (VDC)',
      'Fiber Transmission %',
      'DI Water Temp (°C)',
      'DI Conductivity (µS/cm)',
      'Cooling Temp Set (°C)',
      'Cooling Temp Measured (°C)'
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
  },

  /* ── Rohrer Aesthetics (https://rohreraesthetics.com/devices/) ── */
  'Rohrer PiXel8': {
    mfg: 'Rohrer Aesthetics',
    label: 'PiXel8 (RF Microneedling)',
    wavelengths: [
      { name: '4 MHz RF Output', mode: 'CW', sets: [5, 10, 15, 20, 25, 30, 40, 50], unit: 'W', tolLabel: 'Tol ±15%' }
    ],
    params: [
      'Total Treatment Shots / Cycles',
      'Tip / Cartridge Type',
      'Tip Serial / Lot',
      'Needle Depth Cal Check (mm)',
      'RF Frequency Verified (MHz)',
      'RF Energy @ Cal Point',
      'Impedance / Contact Check',
      'Handpiece Condition',
      'Firmware Version',
      'Hours / Usage Counter'
    ],
    customChecklist: {
      items: [
        'Visual Check (console / handpiece)',
        'Needle tip seating / sterile barrier',
        'Depth control mechanism free movement',
        'RF cable / connector integrity',
        'Cooling / fan operation',
        'Touchscreen / UI function',
        'RF output in expected range'
      ],
      interlocks: [
        'Emergency Off',
        'Key Switch / Enable',
        'Handpiece Interlock',
        'Foot Switch',
        'Door / Remote Interlock (if equipped)'
      ]
    }
  },
  'Rohrer PicoLazer': {
    mfg: 'Rohrer Aesthetics',
    label: 'PicoLazer (Picosecond 1064/532)',
    wavelengths: [
      { name: '1064 nm Picosecond', mode: 'SP', sets: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0], unit: 'J/cm²', spotMm: 6, tolLabel: 'Tol ±10%' },
      { name: '532 nm Picosecond', mode: 'SP', sets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2], unit: 'J/cm²', spotMm: 4, tolLabel: 'Tol ±10%' },
      { name: '1064 nm Fractional / Focus lens', mode: 'SP', sets: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2], unit: 'J/cm²', spotMm: 8, tolLabel: 'Tol ±15%', optional: true, optionalLabel: 'Fractional / telescopic handpiece installed' }
    ],
    params: [
      'Total System Shots',
      'Handpiece Shots',
      'Lamp / Pump Shots',
      'Spot Size Used (mm)',
      'Pulse Width Verified (ps)',
      'HV @ Reference Fluence (VDC)',
      'Aiming Beam Check',
      'Coolant Level / Status',
      'Coolant Temp (°C)',
      'DI Conductivity (µS/cm)',
      'Firmware Version'
    ]
  },
  'Rohrer Spectrum': {
    mfg: 'Rohrer Aesthetics',
    label: 'Spectrum Multi-Platform',
    wavelengths: [
      { name: 'IPL Broadband', mode: 'SP', sets: [5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30], unit: 'J/cm²', bblRect: true, bblWidthMm: 15, bblLengthMm: 40, tolLabel: 'Tol ±15%' },
      { name: '2940 nm Er:YAG', mode: 'SP', sets: [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15], unit: 'J/cm²', tolLabel: 'Tol ±15%' },
      { name: '1064 nm Long-Pulse YAG', mode: 'SP', sets: [10, 20, 30, 40, 50, 60, 80, 100, 120, 150], unit: 'J/cm²', spotMm: 10, tolLabel: 'Tol ±10%' },
      { name: '1064 nm Q-Switch', mode: 'SP', sets: [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6], unit: 'J/cm²', spotMm: 4, tolLabel: 'Tol ±10%' },
      { name: '532 nm Q-Switch', mode: 'SP', sets: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0], unit: 'J/cm²', spotMm: 3, tolLabel: 'Tol ±10%' },
      { name: '810 nm Diode', mode: 'PR', sets: [10, 20, 30, 40, 50, 60, 80, 100], unit: 'J/cm²', spotMm: 10, tolLabel: 'Tol ±10%' }
    ],
    params: [
      'Total System Shots',
      'IPL Lamp Shots',
      'Er:YAG Shots',
      'LP-YAG Shots',
      'QS 1064 Shots',
      'QS 532 Shots',
      'Diode Shots',
      'IPL Filter Used (nm)',
      'Handpiece / Spot Used',
      'Coolant Level / Status',
      'Coolant Temp (°C)',
      'DI Conductivity (µS/cm)',
      'Firmware Version'
    ],
    bblTest: true
  },
  'Rohrer PiX:E': {
    mfg: 'Rohrer Aesthetics',
    label: 'PiX:E (RF Microneedling + Er:YAG)',
    wavelengths: [
      { name: '4 MHz RF Output', mode: 'CW', sets: [5, 10, 15, 20, 25, 30, 40, 50], unit: 'W', tolLabel: 'Tol ±15%' },
      { name: '2940 nm Er:YAG (Fractional / Ablative)', mode: 'SP', sets: [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15], unit: 'J/cm²', tolLabel: 'Tol ±15%' }
    ],
    params: [
      'Total RF Cycles',
      'Total Er:YAG Shots',
      'RF Tip Type (insulated / non-insulated)',
      'RF Tip Serial / Lot',
      'Needle Depth Cal Check (mm)',
      'RF Frequency Verified (MHz)',
      'Er:YAG Cal Energy',
      'Handpiece Condition',
      'Coolant Level / Status',
      'Firmware Version'
    ],
    customChecklist: {
      items: [
        'Visual Check (console / handpieces)',
        'RF tip seating',
        'Er:YAG optics cleaned / inspected',
        'Depth control free movement',
        'RF + Er:YAG cable integrity',
        'Cooling / fan operation',
        'UI / mode switching function'
      ],
      interlocks: [
        'Emergency Off',
        'Key Switch / Enable',
        'Handpiece Interlock',
        'Foot Switch',
        'Door / Remote Interlock (if equipped)'
      ]
    }
  },
  'Rohrer Phoenix': {
    mfg: 'Rohrer Aesthetics',
    label: 'Phoenix CO₂',
    wavelengths: [
      { name: '10600 nm CO₂ CW', mode: 'CW', sets: [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60], unit: 'W', tolLabel: 'Tol ±10%' },
      { name: '10600 nm CO₂ SuperPulse / SP', mode: 'SP', sets: [1, 2, 5, 10, 15, 20, 25, 30], unit: 'W', tolLabel: 'Tol ±10%' },
      { name: 'SwiftScan / Scanner Pattern Energy', mode: 'SP', sets: [5, 10, 15, 20, 25, 30], unit: 'mJ/spot', tolLabel: 'Tol ±15%', optional: true, optionalLabel: 'SwiftScan / scanner handpiece installed' }
    ],
    params: [
      'Total Lasing Time / Hours',
      'Total Shots / Pulses',
      'Articulated Arm Condition',
      'Aiming Beam Check',
      'Gas / Tube Status',
      'Coolant Level / Status',
      'Coolant Temp (°C)',
      'Scanner Calibration Check',
      'Firmware Version'
    ],
    gasTest: true
  },
  'Rohrer BodyTone': {
    mfg: 'Rohrer Aesthetics',
    label: 'BodyTone (Muscle Stimulation)',
    wavelengths: [],
    params: [
      'Session Counter / Total Treatments',
      'Applicators Connected (count)',
      'Output Level Channel 1–4',
      'Output Level Channel 5–8',
      'Pulse / Program Mode Verified',
      'Applicator Cable Integrity',
      'Belt / Strap Condition',
      'Firmware Version',
      'Hours of Operation'
    ],
    customChecklist: {
      items: [
        'Visual Check (console / applicators)',
        'All applicator pads / electrodes condition',
        'Cable strain reliefs intact',
        'Cooling / fan operation',
        'Touchscreen / UI function',
        'Output channels respond',
        'No error codes active'
      ],
      interlocks: [
        'Emergency Off',
        'Key Switch / Enable (if equipped)',
        'Applicator Detect / Interlock',
        'Door / Remote Interlock (if equipped)'
      ]
    }
  },
  'Rohrer UltraLight': {
    mfg: 'Rohrer Aesthetics',
    label: 'UltraLight (LED Therapy)',
    wavelengths: [
      { name: 'Red LED Output', mode: 'CW', sets: [20, 40, 60, 80, 100], unit: '%', tolLabel: 'Relative check' },
      { name: 'Blue LED Output', mode: 'CW', sets: [20, 40, 60, 80, 100], unit: '%', tolLabel: 'Relative check' },
      { name: 'Green LED Output', mode: 'CW', sets: [20, 40, 60, 80, 100], unit: '%', tolLabel: 'Relative check', optional: true, optionalLabel: 'Green channel equipped' }
    ],
    params: [
      'Total Treatment Hours',
      'Panel / Head Serial',
      'Distance / Geometry Check',
      'Timer Function Verified',
      'Intensity Control Verified',
      'Firmware Version'
    ],
    customChecklist: {
      items: [
        'Visual Check (panel LEDs / housing)',
        'All LED zones illuminate',
        'No dead pixels / zones',
        'Cable / stand integrity',
        'UI / timer function',
        'Cooling / fan operation'
      ],
      interlocks: [
        'Emergency Off',
        'Key Switch / Enable (if equipped)',
        'Door / Remote Interlock (if equipped)'
      ]
    }
  },
  'Rohrer ReLumina': {
    mfg: 'Rohrer Aesthetics',
    label: 'ReLumina (IPL)',
    wavelengths: [
      { name: 'IPL Broadband', mode: 'SP', sets: [5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30], unit: 'J/cm²', bblRect: true, bblWidthMm: 15, bblLengthMm: 40, tolLabel: 'Tol ±15%' }
    ],
    params: [
      'Total Lamp Shots',
      'Lamp Serial / Lot',
      'Filter Used (nm)',
      'Spot / Crystal Size',
      'Output @ Cal Point (J/cm²)',
      'Cooling Temp Set (°C)',
      'Cooling Temp Measured (°C)',
      'Pulse Width Verified (ms)',
      'Firmware Version'
    ],
    bblTest: true
  },
  'Rohrer ReVive': {
    mfg: 'Rohrer Aesthetics',
    label: 'ReVive (Thulium 1927 nm)',
    wavelengths: [
      { name: '1927 nm Thulium Fractional', mode: 'SP', sets: [5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40], unit: 'mJ/spot', tolLabel: 'Tol ±15%' }
    ],
    params: [
      'Total System Shots',
      'Handpiece / Roller Shots',
      'Density / Coverage Setting',
      'Spot Energy @ Cal Point',
      'Roller / Tip Condition',
      'Coolant Level / Status',
      'Coolant Temp (°C)',
      'Firmware Version'
    ]
  }
};

/**
 * Map DB model names / free text to a static MODELS entry (Android resolveModelDef parity).
 * Critical for VBeam Perfecta: DB often says "VBeam Perfecta" while key is Perfecta.
 */
export function resolveModelDef(
  modelKey: string | null | undefined,
  equipName?: string | null
): ModelDef | null {
  if (!modelKey && !equipName) return null;
  if (modelKey && MODELS[modelKey]) return MODELS[modelKey];

  const raw = String(modelKey || '');
  const hay = `${equipName || ''} ${raw}`
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/v[\s-]*beam|perfecta|vbeam|pulsed\s*dye/i.test(hay)) {
    if (/perfecta/i.test(hay) && MODELS.Perfecta) return MODELS.Perfecta;
    if (/\bv[\s-]*beam\s*1\b|\bvbeam\s*1\b|v-beam 1/i.test(hay) && MODELS.V_Beam_1)
      return MODELS.V_Beam_1;
    if (MODELS.Perfecta) return MODELS.Perfecta;
    if (MODELS.V_Beam_1) return MODELS.V_Beam_1;
  }

  if (/gentle\s*max|gmax|gentlemax/i.test(hay)) {
    if (/pro/i.test(hay) && MODELS['Candela GentleMAX_PRO']) return MODELS['Candela GentleMAX_PRO'];
    if (MODELS['Candela GentleMAX']) return MODELS['Candela GentleMAX'];
    if (MODELS['Candela GentleMAX_PRO']) return MODELS['Candela GentleMAX_PRO'];
  }

  // Rohrer Aesthetics catalog
  if (/pixel\s*8|pixel8|pix\s*el\s*8/i.test(hay) && MODELS['Rohrer PiXel8']) return MODELS['Rohrer PiXel8'];
  if (/picolazer|pico\s*lazer/i.test(hay) && MODELS['Rohrer PicoLazer']) return MODELS['Rohrer PicoLazer'];
  if (/spectrum/i.test(hay) && /rohrer/i.test(hay) && MODELS['Rohrer Spectrum']) return MODELS['Rohrer Spectrum'];
  if (/pix\s*:\s*e|pixe\b|pix\s*e\b/i.test(hay) && MODELS['Rohrer PiX:E']) return MODELS['Rohrer PiX:E'];
  if (/phoenix/i.test(hay) && MODELS['Rohrer Phoenix']) return MODELS['Rohrer Phoenix'];
  if (/body\s*tone|bodytone/i.test(hay) && MODELS['Rohrer BodyTone']) return MODELS['Rohrer BodyTone'];
  if (/ultra\s*light|ultralight/i.test(hay) && MODELS['Rohrer UltraLight']) return MODELS['Rohrer UltraLight'];
  if (/relumina|re\s*lumina/i.test(hay) && MODELS['Rohrer ReLumina']) return MODELS['Rohrer ReLumina'];
  if (/revive|re\s*vive/i.test(hay) && (/rohrer|thulium|1927/i.test(hay) || /revive/i.test(raw)) && MODELS['Rohrer ReVive']) {
    return MODELS['Rohrer ReVive'];
  }

  let bestKey: string | null = null;
  let bestScore = 0;
  Object.keys(MODELS).forEach((k) => {
    const mk = MODELS[k];
    const lab = (mk.label || k || '').toLowerCase().replace(/[_-]+/g, ' ');
    const kn = k.toLowerCase().replace(/[_-]+/g, ' ');
    if (!hay || !lab) return;
    let score = 0;
    if (hay === lab || hay === kn) score = 100;
    else if (hay.includes(lab)) score = 40 + lab.length;
    else if (lab.includes(hay)) score = 30 + hay.length;
    else if (hay.includes(kn)) score = 20 + kn.length;
    const tokens = hay.split(' ').filter((t) => t.length > 2);
    const labTokens = lab.split(' ').filter((t) => t.length > 2);
    const overlap = tokens.filter((t) =>
      labTokens.some((lt) => lt.includes(t) || t.includes(lt))
    ).length;
    if (overlap) score = Math.max(score, 15 + overlap * 12);
    if (score > bestScore) {
      bestScore = score;
      bestKey = k;
    }
  });
  if (bestKey && bestScore >= 20) return MODELS[bestKey];
  return null;
}

// Build manufacturer grouping (used for selects)
export function buildManufacturers() {
  // Legacy static builder. Prefer querying 'manufacturers' + 'laser_models' tables directly for current dropdowns.
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