/**
 * Manual library "rooms": an 18-room modality taxonomy used ONLY to file and
 * filter catalog manuals. It does not replace EQUIPMENT_TYPES (equipment-types.ts),
 * which public.equipment still constrains to 12 values (000937). Never write a
 * room or subtype id to an equipment record.
 *
 * manuals.equipment_type is free text. Every known value and alias maps to a
 * room (and usually a subtype). Values nobody recognises land in Other, never
 * Laser. Title / brand / model text refines the subtype and rescues rows typed
 * "other" or "laser" that are clearly something else.
 */

import { isDornierHolmiumLaser, isHolmiumLithoLaserFamily, isShockwaveLithotriptor } from './equipment-types.ts';

export const MANUAL_ROOM_IDS = [
  'imaging',
  'respiratory',
  'monitoring',
  'infusion',
  'surgical',
  'endoscopy',
  'sterile',
  'lab',
  'dental',
  'lasers',
  'neonatal',
  'dialysis',
  'ophthalmic_ent',
  'beds',
  'rehab',
  'defib',
  'test_equipment',
  'other',
] as const;

export type ManualRoomId = (typeof MANUAL_ROOM_IDS)[number];

export type ManualSubtypeMeta = { id: string; label: string };
export type ManualRoomMeta = {
  id: ManualRoomId;
  label: string;
  icon: string;
  subtypes: readonly ManualSubtypeMeta[];
};

/** Subtype ids are globally unique so ?sub= can stand alone in a URL. */
export const MANUAL_ROOMS: readonly ManualRoomMeta[] = [
  {
    id: 'imaging',
    label: 'Imaging',
    icon: '🩻',
    subtypes: [
      { id: 'xray', label: 'X-ray / DR' },
      { id: 'fluoro', label: 'Fluoro / C-arm' },
      { id: 'ct', label: 'CT' },
      { id: 'mri', label: 'MRI' },
      { id: 'mammo', label: 'Mammography' },
      { id: 'ultrasound', label: 'Ultrasound' },
      { id: 'injector', label: 'Contrast injectors' },
      { id: 'imaging_general', label: 'Other imaging' },
    ],
  },
  {
    id: 'respiratory',
    label: 'Respiratory & Anesthesia',
    icon: '🫁',
    subtypes: [
      { id: 'ventilator', label: 'Ventilators' },
      { id: 'anesthesia', label: 'Anesthesia machines' },
      { id: 'suction', label: 'Suction / aspirators' },
      { id: 'oxygen', label: 'Oxygen concentrators' },
      { id: 'humidifier', label: 'Humidifiers' },
      { id: 'respiratory_general', label: 'Other respiratory' },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoring & Diagnostics',
    icon: '📈',
    subtypes: [
      { id: 'patient_monitor', label: 'Patient monitors' },
      { id: 'ecg', label: 'ECG / EKG' },
      { id: 'eeg', label: 'EEG / neuro' },
      { id: 'fetal', label: 'Fetal monitors' },
      { id: 'pulse_ox', label: 'Pulse oximeters' },
      { id: 'thermometer', label: 'Thermometers' },
      { id: 'monitoring_general', label: 'Other diagnostics' },
    ],
  },
  {
    id: 'infusion',
    label: 'Infusion',
    icon: '💉',
    subtypes: [
      { id: 'infusion_pump', label: 'Infusion & syringe pumps' },
      { id: 'infusion_general', label: 'Other infusion' },
    ],
  },
  {
    id: 'surgical',
    label: 'Surgical / OR',
    icon: '🔪',
    subtypes: [
      { id: 'esu', label: 'Electrosurgical (ESU)' },
      { id: 'surgical_light', label: 'Surgical lights' },
      { id: 'or_table', label: 'OR tables' },
      { id: 'warming', label: 'Patient & fluid warmers' },
      { id: 'surgical_microscope', label: 'Surgical microscopes' },
      { id: 'surgical_general', label: 'Other OR equipment' },
    ],
  },
  {
    id: 'endoscopy',
    label: 'Endoscopy & Video',
    icon: '🔍',
    subtypes: [
      { id: 'endoscope', label: 'Endoscopes' },
      { id: 'endo_video', label: 'Video, cameras & insufflators' },
      { id: 'endoscopy_general', label: 'Other endoscopy' },
    ],
  },
  {
    id: 'sterile',
    label: 'Sterile Processing',
    icon: '♨️',
    subtypes: [
      { id: 'sterilizer', label: 'Sterilizers / autoclaves' },
      { id: 'washer', label: 'Washers & cleaners' },
      { id: 'sterile_general', label: 'Other SPD' },
    ],
  },
  {
    id: 'lab',
    label: 'Lab',
    icon: '🧪',
    subtypes: [
      { id: 'analyzer', label: 'Analyzers' },
      { id: 'centrifuge', label: 'Centrifuges' },
      { id: 'lab_microscope', label: 'Lab microscopes' },
      { id: 'lab_general', label: 'Other lab' },
    ],
  },
  {
    id: 'dental',
    label: 'Dental',
    icon: '🦷',
    subtypes: [{ id: 'dental_general', label: 'Dental equipment' }],
  },
  {
    id: 'lasers',
    label: 'Lasers & Energy',
    icon: '🔦',
    subtypes: [
      { id: 'laser', label: 'Lasers & IPL' },
      { id: 'lithotripsy', label: 'Lithotripsy' },
      { id: 'hv_power_supply', label: 'High voltage power supplies' },
    ],
  },
  {
    id: 'neonatal',
    label: 'Neonatal',
    icon: '👶',
    subtypes: [
      { id: 'incubator', label: 'Incubators' },
      { id: 'infant_warmer', label: 'Infant warmers' },
      { id: 'phototherapy', label: 'Phototherapy' },
      { id: 'breast_pump', label: 'Breast pumps' },
      { id: 'neonatal_general', label: 'Other neonatal' },
    ],
  },
  {
    id: 'dialysis',
    label: 'Dialysis',
    icon: '🩸',
    subtypes: [{ id: 'dialysis_general', label: 'Dialysis' }],
  },
  {
    id: 'ophthalmic_ent',
    label: 'Ophthalmic / ENT',
    icon: '👁️',
    subtypes: [
      { id: 'ophthalmic', label: 'Ophthalmic' },
      { id: 'ent', label: 'ENT / audiology' },
    ],
  },
  {
    id: 'beds',
    label: 'Beds & Lifts',
    icon: '🛏️',
    subtypes: [
      { id: 'bed', label: 'Hospital beds' },
      { id: 'stretcher', label: 'Stretchers' },
      { id: 'exam_table', label: 'Exam tables & chairs' },
      { id: 'lift', label: 'Patient lifts' },
      { id: 'beds_general', label: 'Other beds & surfaces' },
    ],
  },
  {
    id: 'rehab',
    label: 'Rehab',
    icon: '🦿',
    subtypes: [
      { id: 'rehab_general', label: 'Therapy & rehab' },
      { id: 'dvt', label: 'DVT / compression' },
    ],
  },
  {
    id: 'defib',
    label: 'Defib',
    icon: '⚡',
    subtypes: [{ id: 'defibrillator', label: 'Defibrillators & AEDs' }],
  },
  {
    id: 'test_equipment',
    label: 'Test Equipment',
    icon: '🧰',
    subtypes: [{ id: 'test_general', label: 'Analyzers & simulators' }],
  },
  {
    id: 'other',
    label: 'Other',
    icon: '📦',
    subtypes: [{ id: 'other_general', label: 'Other' }],
  },
] as const;

const ROOM_BY_ID = new Map<ManualRoomId, ManualRoomMeta>(MANUAL_ROOMS.map((r) => [r.id, r]));
const SUBTYPE_ROOM = new Map<string, ManualRoomId>();
const SUBTYPE_META = new Map<string, ManualSubtypeMeta>();
for (const room of MANUAL_ROOMS) {
  for (const sub of room.subtypes) {
    SUBTYPE_ROOM.set(sub.id, room.id);
    SUBTYPE_META.set(sub.id, sub);
  }
}

export function isManualRoomId(value: unknown): value is ManualRoomId {
  return MANUAL_ROOM_IDS.includes(value as ManualRoomId);
}
export function isManualSubtypeId(value: unknown): boolean {
  return SUBTYPE_ROOM.has(String(value));
}
export function manualRoomMeta(id: ManualRoomId): ManualRoomMeta {
  return ROOM_BY_ID.get(id) || ROOM_BY_ID.get('other')!;
}
export function manualSubtypeMeta(id: string): ManualSubtypeMeta | null {
  return SUBTYPE_META.get(id) || null;
}
export function manualSubtypeRoom(id: string): ManualRoomId | null {
  return SUBTYPE_ROOM.get(id) || null;
}
/** The catch-all subtype of a room (always its last subtype). */
export function generalSubtype(room: ManualRoomId): string {
  const subs = manualRoomMeta(room).subtypes;
  return subs[subs.length - 1].id;
}

type Placement = { room: ManualRoomId; subtype?: string };

/**
 * Every manuals.equipment_type value seen in production (Oct 29 2026) plus the
 * legacy EQUIPMENT_TYPES aliases. Keys are normalized (lower, spaces/hyphens → _).
 * null means "no room from the type": text rules decide, else Other.
 */
export const EQUIPMENT_TYPE_ROOM_MAP: Readonly<Record<string, Placement | null>> = {
  // Imaging
  imaging: { room: 'imaging' },
  x_ray: { room: 'imaging', subtype: 'xray' },
  xray: { room: 'imaging', subtype: 'xray' },
  radiography: { room: 'imaging', subtype: 'xray' },
  c_arm: { room: 'imaging', subtype: 'fluoro' },
  carm: { room: 'imaging', subtype: 'fluoro' },
  fluoroscopy: { room: 'imaging', subtype: 'fluoro' },
  ct: { room: 'imaging', subtype: 'ct' },
  mri: { room: 'imaging', subtype: 'mri' },
  mammography: { room: 'imaging', subtype: 'mammo' },
  ultrasound: { room: 'imaging', subtype: 'ultrasound' },
  sonograph: { room: 'imaging', subtype: 'ultrasound' },
  injector: { room: 'imaging', subtype: 'injector' },
  // Respiratory & Anesthesia
  respiratory: { room: 'respiratory' },
  ventilator: { room: 'respiratory', subtype: 'ventilator' },
  respirator: { room: 'respiratory', subtype: 'ventilator' },
  anesthesia: { room: 'respiratory', subtype: 'anesthesia' },
  anaesthesia: { room: 'respiratory', subtype: 'anesthesia' },
  suction: { room: 'respiratory', subtype: 'suction' },
  oxygen_concentrator: { room: 'respiratory', subtype: 'oxygen' },
  oxygen: { room: 'respiratory', subtype: 'oxygen' },
  humidifier: { room: 'respiratory', subtype: 'humidifier' },
  // Monitoring & Diagnostics
  patient_monitor: { room: 'monitoring', subtype: 'patient_monitor' },
  monitor: { room: 'monitoring', subtype: 'patient_monitor' },
  vital_signs: { room: 'monitoring', subtype: 'patient_monitor' },
  ecg: { room: 'monitoring', subtype: 'ecg' },
  ekg: { room: 'monitoring', subtype: 'ecg' },
  eeg: { room: 'monitoring', subtype: 'eeg' },
  neurology: { room: 'monitoring', subtype: 'eeg' },
  fetal_monitor: { room: 'monitoring', subtype: 'fetal' },
  pulse_oximeter: { room: 'monitoring', subtype: 'pulse_ox' },
  thermometer: { room: 'monitoring', subtype: 'thermometer' },
  // Infusion
  infusion: { room: 'infusion', subtype: 'infusion_pump' },
  infusion_pump: { room: 'infusion', subtype: 'infusion_pump' },
  syringe_pump: { room: 'infusion', subtype: 'infusion_pump' },
  // Surgical / OR
  electrosurgical: { room: 'surgical', subtype: 'esu' },
  electrosurgery: { room: 'surgical', subtype: 'esu' },
  esu: { room: 'surgical', subtype: 'esu' },
  surgical_light: { room: 'surgical', subtype: 'surgical_light' },
  or_table: { room: 'surgical', subtype: 'or_table' },
  warming: { room: 'surgical', subtype: 'warming' },
  microscope: { room: 'surgical', subtype: 'surgical_microscope' },
  // Endoscopy & Video
  endoscope: { room: 'endoscopy', subtype: 'endoscope' },
  endoscopy: { room: 'endoscopy', subtype: 'endoscope' },
  // Sterile Processing
  sterile_processing: { room: 'sterile' },
  sterilizer: { room: 'sterile', subtype: 'sterilizer' },
  autoclave: { room: 'sterile', subtype: 'sterilizer' },
  spd: { room: 'sterile' },
  // Lab
  lab: { room: 'lab' },
  lab_analyzer: { room: 'lab', subtype: 'analyzer' },
  centrifuge: { room: 'lab', subtype: 'centrifuge' },
  // Dental
  dental: { room: 'dental', subtype: 'dental_general' },
  // Lasers & Energy
  laser: { room: 'lasers', subtype: 'laser' },
  lasers: { room: 'lasers', subtype: 'laser' },
  lithotriptor: { room: 'lasers', subtype: 'lithotripsy' },
  litho: { room: 'lasers', subtype: 'lithotripsy' },
  lithotripsy: { room: 'lasers', subtype: 'lithotripsy' },
  hv_power_supply: { room: 'lasers', subtype: 'hv_power_supply' },
  // Neonatal
  neonatal: { room: 'neonatal' },
  incubator: { room: 'neonatal', subtype: 'incubator' },
  phototherapy: { room: 'neonatal', subtype: 'phototherapy' },
  breast_pump: { room: 'neonatal', subtype: 'breast_pump' },
  // Dialysis
  dialysis: { room: 'dialysis', subtype: 'dialysis_general' },
  // Ophthalmic / ENT
  ophthalmology: { room: 'ophthalmic_ent', subtype: 'ophthalmic' },
  ophthalmic: { room: 'ophthalmic_ent', subtype: 'ophthalmic' },
  audiology: { room: 'ophthalmic_ent', subtype: 'ent' },
  ent: { room: 'ophthalmic_ent', subtype: 'ent' },
  // Beds & Lifts
  beds: { room: 'beds' },
  bed: { room: 'beds', subtype: 'bed' },
  hospital_bed: { room: 'beds', subtype: 'bed' },
  stretcher: { room: 'beds', subtype: 'stretcher' },
  lift: { room: 'beds', subtype: 'lift' },
  // Rehab
  therapy: { room: 'rehab' },
  rehab: { room: 'rehab' },
  mobility: { room: 'rehab' },
  // Defib
  defibrillator: { room: 'defib', subtype: 'defibrillator' },
  defib: { room: 'defib', subtype: 'defibrillator' },
  aed: { room: 'defib', subtype: 'defibrillator' },
  // Test Equipment
  test_equipment: { room: 'test_equipment', subtype: 'test_general' },
  // No room from the type alone
  other: null,
  pump: null,
};

export function normalizeEquipmentTypeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Room for a raw equipment_type string alone. Unknown → null (callers default to Other). */
export function roomForEquipmentType(value: unknown): Placement | null {
  const key = normalizeEquipmentTypeKey(value);
  if (!key) return null;
  return EQUIPMENT_TYPE_ROOM_MAP[key] ?? null;
}

type Rule = { room: ManualRoomId; subtype: string; re: RegExp };

/** Ordered: specific before generic. Run against title + brand + model + path. */
const TEXT_RULES: readonly Rule[] = [
  { room: 'test_equipment', subtype: 'test_general', re: /electrical\s+safety|safety\s+analy[sz]er|\b(?:defib(?:rillator)?|ecg|spo2|nibp|ventilator|infusion(?:\s+device)?|esu|electrosurgical)\s+(?:analy[sz]er|tester|simulator)|patient\s+simulator|\bfluke\s+biomedical\b|\bbio-?tek\s+(?:601|qa|impulse|ld)|\bimpulse\s+\d{4}\b|\bmetron\b|\brigel\b/ },
  { room: 'lasers', subtype: 'hv_power_supply', re: /capacitor\s+charg|cap\s+charger|\bhvps\b|\bccps\b|high[-\s]voltage\s+power\s+supply/ },
  { room: 'imaging', subtype: 'injector', re: /\binjector\b|\bangiomat\b|\boptistat\b|\bstellant\b|\bmedrad\s+(?:mark|mct|vistron|envision|spectris|avanta)|\bmark\s+v\b|\bempower\s?ct/ },
  { room: 'imaging', subtype: 'mammo', re: /mammo|senographe|\bselenia\b/ },
  { room: 'imaging', subtype: 'mri', re: /\bmri\b|magnetic\s+resonance|\bsigna\b(?:\s+(?:hdx|excite|lx|horizon))?/ },
  { room: 'imaging', subtype: 'ct', re: /\bct\b(?!\s*(?:9000\s+adv)?\s*inj)|computed\s+tomograph|\bsomatom\b|\blightspeed\b|\baquilion\b|\bmx\s?8000\b|\bbrightspeed\b|\bhispeed\b/ },
  { room: 'imaging', subtype: 'fluoro', re: /\bc[-\s_]?arm\b|\boec\b|fluoroscop|\buroview\b|\bcathlab\b|\bangiograph|\bfluorospot\b|\buroskop\b|\bsiremobil\b|\bpowermobil\b/ },
  { room: 'ophthalmic_ent', subtype: 'ophthalmic', re: /phaco|ophthalm|slit[-\s]?lamp|tonomet|keratomet|\bspectralis\b|\bfundus\b|autorefract|lensomet|\bcirrus\s+hd-?oct|\boct\b.*\b(?:retina|eye|ophth)|\balcon\b|\binfiniti\b|\bconstellation\b|\baccurus\b|\blegacy\s+20000\b|visual\s+field|perimet/ },
  { room: 'imaging', subtype: 'ultrasound', re: /\bultrasound\s+(?:system|scanner|imaging|machine)|\bsonograph|\bsonosite\b|\blogiq\b|\bvivid\b|\bacuson\b|\bvoluson\b|\bdiagnostic\s+ultrasound\b|\bhd11\b|\biu22\b|\bepiq\b/ },
  { room: 'imaging', subtype: 'xray', re: /x[-\s]?ray|radiograph|\bdr\s+(?:detector|panel|system)|\bcxdi\b|\bregius\b|\bbucky\b|collimator|tube\s+housing|\bminxray\b|\bfuji\s?(?:fcr|cr)\b|\bcr\s+(?:reader|system)|\bprocessor\b.*\bfilm\b|film\s+processor|\bdigitizer\b|\bfcr\b|\bproteus\b|\boptimus\s+\d|wall\s+stand|\bp?cr\s?(?:\d|ir\d|reader|system|cosima|corado)|\bcr\s+\d|\bcosima\b|\bcorado\b|\bpolydoros\b|\bektascan\b|\b(?:mini|multi)loader\b|\bmin-r\b|panoramic|\bpromax\b|\bgendex\b|\bhv\s+(?:generator|technical)|\bx-?ray\s+generator/ },
  { room: 'defib', subtype: 'defibrillator', re: /defibrillat|\baeds?\b|\blifepak\b|\bheartstart\b|\bzoll\s+(?:m|r|e|x)\b|\bzoll\s+(?:m|r|e|x)\s?series|\bdefib\b/ },
  { room: 'lasers', subtype: 'laser', re: /\blasers?\b|\bipl\b|intense\s+pulsed|nd:?\s?yag|\bco2\s+laser|alexandrite|\bgentle(?:lase|yag|max)\b|\bvbeam\b|\bultrapulse\b|\bacupulse\b|\bgreenlight\b/ },
  { room: 'dialysis', subtype: 'dialysis_general', re: /dialys|\bcrrt\b|\bprismaflex\b|\bfresenius\s+(?:2008|4008|5008)|reverse\s+osmosis/ },
  { room: 'neonatal', subtype: 'incubator', re: /\binfant\s+incubator|\bisolette\b|\bgiraffe\s+(?:omnibed|incubator)|\btransport\s+incubator|\bincubator\b(?!.*\b(?:co2|lab|bacteriolog|culture)\b)(?=.*\b(?:infant|neonat|isolette|air[-\s]?shields|draeger|ohmeda|atom)\b)/ },
  { room: 'neonatal', subtype: 'phototherapy', re: /phototherap|\bbili(?:soft|blanket|lux)?\b|\bneoblue\b/ },
  { room: 'neonatal', subtype: 'infant_warmer', re: /infant\s+(?:radiant\s+)?warmer|radiant\s+warmer|infant\s+care\s+system|\bpanda\s+warmer|birthing\s+room\s+warmer|resuscitaire|\bgiraffe\s+warmer/ },
  { room: 'neonatal', subtype: 'breast_pump', re: /breast\s+pump|\bameda\b|\bmedela\s+(?:symphony|lactina)|\bardo\b/ },
  { room: 'surgical', subtype: 'esu', re: /electrosurg|\besu\b|\bbovie\b|\bvalleylab\b|\bforce\s+(?:fx|2|4|ez|triad)\b|\bforcetriad\b|\bconmed\s+(?:sabre|system\s+\d)|\berbe\s+(?:vio|icc|acc)|\bligasure\b|\bbipolar\s+generator|\bhyfrecator\b|\bapc\s?\d{3}\b|high[-\s]frequency\s+surgical|\bleep\b|\belan\s?ec\b/ },
  { room: 'surgical', subtype: 'surgical_light', re: /surgical\s+(?:light|lamp|lighting)|\bor\s+light|operating\s+(?:light|lamp)|exam(?:ination)?\s+light|procedure\s+light|\bhanaulux\b|\bberchtold\s+chromophare\b|\bharmony\s+led\b/ },
  { room: 'surgical', subtype: 'or_table', re: /operating\s+table|\bor\s+table|surgical\s+table|surgery\s+table|\bskytron\s+\d{4}\b|\bamsco\s+3080|\balphamaquet\b|\bjackson\s+table/ },
  { room: 'surgical', subtype: 'warming', re: /\bbair\s+(?:hugger|paws)\b|blood\s+warmer|fluid\s+warmer|\bhotline\b|\blevel\s+1\b|warming\s+(?:cabinet|system|unit|blanket)|hyper\/hypothermia|\bblanketrol\b|\branger\b.*\bwarm|\bthermal\s+blanket/ },
  { room: 'lab', subtype: 'lab_microscope', re: /\b(?:olympus\s+(?:bx|cx|ck|ix)\d+|nikon\s+eclipse|compound\s+microscope|jena(?:val|lumar)|zeiss\s+axio)/ },
  { room: 'surgical', subtype: 'surgical_general', re: /tourniquet|craniotome|\bsurgical\s+(?:drill|saw)|oscillating\s+(?:depth\s+)?saw|surgical\s+illuminator|smoke\s+evac/ },
  { room: 'surgical', subtype: 'surgical_microscope', re: /\bopmi\b|surgical\s+microscope|operating\s+microscope|\bleica\s+(?:m\d{3}|oh\d)|\bpentero\b|\bzeiss\s+s\d{2}\b|\bwild\s+m\d{3}\b/ },
  { room: 'endoscopy', subtype: 'endo_video', re: /video\s+processor|camera\s+control|\binsufflat|\bcv-?1[4-9]0\b|\bexera\b|\bevis\b|\bstryker\s+(?:1088|1188|1288|1488|1588|1688|x8000|l9000)|\bendoscopic\s+camera|\bxenon\s+light\s+source|video\s+(?:system|column|tower)|\b(?:thermo|endo)flator\b|\bendomat\b|\bimage1\b|\bxenon\s+(?:nova\s+)?\d{3}\b|\bflushing\s+pump\b|\birrigation\s+pump\b|\bunidrive\b/ },
  { room: 'endoscopy', subtype: 'endoscope', re: /endoscop|gastroscop|colonoscop|bronchoscop|cystoscop|laparoscop|arthroscop|duodenoscop|ureteroscop|nasopharyngoscop|\bfiberscope\b/ },
  { room: 'sterile', subtype: 'washer', re: /washer[-\s]?disinfect|\bwasher\b|ultrasonic\s+cleaner|instrument\s+cleaner|cart\s+washer/ },
  { room: 'sterile', subtype: 'sterilizer', re: /steriliz|autoclave|\bsterrad\b|\beto\b|\bstatim\b|\bamsco\s+(?:century|eagle|evolution)|\btuttnauer\b|\bmidmark\s+m(?:9|11)\b|\britter\s+m(?:9|11)\b|\bsteris\b/ },
  { room: 'respiratory', subtype: 'anesthesia', re: /anesthe|anaesthe|\bfabius\b|\bnarkomed\b|\baestiva\b|\baisys\b|\bexcel\s+210\b|\bmodulus\b|\bvaporizer\b|\btec\s?[4-7]\b|\bapollo\b.*\bdr[aä]ger/ },
  { room: 'respiratory', subtype: 'ventilator', re: /ventilator|\brespirator\b|\bpuritan\s+bennett\b|\bbipap\b|\bcpap\b|\bservo[-\s]?(?:i|s|u|300|900)\b|\bhamilton[-\s](?:c|g|t)\d|\bltv\s?\d{3,4}\b|\bevita\b|\bavea\b|\bbird\s+(?:mark|vip)|\bnewport\s+(?:e|ht)\d|\bengstr[oö]m\b|\bcarescape\s+r\d|\boxylog\b|\bsavina\b|\bbabylog\b|\bivent\b|\bv500\b|\bcritical\s+care\s+c500/ },
  { room: 'respiratory', subtype: 'suction', re: /suction|aspirator|vacuum\s+regulator|\bgomco\b|\bsmoke\s+evacuat/ },
  { room: 'respiratory', subtype: 'oxygen', re: /oxygen\s+concentrator|\bo2\s+concentrator|\bconcentrator\b|\bnewlife\b|\bperfecto2\b|\bmillennium\s+m10\b/ },
  { room: 'respiratory', subtype: 'humidifier', re: /humidifier|\bmr\s?850\b|\bconchatherm\b/ },
  { room: 'monitoring', subtype: 'fetal', re: /fetal|cardiotocograph|\bctg\b|\bcorometrics\b|\bavalon\s+fm/ },
  { room: 'monitoring', subtype: 'eeg', re: /\beeg\b|\bemg\b|electroencephal|\bnicolet\b|\bneuro(?:logy|physiology|monitor)|evoked\s+potential/ },
  { room: 'monitoring', subtype: 'ecg', re: /\becg\b|\bekg\b|electrocardiograph|\bholter\b|stress\s+test|(?<![-\w])mac\s?\d{3,4}\b|\bcardiac\s+science\s+(?:burdick|atria)|\bpagewriter\b/ },
  { room: 'monitoring', subtype: 'pulse_ox', re: /pulse\s?ox|oximet|\bspo2\s+monitor|\bnellcor\s+n-?\d/ },
  { room: 'monitoring', subtype: 'thermometer', re: /thermometer|\bsuretemp\b|\btemporal\s+scanner/ },
  { room: 'monitoring', subtype: 'patient_monitor', re: /patient\s+monitor|vital\s+signs?|bedside\s+monitor|\btelemetry\b|\bnibp\b|blood\s+pressure\s+monitor|\bintellivue\b|\bdash\s?\d{4}\b|\bpropaq\b|\bspot\s+vital|\bmultiparameter\s+monitor/ },
  { room: 'infusion', subtype: 'infusion_pump', re: /infusion|syringe\s+pump|feeding\s+pump|\bpca\s+pump|\balaris\b|\bsigma\s+spectrum\b|\bbaxter\s+(?:colleague|flo-gard)|\bplum\s+a\+?|\bmedfusion\b|\bkangaroo\b/ },
  { room: 'lab', subtype: 'centrifuge', re: /centrifug/ },
  { room: 'lab', subtype: 'analyzer', re: /analy[sz]er|hematology|chemistry\s+(?:system|analy)|blood\s+gas|coagulomet|\belisa\b|\bsysmex\b|\bcell\s+counter/ },
  { room: 'lab', subtype: 'lab_general', re: /\bcryostat|\bmicrotome|tissue\s+processor|water\s+bath|\blab(?:oratory)?\s+(?:refrigerator|freezer|incubator|oven)|\bco2\s+incubator|biosafety\s+cabinet|fume\s+hood|\bpipett/ },
  { room: 'dental', subtype: 'dental_general', re: /\bdental\b|\bdental\s+handpiece\b|\ba-?dec\b|\bdentsply\b|\bsirona\b|\bplanmeca\b|\bdentist/ },
  { room: 'rehab', subtype: 'dvt', re: /\bdvt\b|sequential\s+compression|compression\s+(?:pump|therapy|device)|\bflowtron\b|\bkendall\s+scd|\bvenaflow\b/ },
  { room: 'rehab', subtype: 'rehab_general', re: /\btraction\b|\btens\b|electrotherap|\bcpm\b|continuous\s+passive|fluidotherap|\bv\.?a\.?c\.?\b|wound\s+(?:vac|therapy)|diathermy|shortwave|therapeutic\s+ultrasound|\bchattanooga\b|\bintelect\b|\bwheelchair\b|\btreadmill\b|\bdynatron\b|\bphyaction\b|\benraf\b|\bsonopuls\b|\bcurapuls\b|\bradarmed\b|\bcryo\s?(?:5|mini)\b/ },
  { room: 'beds', subtype: 'lift', re: /patient\s+lift|\bhoyer\b|ceiling\s+lift|\bsit[-\s]to[-\s]stand\b|\bmaxi\s?move\b/ },
  { room: 'beds', subtype: 'stretcher', re: /stretcher|\bgurney\b|\btransport\s+chair\b/ },
  { room: 'beds', subtype: 'exam_table', re: /exam(?:ination)?\s+(?:table|chair)|procedure\s+(?:table|chair)|\britter\s+(?:2\d\d|1\d\d)|\bmidmark\s+(?:6\d\d|4\d\d|2\d\d)\b|power\s+table/ },
  { room: 'beds', subtype: 'bed', re: /hospital\s+beds?|\bbeds?\b|\bmattress\b|\bhill[-\s]?rom\s+(?:advance|centrella|versacare|totalcare|progressa)|\bstryker\s+(?:secure|go\s?bed|s3)/ },
  { room: 'lab', subtype: 'lab_general', re: /\bmicroscope\b/ },
];

function textPlacement(hay: string): Placement | null {
  for (const rule of TEXT_RULES) if (rule.re.test(hay)) return { room: rule.room, subtype: rule.subtype };
  return null;
}

function textSubtypeInRoom(room: ManualRoomId, hay: string): string | null {
  for (const rule of TEXT_RULES) if (rule.room === room && rule.re.test(hay)) return rule.subtype;
  return null;
}

export type ManualRoomFields = {
  equipment_type?: string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
};

export type ManualRoomPlacement = { room: ManualRoomId; subtype: string };

export function manualRoomHaystack(fields: ManualRoomFields): string {
  return [fields.title, fields.brand, fields.model, fields.storage_path]
    .map((s) => String(s || ''))
    .join(' ')
    .toLowerCase();
}

/**
 * Room + subtype for a manual row.
 * 1. Holmium / Dornier H20 / shockwave rules (same as equipment-types.ts).
 * 2. A specific equipment_type (anything but other/laser/unknown) wins for the room;
 *    text only picks the subtype. Narrow cross-room fixes: infant warmers typed
 *    "warming" → Neonatal; lab microscopes typed "microscope" → Lab; lab incubators → Lab.
 * 3. Rows typed other / laser / pump / unknown use text rules.
 * 4. Typed laser with no other signal stays a laser. Everything else → Other.
 */
export function classifyManualRoom(fields: ManualRoomFields): ManualRoomPlacement {
  const hay = manualRoomHaystack(fields);
  const typed = roomForEquipmentType(fields.equipment_type);
  const key = normalizeEquipmentTypeKey(fields.equipment_type);

  // Holmium / shockwave rules only rescue rows without a specific non-laser type
  // (a Ziehm "Compact Litho" typed c_arm is a C-arm, not a laser).
  if (!typed || typed.room === 'lasers') {
    if (isDornierHolmiumLaser(hay) || isHolmiumLithoLaserFamily(hay)) return { room: 'lasers', subtype: 'laser' };
    if (isShockwaveLithotriptor(hay)) return { room: 'lasers', subtype: 'lithotripsy' };
  }

  if (typed && typed.room !== 'lasers') {
    if (key === 'warming') {
      const neo = textSubtypeInRoom('neonatal', hay);
      if (neo) return { room: 'neonatal', subtype: neo };
    }
    if (key === 'microscope') {
      // Surgical scopes are named (OPMI, Leica M/OH, Pentero); everything else is a lab scope.
      if (textSubtypeInRoom('surgical', hay) === 'surgical_microscope') return { room: 'surgical', subtype: 'surgical_microscope' };
      return { room: 'lab', subtype: 'lab_microscope' };
    }
    if (key === 'or_table') {
      const bed = textSubtypeInRoom('beds', hay);
      if (bed === 'exam_table' || (bed === 'bed' && !/surg/.test(hay))) return { room: 'beds', subtype: bed };
    }
    if ((key === 'beds' || key === 'bed') && /infant|incubator|omnibed|isolette/.test(hay)) {
      return { room: 'neonatal', subtype: textSubtypeInRoom('neonatal', hay) || 'neonatal_general' };
    }
    if (key === 'ultrasound' && /\bintelect\b|chattanooga|stimulator|therapeutic\s+ultrasound/.test(hay)) {
      return { room: 'rehab', subtype: 'rehab_general' };
    }
    if (key === 'incubator' && /\b(?:co2|lab|bacteriolog|culture|memmert|thermo|binder)\b/.test(hay)) {
      return { room: 'lab', subtype: 'lab_general' };
    }
    const subtype = typed.subtype || textSubtypeInRoom(typed.room, hay) || generalSubtype(typed.room);
    return { room: typed.room, subtype };
  }

  if (typed && typed.room === 'lasers' && typed.subtype !== 'laser') {
    return { room: 'lasers', subtype: typed.subtype || 'laser' };
  }

  const fromText = textPlacement(hay);
  if (typed?.room === 'lasers') {
    // Typed laser: keep it if the text says laser; else follow a clear other-modality signal.
    const laserSub = textSubtypeInRoom('lasers', hay);
    if (laserSub) return { room: 'lasers', subtype: laserSub };
    if (!fromText || fromText.room === 'lasers') return { room: 'lasers', subtype: fromText?.subtype || 'laser' };
    return { room: fromText.room, subtype: fromText.subtype || generalSubtype(fromText.room) };
  }
  if (fromText) return { room: fromText.room, subtype: fromText.subtype || generalSubtype(fromText.room) };
  return { room: 'other', subtype: 'other_general' };
}

/* ------------------------------ Doc types ------------------------------ */

export const MANUAL_DOC_TYPES = [
  { id: 'service', label: 'Service' },
  { id: 'operator', label: 'Operator' },
  { id: 'schematics', label: 'Schematics' },
  { id: 'pm', label: 'PM / Calibration' },
  { id: 'parts', label: 'Parts' },
] as const;

export type ManualDocTypeId = (typeof MANUAL_DOC_TYPES)[number]['id'];

export function isManualDocTypeId(value: unknown): value is ManualDocTypeId {
  return MANUAL_DOC_TYPES.some((d) => d.id === value);
}

/**
 * Filter doc type from doc_kind + title. Title signals for schematics / PM / parts
 * beat a generic "service" doc_kind because many service PDFs are stored that way.
 */
export function manualDocType(fields: { doc_kind?: string | null; title?: string | null }): ManualDocTypeId {
  const kind = String(fields.doc_kind || '').trim().toLowerCase();
  const title = String(fields.title || '').toLowerCase();
  if (/schematic|wiring\s+diagram|circuit\s+diagram|\bdiagrams\b|block\s+diagram/.test(title)) return 'schematics';
  if (kind === 'pm' || /\bpm\b|preventive|preventative|calibration|checklist|inspection\s+procedure|maintenance\s+procedure/.test(title)) return 'pm';
  if (kind === 'parts' || /\bparts?\s+(?:list|catalog|catalogue|manual|book)|spare\s+parts|illustrated\s+parts/.test(title)) return 'parts';
  if (kind === 'operator' || kind === 'user' || /operator'?s?\s+manual|user'?s?\s+(?:manual|guide)|\bifu\b|instructions?\s+for\s+use|operating\s+(?:manual|instructions)/.test(title)) {
    if (!/service|technical|repair/.test(title)) return 'operator';
  }
  return 'service';
}
