/**
 * Public, indexable field-service pages.
 *
 * Adding a page is one new object in SERVICE_MANUALS, BLOG_POSTS, or
 * TROUBLESHOOTING_GUIDES. Routes, static params, and sitemap lastmod entries
 * are derived from those arrays. See ./README.md.
 *
 * These pages never carry OEM files. Do not add storage_path, signed URLs,
 * page images, or copied OEM text. The in-app library stays at /manuals
 * (auth-gated). Robots.txt Disallow: /manuals also blocks /manuals/..., so
 * public URLs must stay on /service-manuals, /blog, and /troubleshooting.
 */

export const PUBLIC_CONTENT_AUTHOR = 'Medical Repair Network';

export const CONTENT_UPDATED = '2026-09-26';

export const MANUAL_SIGNUP_HREF = '/signup';
export const MANUAL_SIGNUP_LABEL = 'Sign up free to view this manual';
export const MANUAL_LOGIN_HREF = '/manuals';
export const MANUAL_LOGIN_LEAD = 'Already have an account?';
export const MANUAL_LOGIN_LABEL = 'Log in';

export type ContentBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

export type RelatedLink = { href: string; label: string };

export type DocumentType = 'Service' | 'Operator';

export type ServiceManual = {
  makeSlug: string;
  makeName: string;
  modelSlug: string;
  modelName: string;
  /** Exact catalog title. Do not paraphrase. */
  title: string;
  documentType: DocumentType;
  equipmentType: string;
  description: string;
  /** Search phrase this landing is written for. Used in copy, not as a fake rating. */
  keyword: string;
  updatedAt: string;
  notes: ContentBlock[];
  related: RelatedLink[];
};

export type ArticleEntry = {
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  blocks: ContentBlock[];
  related: RelatedLink[];
};

export const SERVICE_MANUALS_HUB = {
  path: '/service-manuals',
  title: 'Biomedical service manuals',
  description:
    'Public notes on service manuals for anesthesia machines, patient monitors, ultrasound, urology C-arms, and surgical and aesthetic lasers. The document opens with a free RepairPlanet account.',
  updatedAt: CONTENT_UPDATED,
} as const;

export const BLOG_HUB = {
  path: '/blog',
  title: 'Field service notes',
  description:
    'Practical notes for biomedical and aesthetic-laser service companies: fluence math, output checks, and what belongs on a defensible service report.',
  updatedAt: CONTENT_UPDATED,
} as const;

export const TROUBLESHOOTING_HUB = {
  path: '/troubleshooting',
  title: 'Equipment troubleshooting',
  description:
    'Field troubleshooting notes for devices independent biomedical and laser service companies actually work on. Procedures stay general until a code list is verified from the service manual.',
  updatedAt: CONTENT_UPDATED,
} as const;

export const SERVICE_MANUALS: ServiceManual[] = [
  {
    makeSlug: 'draeger',
    makeName: 'Draeger',
    modelSlug: 'fabius-gs',
    modelName: 'Fabius GS',
    title: 'Draeger Fabius GS Anesthesia Service Manual',
    documentType: 'Service',
    equipmentType: 'Anesthesia',
    keyword: 'drager fabius gs service manual',
    updatedAt: CONTENT_UPDATED,
    description:
      'Drager Fabius GS service manual notes: what the Draeger Fabius GS anesthesia service document covers, common PM checks, and how a field company uses it. Free account to open the file.',
    notes: [
      {
        type: 'p',
        text: 'Shops searching for a Drager Fabius GS service manual usually have a workstation that failed a leak test, a ventilator check, or an oxygen reading the clinician does not trust. The library title is Draeger Fabius GS Anesthesia Service Manual. Draeger is the spelling on that record. Clinics also write Dräger or Drager. It is an anesthesia workstation, not a laser and not a monitor with a gas blender bolted on.',
      },
      {
        type: 'p',
        text: 'A service manual for this class of machine is the document you open when the pre-use checklist will not pass and the front panel has already told you everything it is going to tell you. Expect chapters on the breathing system, the ventilator, fresh-gas plumbing, the vaporizer interface and interlock, the electrical supply and battery, and the alarms that sit on those assemblies. Parts identification is in there so you are not ordering from a phone photo of a fitting. Calibration sections cover the sensors and valves a shop is allowed to adjust. They are not a suggestion to redesign the gas path.',
      },
      {
        type: 'p',
        text: 'On a preventive maintenance visit the work is repetitive and it should stay that way. A system leak test, ventilator volume and pressure checks, oxygen-monitor verification, vaporizer exclusion, scavenger function, battery condition, and electrical safety (protective earth and leakage current) are the usual list. Write down the numbers. A pass/fail sticker with no leak rate and no analyzer reading is hard to defend six months later when the facility asks what was actually measured.',
      },
      {
        type: 'p',
        text: 'Use the manual after you have the complaint in the clinician’s words, the serial number, and the hardware or software revision from the machine. Match the procedure to that revision. If a step says to replace an assembly and the room is still on the schedule, stop and confirm parts and downtime before you open the breathing system. Do not defeat an alarm to finish a case, and do not return a machine that failed its leak test.',
      },
      {
        type: 'p',
        text: 'A service company uses this document three ways: to run the PM the facility contracted, to isolate a fault far enough to order the right part, and to name the test equipment and the result in the service report. The notes on this page are ours. They are not the manual, and they do not quote its text, tables, or drawings. The file itself opens after you sign up.',
      },
    ],
    related: [
      { href: '/service-manuals/draeger/narkomed-6000', label: 'Draeger Narkomed 6000 anesthesia manual' },
      { href: '/blog/bmet-service-report-template', label: 'What a biomedical service report needs' },
      { href: '/service-manuals', label: 'All public service-manual notes' },
    ],
  },
  {
    makeSlug: 'draeger',
    makeName: 'Draeger',
    modelSlug: 'narkomed-6000',
    modelName: 'Narkomed 6000',
    title: 'Draeger Narkomed 6000 Anesthesia Service Manual',
    documentType: 'Service',
    equipmentType: 'Anesthesia',
    keyword: 'narkomed 6000 service manual',
    updatedAt: CONTENT_UPDATED,
    description:
      'Narkomed 6000 service manual notes for the Draeger anesthesia workstation: typical coverage, PM and revision checks, and how a service company uses the document. Free account to view it.',
    notes: [
      {
        type: 'p',
        text: 'A Narkomed 6000 service manual is what you want when a North American Dräger anesthesia machine is still in daily use and the fault is no longer obvious from the checkout menu. The library title is Draeger Narkomed 6000 Anesthesia Service Manual. Narkomed was the name Dräger used on many machines sold in the United States. The same shop that services a Fabius GS will see these in surgery centers, older ORs, and rental fleets.',
      },
      {
        type: 'p',
        text: 'Service documentation for this generation typically covers the gas machine, the breathing system and absorber, the ventilator, vaporizer mounting and interlocks, power and battery, and the monitoring path that was integrated with the workstation. Configurations were not identical from serial to serial. Read the data plate and match the procedure to the revision in front of you before you order a ventilator part or an absorber component that “usually” fits a Narkomed.',
      },
      {
        type: 'p',
        text: 'Preventive maintenance is the unglamorous list that keeps the machine insurable. Leak test the breathing circuit and the low-pressure system. Check ventilator function against the values the procedure specifies. Verify the oxygen sensor, flow control, scavenger, and battery. Measure protective earth and leakage current with an analyzer that is in calibration, and record the readings. If the facility still uses vaporizers that have their own service interval, that work is separate from the machine PM and should be written that way.',
      },
      {
        type: 'p',
        text: 'Parts for these systems are older. A service company uses the manual to confirm which assembly is actually installed, then to decide whether a repair is adjustment, a replaceable module, or a conversation with the facility about retirement. Do not borrow a procedure from a newer Fabius and hope the plumbing matches. Do not leave a machine in the room that failed checkout because “it was fine yesterday.”',
      },
      {
        type: 'p',
        text: 'On the report, identify the device by model and serial, name the work (PM, repair, or incoming inspection), list the analyzer and its calibration due date, and keep the leak and safety numbers. These notes are original. They do not copy the OEM text. Sign up to open the document in the library.',
      },
    ],
    related: [
      { href: '/service-manuals/draeger/fabius-gs', label: 'Draeger Fabius GS anesthesia manual' },
      { href: '/blog/bmet-service-report-template', label: 'Service report fields that hold up later' },
      { href: '/service-manuals', label: 'All public service-manual notes' },
    ],
  },
  {
    makeSlug: 'ge',
    makeName: 'GE',
    modelSlug: 'dash-3000-4000',
    modelName: 'Dash 3000/4000',
    title: 'GE Dash 3000/4000 Patient Monitor Service Manual',
    documentType: 'Service',
    equipmentType: 'Patient monitor',
    keyword: 'ge dash 4000 service manual',
    updatedAt: CONTENT_UPDATED,
    description:
      'GE Dash 4000 service manual notes for the Dash 3000/4000 patient monitor: power, parameters, PM checks, and how a biomedical shop uses the document. Free account to view it.',
    notes: [
      {
        type: 'p',
        text: 'A GE Dash 4000 service manual, in this library, is the GE Dash 3000/4000 Patient Monitor Service Manual. The Dash 3000 and Dash 4000 are portable bedside monitors from the same family. The Dash 5000 is the larger sibling and is not what this title covers. Shops meet these monitors in PACU, transport, and older ICU rooms, often next to anesthesia machines and infusion pumps rather than in a laser clinic.',
      },
      {
        type: 'p',
        text: 'Service work on a Dash is power, display, and parameters. The manual is where you sort mainframe faults from module or accessory faults: AC supply, battery, the display, and the path for ECG, respiration, SpO2, noninvasive blood pressure, temperature, and invasive pressure when those options are installed. Not every unit has every parameter. Look at the modules and the options actually on the serial number you are holding before you chase a pressure channel the monitor never had.',
      },
      {
        type: 'p',
        text: 'A useful PM is short and measurable. Electrical safety with an analyzer. Alarm function, including what happens when a lead comes off. NIBP leak and overpressure behavior with a simulator or the analyzer’s NIBP port. ECG and SpO2 simulation if you have the simulators. A battery that still runs the monitor for the time the procedure asks. A monitor can show a clean boot screen and still fail NIBP. Test the parameters the unit is used for, not only the ones that are easy.',
      },
      {
        type: 'p',
        text: 'Record the simulator or safety analyzer by make, model, serial, and calibration due date. Record the monitor model, serial, and software revision if the screen shows one. If you replace a battery or a parameter board, say so, and say whether the parameter was rechecked after the part went in. The manual is how you confirm the test setup and the replacement. It is not a clinical guide to reading an ECG.',
      },
      {
        type: 'p',
        text: 'These notes are written for a service company. They do not reproduce GE’s text, tables, or drawings. Create a free account to view the manual itself.',
      },
    ],
    related: [
      { href: '/blog/bmet-service-report-template', label: 'Electrical safety on the service report' },
      { href: '/service-manuals/samsung/rs80a', label: 'Samsung RS80A ultrasound manual' },
      { href: '/service-manuals', label: 'All public service-manual notes' },
    ],
  },
  {
    makeSlug: 'coherent',
    makeName: 'Coherent',
    modelSlug: 'versapulse-powersuite',
    modelName: 'VersaPulse PowerSuite',
    title: 'VersaPulse PowerSuite Rev. C',
    documentType: 'Service',
    equipmentType: 'Laser',
    keyword: 'versapulse powersuite service manual',
    updatedAt: CONTENT_UPDATED,
    description:
      'VersaPulse PowerSuite service manual notes for the Coherent document titled VersaPulse PowerSuite Rev. C. The line is now supported under Lumenis. Coverage, PM checks, and a free account to view the file.',
    notes: [
      {
        type: 'p',
        text: 'A VersaPulse PowerSuite service manual, in this library, is the document titled VersaPulse PowerSuite Rev. C. The catalog brand is Coherent. The VersaPulse line is now supported under Lumenis, which is the name many clinics and newer parts lists use. File searches under both names. The machine is a surgical laser, used heavily for holmium work in urology and in other surgical specialties. Some configurations carry a second wavelength. Read the nameplate instead of assuming the wattage or the wavelengths from memory.',
      },
      {
        type: 'p',
        text: 'A service document for this platform typically covers installation power and cooling, interlocks (remote, door, fiber or delivery, covers, footswitch), the flashlamp and laser cavity, the cooling loop, fiber delivery, energy calibration, and fault isolation. Revision matters. Rev. C is the document in the library. Do not mix steps from a different revision or from a later Lumenis manual and assume the connectors match.',
      },
      {
        type: 'p',
        text: 'Field preventive maintenance usually includes cooling flow and temperature, flashlamp condition or shot count if the console or the PM log has it, energy at the fiber compared with the set value, aiming beam, and a check that the footswitch and interlocks actually open the shutter path. Inspect the fiber. A damaged fiber can look like a weak laser and can burn a drape if it fails during a case. Measure with a meter whose sensor is rated for the wavelength and the energy. Compare the reading to the tolerance in the procedure you were hired to run. Do not invent a percentage because another laser in the van uses one.',
      },
      {
        type: 'p',
        text: 'This is a Class 4 laser. Wear eyewear specified for the wavelength, control the room, and do not bypass an interlock to “get a number.” High voltage is present around a flashlamp supply. Follow the manual’s discharge steps before you touch the cavity. If the console reports a fault, start with power, cooling, interlocks, and the fiber before you replace a cavity part. A separate note on this site walks that sequence without listing numeric codes.',
      },
      {
        type: 'p',
        text: 'A service company uses the manual for the adjustment and the parts identification, then writes the measured energy, the meter, and the calibration due date on the report. This page is original notes. It is not the OEM text. Sign up to view the document.',
      },
    ],
    related: [
      { href: '/troubleshooting/lumenis-versapulse-error-codes', label: 'VersaPulse fault troubleshooting guide' },
      { href: '/blog/verify-aesthetic-laser-output', label: 'How to verify laser output' },
      { href: '/blog/how-to-calculate-laser-fluence', label: 'How to calculate laser fluence' },
      { href: '/calculators', label: 'Fluence and power calculators' },
    ],
  },
  {
    makeSlug: 'samsung',
    makeName: 'Samsung',
    modelSlug: 'rs80a',
    modelName: 'RS80A',
    title: 'Samsung RS80A Ultrasound Service Manual',
    documentType: 'Service',
    equipmentType: 'Ultrasound',
    keyword: 'samsung rs80a service manual',
    updatedAt: CONTENT_UPDATED,
    description:
      'Samsung RS80A service manual notes: what the ultrasound service document covers, probe-port and electrical-safety checks, and how a biomedical shop uses it. Free account to view the file.',
    notes: [
      {
        type: 'p',
        text: 'A Samsung RS80A service manual is the cart-level document for that diagnostic ultrasound system. The library title is Samsung RS80A Ultrasound Service Manual. This is imaging equipment used in radiology, shared service, and women’s health rooms. It is not a surgical laser, and the service visit is not an output-power check with an energy meter.',
      },
      {
        type: 'p',
        text: 'A service manual for a cart ultrasound system typically covers AC power and battery backup if fitted, the console and monitor, the probe ports, the back-end that builds the image, software reload or configuration, and electrical safety. It will identify boards and ports. It will not teach you to interpret a clinical image. If the complaint is “the pictures look wrong,” separate a failed probe or port from a preset or a user setting before you reload software.',
      },
      {
        type: 'p',
        text: 'Preventive maintenance for a service company is mostly inspection and measurement that a surveyor can follow. Look at the cart, brakes, and cables. Check each probe connector for bent pins and each cable for bites and cuts. Confirm the system recognizes the transducers the facility owns, and record the probe model and serial, not only the cart serial. Run electrical safety with an analyzer. If the facility has a phantom and the procedure calls for it, do the image check the procedure describes and say which phantom you used. Gel, high-level disinfection, and probe soaking belong to the facility’s infection-control policy. Do not invent a chemical.',
      },
      {
        type: 'p',
        text: 'Do not move a suspect probe onto another port “to see,” and do not move it onto another machine, until you know you are not spreading a connector fault or a contaminated probe. If a port is damaged, tag it. The manual is how you confirm the port layout and the replacement. Match the software level on the cart to the procedure before you load anything.',
      },
      {
        type: 'p',
        text: 'On the report, name the cart and every probe you actually connected, the analyzer and its calibration due date, and the safety readings. These notes are ours. They do not copy Samsung’s text or tables. Sign up to open the manual.',
      },
    ],
    related: [
      { href: '/service-manuals/ge/dash-3000-4000', label: 'GE Dash 3000/4000 patient monitor manual' },
      { href: '/blog/bmet-service-report-template', label: 'What to record on the service report' },
      { href: '/service-manuals', label: 'All public service-manual notes' },
    ],
  },
  {
    makeSlug: 'uroview',
    makeName: 'UroView',
    modelSlug: '2800',
    modelName: '2800',
    title: 'UroView 2800 Service Manual',
    documentType: 'Service',
    equipmentType: 'Urology C-arm',
    keyword: 'uroview 2800 service manual',
    updatedAt: CONTENT_UPDATED,
    description:
      'UroView 2800 service manual notes for this urology C-arm: imaging chain, mechanical checks, radiation cautions, and how a service company uses the document. Free account to view it.',
    notes: [
      {
        type: 'p',
        text: 'A UroView 2800 service manual is the document for this urology fluoroscopy system. The library title is UroView 2800 Service Manual. Treat it as an X-ray device that happens to be shaped like a C-arm for endourology, not as a generic mobile C-arm and not as a laser lithotripter. Cases are often ureteroscopy and similar stone work. The room may also contain a holmium laser. The laser is a different machine with a different manual.',
      },
      {
        type: 'p',
        text: 'Service documentation for a system like this typically covers the X-ray generator, the imaging chain (image intensifier or detector, camera, and monitor), collimation, exposure control, and the C geometry: brakes, locks, and counterbalance. Cables and high-voltage connections are part of the job. So is the table interface when the C-arm is sold with a urology table. Identify the exact configuration on the data plate before you order a detector part or a collimator assembly.',
      },
      {
        type: 'p',
        text: 'Mechanical checks matter as much as the image. A C that drifts, a brake that does not hold, or a lock that looks engaged and is not, is a clinical hazard over a sterile field. Check travel and locks at the positions the room actually uses. Then look at the image: collimation, orientation, and whether the monitor shows what the procedure says it should show. Do not generate X-rays to “see if it wakes up” without the facility’s radiation rules, monitoring if your role requires it, and a measurement method the service procedure specifies.',
      },
      {
        type: 'p',
        text: 'Electrical safety still applies to the system. Record generator technique only if you were supposed to expose, and record any radiation or image measurement the procedure asks for, with the meter identity and calibration due date. If you did not expose, say that you did not. A blank “fluoro OK” line is not a result.',
      },
      {
        type: 'p',
        text: 'A service company uses the manual to separate a generator fault from a mechanical fault and to name the assembly before it is ordered. These notes are original. They are not the OEM procedure and they do not include technique charts. Sign up to view the file.',
      },
    ],
    related: [
      { href: '/blog/bmet-service-report-template', label: 'How to write the service report' },
      { href: '/service-manuals/coherent/versapulse-powersuite', label: 'VersaPulse PowerSuite, often in the same room' },
      { href: '/service-manuals', label: 'All public service-manual notes' },
    ],
  },
];

export const BLOG_POSTS: ArticleEntry[] = [
  {
    slug: 'how-to-calculate-laser-fluence',
    title: 'How to calculate laser fluence',
    description:
      'Fluence in J/cm² is pulse energy divided by spot area. A worked circular spot, a square spot, the mm-versus-cm mistake, and when to use the RepairPlanet calculators.',
    updatedAt: CONTENT_UPDATED,
    blocks: [
      {
        type: 'p',
        text: 'Fluence is energy delivered per unit area. Field service uses it when a procedure, a clinical preset, or a service spec is written in joules per square centimeter and the console is showing joules, watts, or a spot size in millimeters. The arithmetic is short. The unit mistakes are not. This note is for biomedical and laser service engineers who already work around the device. It is not a treatment protocol, and it does not replace the service manual for the system in front of you.',
      },
      {
        type: 'h2',
        text: 'The formula',
      },
      {
        type: 'p',
        text: 'J/cm² = energy (J) / spot area (cm²). Energy is the pulse energy that actually lands in the spot you are describing, in joules. Area is that spot, in square centimeters. If you have average power and a pulse rate instead of energy, energy per pulse in joules is average power in watts divided by pulses per second, but only when the duty is a simple pulse train. If you are not sure the console’s “energy” is per pulse, stop and read what that field means on that model before you divide.',
      },
      {
        type: 'p',
        text: 'Spot area has to be in square centimeters or the result is not in J/cm². For a circular spot, area = π × r², with r in centimeters. For a square or rectangle, area = width × height, again in centimeters. Diameter and side length on handpieces are almost always marked in millimeters. Convert before you square anything: centimeters = millimeters / 10.',
      },
      {
        type: 'h2',
        text: 'Worked example: 10 mm round spot, 5 J',
      },
      {
        type: 'p',
        text: 'Take a round spot with a diameter of 10 mm and a pulse energy of 5.0 J. Diameter is 1.0 cm, so the radius is 0.5 cm. Area = π × (0.5)² = π × 0.25 = 0.785 cm², using 3.1416 for π. Fluence = 5.0 J / 0.785 cm² = 6.37 J/cm². Rounded to two decimal places that is the number you would write next to the setting if the procedure asks for fluence and you trusted both the energy and the spot size.',
      },
      {
        type: 'p',
        text: 'Check the same sum the long way in millimeters and then convert. Radius 5 mm, area = π × 25 = 78.54 mm². There are 100 mm² in 1 cm², so area = 0.7854 cm². Same fluence. The [fluence calculator](/calculators) on this site uses spot size in millimeters and does this conversion for you. Use it to check the arithmetic, then write the inputs on the report so someone else can repeat it.',
      },
      {
        type: 'h2',
        text: 'A square spot',
      },
      {
        type: 'p',
        text: 'Some handpieces are square. An 8 mm × 8 mm spot is 0.8 cm × 0.8 cm = 0.64 cm². At 20 J in that spot, fluence = 20 / 0.64 = 31.25 J/cm². If the spot is rectangular, measure both sides. Do not square the “spot size” number from a brochure if the beam is not round. If the procedure names a spot and the handpiece has a different distance guide installed, the area changed and the fluence changed with it.',
      },
      {
        type: 'h2',
        text: 'Mistakes that look like a bad laser',
      },
      {
        type: 'p',
        text: 'Dividing joules by area in square millimeters makes the fluence one hundred times too small. Using diameter instead of radius makes the area four times too large and the fluence four times too small. Mixing a per-pulse energy with an average-power reading produces a number that is not fluence. Treating a 10 mm spot as 10 cm is a hundredfold error in area. Any of these can start an argument with a clinic that is actually inside tolerance.',
      },
      {
        type: 'p',
        text: 'Fluence is not irradiance. Irradiance is power per area, in W/cm², and it is the right quantity for a continuous-wave beam: power (W) / area (cm²). Pulsed systems sometimes list both an energy and an average power. Do not drop average power into the fluence formula. The calculators page computes fluence and irradiance separately for that reason.',
      },
      {
        type: 'h2',
        text: 'What to write down',
      },
      {
        type: 'p',
        text: 'A fluence number without the inputs is not a measurement. Record the device model and serial, the wavelength, the delivery device or handpiece, the set energy, the spot shape and size, the area you used, and the fluence you calculated. If you measured energy with a meter, record the measured energy too, plus the meter make, model, serial, and calibration due date. The tolerance belongs to the service procedure or the facility’s PM sheet. This page does not assign one.',
      },
      {
        type: 'p',
        text: 'On a Total Service Pro service report, performance rows take a channel or wavelength, a set value, a measured value, and a unit. Put the fluence result there when fluence is what the procedure asked for, and put the spot size in the comments so the row can be rebuilt. The [service report note](/blog/bmet-service-report-template) lists the rest of the fields that should sit around that number.',
      },
      {
        type: 'h2',
        text: 'What the formula does not authorize',
      },
      {
        type: 'p',
        text: 'Calculating fluence does not mean you should fire the laser. Eyewear has to match the wavelength, the room has to be controlled, and the meter sensor has to be rated for that wavelength and that energy. A fiber or handpiece aimed at a sensor is still a Class 4 beam. Do not bypass an interlock to complete a calculation. If the console energy and the meter energy disagree, the fluence you compute from the console is not the fluence on the tissue. Sort that out with an output check before you adjust anything.',
      },
      {
        type: 'p',
        text: 'For a surgical holmium system such as the VersaPulse PowerSuite, start with the [output check](/blog/verify-aesthetic-laser-output) and the [fault guide](/troubleshooting/lumenis-versapulse-error-codes), and use the [service manual notes](/service-manuals/coherent/versapulse-powersuite) when the work turns into an adjustment. The same arithmetic applies to aesthetic lasers. The same arithmetic does not apply to anesthesia machines, monitors, or ultrasound. Those devices do not have a spot size.',
      },
    ],
    related: [
      { href: '/calculators', label: 'Photometry calculators' },
      { href: '/blog/verify-aesthetic-laser-output', label: 'Verify laser output against the setting' },
      { href: '/service-manuals/coherent/versapulse-powersuite', label: 'VersaPulse PowerSuite Rev. C notes' },
      { href: '/troubleshooting/lumenis-versapulse-error-codes', label: 'VersaPulse fault troubleshooting' },
    ],
  },
  {
    slug: 'bmet-service-report-template',
    title: 'What a biomedical service report needs',
    description:
      'Device identity, work performed, test equipment with calibration dates, electrical safety, parts, and signatures — and how Total Service Pro service reports capture them.',
    updatedAt: CONTENT_UPDATED,
    blocks: [
      {
        type: 'p',
        text: 'A service report is the record that the device was identified, that specified work was done, and that the measurements came from equipment you can still trace. Surveyors, the facility’s biomedical department, and the next technician all read it later, without you in the room. The same sheet has to make sense for an anesthesia machine, a patient monitor, an ultrasound cart, a urology C-arm, or a laser. A laser-only checklist with no serial number does not cover that.',
      },
      {
        type: 'h2',
        text: 'Device identity',
      },
      {
        type: 'p',
        text: 'Name the manufacturer, the model, and the serial number as they appear on the device, not as they appear in the dispatch text. If the facility uses an asset number, write that too, plus the room when the hospital has several of the same model. For ultrasound, write each probe model and serial you connected, not only the cart. For a C-arm, say which serial you worked on if the table is a separate device. A report that says “the laser” cannot be matched to a recall.',
      },
      {
        type: 'h2',
        text: 'Work performed',
      },
      {
        type: 'p',
        text: 'State the type of visit in plain language: preventive maintenance, repair, incoming inspection, or a return visit after parts. Then say what you did. Checklists are the repeatable part — electrical, mechanical, and the condition items your procedure uses — with a result on each line you actually performed. Leave a line blank or mark it not applicable when you did not do it. Do not mark pass on a test you skipped.',
      },
      {
        type: 'p',
        text: 'Measurements are the other half of “work performed.” Leak rate, ventilator volume, NIBP result, ground resistance, leakage current, laser energy, exposure reading: the number, the unit, and whether it met the limit in the procedure you were following. The limit comes from that procedure or from the service manual, not from a number you remember from a different model. A narrative sentence at the end should say what you found and what you left the device as: returned to service, left tagged out, or waiting on a part.',
      },
      {
        type: 'h2',
        text: 'Test equipment and calibration dates',
      },
      {
        type: 'p',
        text: 'Every quantitative result needs the instrument behind it. Write the type, make, model, and serial number, and the calibration date or calibration due date so a reader can see the meter was in calibration on the day of the visit. “Safety analyzer” is not an instrument. A specific analyzer with a due date is. If you used more than one meter — an electrical safety analyzer and an energy meter, for example — list both, and mark which one was used on this call. A shop inventory that stores calibration dates is only useful if the date is copied onto the report. The inventory is not the report.',
      },
      {
        type: 'h2',
        text: 'Electrical safety',
      },
      {
        type: 'p',
        text: 'Protective earth (ground resistance) and leakage current are the readings most biomedical reports are expected to show on mains-powered equipment. Record the value and the unit, ohms and microamps, and pass or fail against the limit you used. A laser, a monitor, an anesthesia machine, an ultrasound cart, and a C-arm all get this test when the procedure says so. The chassis is still plugged into the wall.',
      },
      {
        type: 'h2',
        text: 'Parts',
      },
      {
        type: 'p',
        text: 'If you installed a part, write the description, the part number if you have it, and the quantity. If you recommended a part and did not install it, write that separately so the next invoice does not look like the part is already in the machine. “Replaced board” without a number is how the wrong assembly gets ordered the second time. If no parts were used, say so.',
      },
      {
        type: 'h2',
        text: 'Signatures',
      },
      {
        type: 'p',
        text: 'The technician who did the work should sign, and the date of service should be on the same report. Some facilities also want a customer signature or a printed name acknowledging the visit. If they do, capture it. A typed name with no date, or a signature clipped from a different report, is not a signature. The person who signs is saying the tests above were the tests performed.',
      },
      {
        type: 'h2',
        text: 'How Total Service Pro builds the report',
      },
      {
        type: 'p',
        text: 'Total Service Pro service reports are the shop document behind RepairPlanet, for companies that service this mix of equipment. The form identifies the customer, then the device: equipment name from the manufacturer and model, serial number, and a link to the customer’s equipment record when you have one. Service type, date of service, next PM due, ticket number, and the engineer’s name are on the same header. A report number is generated for the shop.',
      },
      {
        type: 'p',
        text: 'Work performed is the checklist for that equipment type — electrical, mechanical, and condition items — plus performance rows. Each row has a channel or wavelength, the set value, the measured value, and a unit. The printed report shows deviation and pass or fail. Comments are the narrative: what you found, parts installed or still needed, and follow-up. That field is labeled Comments / Parts Needed.',
      },
      {
        type: 'p',
        text: 'Electrical safety is two measurements on the form. Ground resistance is entered in ohms. The form labels the spec as ≤ 0.2 Ω. Leakage current is entered in microamps. The form labels the spec as ≤ 300 µA. Each has its own pass or fail. If the service manual or the facility’s procedure uses a different limit, follow that limit and say which limit you used in the comments. The labels on the form are the defaults, not a substitute for the device procedure.',
      },
      {
        type: 'p',
        text: 'Test equipment lines are type, make and model, serial number, and calibration due date, with a checkbox for used on this call. Rows can be pulled from the shop’s test equipment list, which also stores the calibration date. Add a line if the meter is not already there. The technician signs on the report. If the pad is still blank at submit, the profile signature is stored instead, with the date signed. Empty measurements stay empty. Procedure limits still come from the manual. Public notes are under [service manuals](/service-manuals). Laser math is on the [calculators](/calculators), and the meter setup is in [verifying laser output](/blog/verify-aesthetic-laser-output).',
      },
    ],
    related: [
      { href: '/service-manuals', label: 'Service manual notes' },
      { href: '/calculators', label: 'Photometry calculators' },
      { href: '/blog/verify-aesthetic-laser-output', label: 'Verify laser output' },
      { href: '/signup', label: 'Register a repair company' },
    ],
  },
  {
    slug: 'verify-aesthetic-laser-output',
    title: 'How to verify aesthetic laser output',
    description:
      'Set up a power or energy meter, compare the reading to the displayed setting, and record the result against the device, the delivery system, and the meter’s calibration.',
    updatedAt: CONTENT_UPDATED,
    blocks: [
      {
        type: 'p',
        text: 'The number on a laser console is a setting. It is not, by itself, the energy or power coming out of the handpiece or the fiber. Verifying output means measuring that beam with a meter and comparing the measurement to the setting, inside a tolerance you can point to. Aesthetic lasers and surgical lasers both need this. So do dual-wavelength platforms. An anesthesia machine does not. This is the optical check, done the same way a safety analyzer is the electrical check: with an instrument, a limit, and a written result.',
      },
      {
        type: 'h2',
        text: 'Pick the meter before you book the visit',
      },
      {
        type: 'p',
        text: 'Use an energy meter when the quantity is joules per pulse. Use a power meter when the quantity is watts of a continuous beam. Some sensors do both if the meter is set to the right mode. The sensor has to be rated for the wavelength and for the energy or power you are about to put on it. A sensor built for a low-power aiming beam will be destroyed by a treatment pulse, and the reading you get on the way there is meaningless. Check the calibration due date before you leave the shop. A meter past due is a reason to reschedule the measurement, not a reason to “note it and go.”',
      },
      {
        type: 'p',
        text: 'Read the meter’s own setup for distance, aperture, and whether the beam must fill the sensor or must stay inside a marked circle. Those conditions are part of the measurement. Holding a fiber “about an inch off” a sensor because that is what you did on a different brand is how two technicians get two fluences from one laser.',
      },
      {
        type: 'h2',
        text: 'Set the beam path up',
      },
      {
        type: 'p',
        text: 'Identify the device: manufacturer, model, serial, and the wavelength you are testing. Identify the delivery device. On a fiber system, record the fiber serial or the fiber you installed for the test, and inspect it. A chipped tip or a broken fiber throws energy out the side and lowers the reading at the sensor. On a handpiece, record the handpiece and the spot size or distance guide that is installed. The spot size changes fluence even when the console energy does not change. If you need J/cm², calculate it from the measured energy and that area. The [fluence note](/blog/how-to-calculate-laser-fluence) and the [calculators](/calculators) are the arithmetic. They are not the measurement.',
      },
      {
        type: 'p',
        text: 'Put the sensor where the procedure says. Keep the beam normal to the sensor face unless the meter manual says otherwise. Do not let the fiber tip touch the sensor coating unless that meter is built for contact. Keep reflective instruments out of the beam. The person firing holds the footswitch or the handpiece control and is the only person who should be able to emit. Everyone else is out of the nominal hazard zone, with eyewear rated for that wavelength.',
      },
      {
        type: 'h2',
        text: 'Compare the reading to the setting',
      },
      {
        type: 'p',
        text: 'Warm the system up if the service procedure says to. Select a setting the procedure names, often a mid-range clinical setting and a second point near the high end if both are required. Fire the number of pulses the procedure specifies. Read the meter, not the console. The console will repeat the setting you typed. That is not new information.',
      },
      {
        type: 'p',
        text: 'Percent difference is (measured − set) / set × 100, using the same units in both places. A reading of 8.4 J against a 10 J setting is (8.4 − 10) / 10 × 100 = −16%. Whether −16% passes is not a universal rule. The tolerance is the one in the service manual or the facility’s PM procedure for that model and that wavelength. Write the allowed band on the report next to the result. Passing a laser because “20% is what we use on the other one” is how a system that is actually out of spec stays in service.',
      },
      {
        type: 'p',
        text: 'If the reading is low, do not calibrate yet. Check the fiber or handpiece, the sensor alignment, and the meter mode. Measure again. A dirty delivery device is a common cause of a low reading and it is not fixed by raising the console calibration. If the second reading still falls outside the written tolerance, then you are in the adjustment section of the service manual, not in a guessed offset.',
      },
      {
        type: 'h2',
        text: 'Record it against the device',
      },
      {
        type: 'p',
        text: 'The result has to point at one serial number. Write the model and serial, the wavelength, the delivery device, the set value, the measured value, the unit, the percent difference, and pass or fail against the stated tolerance. Write the meter make, model, serial, and calibration due date. If you adjusted the system, write the before and after readings. If you did not emit, do not write a power number.',
      },
      {
        type: 'p',
        text: 'In Total Service Pro that measured pair goes on a performance row: channel or wavelength, set, measured, and unit. The printed report calculates deviation and shows pass or fail. The meter goes on a test-equipment line with its calibration due date, marked used on this call. Ground resistance and leakage current still belong on the same report when the procedure includes electrical safety. Output and electrical safety are different tests. See the [service report fields](/blog/bmet-service-report-template) for the rest of the sheet.',
      },
      {
        type: 'h2',
        text: 'Safety while you measure',
      },
      {
        type: 'p',
        text: 'Do not disable a door interlock, a remote interlock, or a footswitch to make the shot easier to catch. Do not look along the fiber. Do not fire into the room to “see the spot” on a wall. Holmium and other infrared beams are not visible as a treatment beam; the aiming beam is not the hazard you are measuring. If the system will not fire, treat that as a fault. Power, cooling, interlock, and fiber checks come before a cavity part. The [VersaPulse fault guide](/troubleshooting/lumenis-versapulse-error-codes) is that sequence for the PowerSuite, and the [Rev. C notes](/service-manuals/coherent/versapulse-powersuite) say what the service document is for. The same measurement habits apply to other aesthetic and surgical lasers in the library. The pass band still comes from the manual for that model.',
      },
    ],
    related: [
      { href: '/calculators', label: 'Fluence and irradiance calculators' },
      { href: '/blog/how-to-calculate-laser-fluence', label: 'Calculate fluence from energy and spot size' },
      { href: '/blog/bmet-service-report-template', label: 'Service report fields' },
      { href: '/service-manuals/coherent/versapulse-powersuite', label: 'VersaPulse PowerSuite Rev. C' },
      { href: '/troubleshooting/lumenis-versapulse-error-codes', label: 'VersaPulse fault troubleshooting' },
    ],
  },
];

export const TROUBLESHOOTING_GUIDES: ArticleEntry[] = [
  // TODO: Add a verified VersaPulse error-code table only after each code is checked against the service manual. Do not invent codes.
  {
    slug: 'lumenis-versapulse-error-codes',
    title: 'VersaPulse fault troubleshooting guide',
    description:
      'A general VersaPulse PowerSuite fault approach: power, interlocks, cooling, flashlamp, and calibration checks, plus when to open the service manual. No error-code table.',
    updatedAt: CONTENT_UPDATED,
    blocks: [
      {
        type: 'p',
        text: 'This is a field sequence for Coherent VersaPulse PowerSuite systems when the console will not ready, will not fire, or fires and the site says the effect is weak. The VersaPulse line is now supported under Lumenis. The service document in this library is still filed under Coherent as VersaPulse PowerSuite Rev. C. Clinics will use either name. This page does not list error codes. Numeric codes get published here only after they are read from the service manual. Until then, chasing a code you found on a forum is how the wrong part gets swapped.',
      },
      {
        type: 'h2',
        text: 'Before the cover comes off',
      },
      {
        type: 'p',
        text: 'Write down the complaint in the staff’s words and what they were doing when it started: a new fiber, a room move, a cooling-water top-off, a case that ran long, a recent PM. Record the serial number and which revision of the manual you are going to use. Rev. C is the one in the library. If the nameplate shows a different configuration or a second wavelength, do not assume the single-wavelength steps you used last month.',
      },
      {
        type: 'p',
        text: 'Safety sits in front of the fault tree. This is a Class 4 laser. Eyewear has to match the wavelength in use. The room is controlled. One person owns the footswitch. Do not jumper an interlock, a cover switch, or the remote plug to finish a case or to “see if the lamp is good.” The flashlamp supply is high voltage. After you remove power, follow the discharge procedure in the service manual before you touch the cavity. Do not invent a wait time. Cooling water on the floor is a shock hazard as well as a cooling fault.',
      },
      {
        type: 'h2',
        text: 'Power',
      },
      {
        type: 'p',
        text: 'Confirm the outlet, the breaker, and the cord before you open a panel. Note whether the console comes up, whether fans run, and whether the display is alive. A system that never powers is a supply problem until you prove otherwise. A system that powers and then drops during ready may be cooling or an interlock that opens as something warms up. Those are different visits. Do not replace a cavity assembly because the screen stayed dark.',
      },
      {
        type: 'h2',
        text: 'Interlocks',
      },
      {
        type: 'p',
        text: 'A VersaPulse that “won’t fire” is often an open interlock. Check the remote interlock plug, the door switch, the fiber or delivery inserted and seated, the cover switches, and the footswitch. Watch which ready lamp or which message changes as you seat the fiber. If seating the fiber is what allows ready, the cavity is not your first part. Do not defeat the door switch with tape. If the room’s door switch is broken, the facility has to fix the room or you have to follow their written temporary procedure. You do not invent one.',
      },
      {
        type: 'h2',
        text: 'Cooling',
      },
      {
        type: 'p',
        text: 'Check water level, flow, temperature, hoses, and the filter or strainer the manual names. Compare room temperature and supply voltage to the installation conditions for that system. Many faults that get described as laser faults on flashlamp-pumped surgical lasers are cooling faults: low flow, a kinked hose after a room move, or water that was filled with the wrong fluid. Do not run the system with no flow to “see if the lamp still flashes.” If you are not sure what fluid belongs in it, stop and use the manual. The wrong fluid is a pump and cavity repair, not a top-off.',
      },
      {
        type: 'h2',
        text: 'Flashlamp and delivery',
      },
      {
        type: 'p',
        text: 'If the console shows a shot count or the PM log has a lamp age, write it down before you change anything. Separate the aiming beam from the treatment beam. An aiming beam with no treatment output is not the same fault as a dead system, and a weak aiming beam is not an energy measurement. Inspect the fiber for breaks, burns, and a damaged tip. A bad fiber imitates a weak laser and is dangerous to keep using. Lamp replacement and any cavity alignment are service-manual procedures. Do them from the current revision, with the discharge steps, not from memory of a similar Coherent or Lumenis system.',
      },
      {
        type: 'h2',
        text: 'Calibration only after the beam path is honest',
      },
      {
        type: 'p',
        text: 'If the system fires and the complaint is low effect, measure energy at the delivery device with a meter rated for the wavelength and the energy. Compare the reading to the set value and to the tolerance in the procedure. The [output check](/blog/verify-aesthetic-laser-output) is that setup. Use the [fluence formula](/blog/how-to-calculate-laser-fluence) only when the spec is in J/cm², and check the math on the [calculators](/calculators). Recalibrate only by the manual’s procedure, and record the before and after values. Raising a calibration to hide a damaged fiber will be out of spec again as soon as the next fiber goes on, and it may be over the limit with a good fiber.',
      },
      {
        type: 'h2',
        text: 'When to open the service manual',
      },
      {
        type: 'p',
        text: 'Open the manual for any adjustment, any lamp or cavity work, any high-voltage measurement, and any fault that is still present after power, interlocks, cooling, and the fiber have been checked. The public notes for the library document are on the [VersaPulse PowerSuite Rev. C page](/service-manuals/coherent/versapulse-powersuite). The file itself is behind a free account. While you are in there, copy the official code list only if you are looking at that revision. Do not paste an unverified table into a report.',
      },
      {
        type: 'p',
        text: 'Write the visit up so the next person does not repeat it: complaint, serial, what you checked, what you measured, which meter, and whether the system was returned to service. The [service report note](/blog/bmet-service-report-template) is the field list. Electrical safety still belongs on that report if you had the covers on or the procedure includes it. A laser fault does not cancel the ground-resistance reading.',
      },
    ],
    related: [
      { href: '/service-manuals/coherent/versapulse-powersuite', label: 'VersaPulse PowerSuite Rev. C notes' },
      { href: '/blog/verify-aesthetic-laser-output', label: 'Verify output with a meter' },
      { href: '/blog/how-to-calculate-laser-fluence', label: 'Calculate fluence' },
      { href: '/calculators', label: 'Photometry calculators' },
      { href: '/blog/bmet-service-report-template', label: 'Service report fields' },
    ],
  },
];

const HUB_INTRO: Record<string, ContentBlock[]> = {
  '/service-manuals': [
    {
      type: 'p',
      text: 'These pages describe service documents in the RepairPlanet library for independent biomedical and aesthetic-laser companies. The mix is the mix those shops actually see: anesthesia workstations, patient monitors, ultrasound, urology C-arms, and surgical and aesthetic lasers. Each landing gives the catalog title, the make and model, the document type, the equipment type, and original notes on what the manual is for. It does not include the file, the storage location, or the OEM’s text.',
    },
    {
      type: 'p',
      text: 'Open a make to see its models. The document itself is available after a free account, inside the signed-in library. Field notes that are not tied to one manual are on the [service notes](/blog) and [troubleshooting](/troubleshooting) pages. Laser fluence and irradiance arithmetic is on the [calculators](/calculators).',
    },
  ],
  '/blog': [
    {
      type: 'p',
      text: 'Notes for people who service medical equipment in the field: biomedical technicians and laser service engineers working for independent shops. The first pieces cover fluence math, checking laser output against the setting, and the fields a service report needs when the device might be an anesthesia machine, a monitor, an ultrasound system, a C-arm, or a laser.',
    },
    {
      type: 'p',
      text: 'Device-specific document notes are under [service manuals](/service-manuals). Fault sequences are under [troubleshooting](/troubleshooting). The [calculators](/calculators) handle fluence and irradiance once you have a real energy or power reading.',
    },
  ],
  '/troubleshooting': [
    {
      type: 'p',
      text: 'Troubleshooting notes for equipment a field company is called on. The first guide is a VersaPulse PowerSuite fault approach. It does not invent error codes. More devices will be added the same way: power and safety first, then the checks a technician can do without guessing a part number, then a pointer to the service manual when the work becomes an adjustment.',
    },
    {
      type: 'p',
      text: 'The library covers more than lasers. Manual notes for anesthesia, monitors, ultrasound, and urology C-arms are on the [service manuals](/service-manuals) hub. Measurement write-ups belong on the [service report](/blog/bmet-service-report-template).',
    },
  ],
};

export function blockPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'ul' ? block.items.join(' ') : block.text))
    .join(' ');
}

export function wordCount(text: string): number {
  const plain = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return plain.trim().split(/\s+/).filter(Boolean).length;
}

export function manualPath(manual: Pick<ServiceManual, 'makeSlug' | 'modelSlug'>): string {
  return `/service-manuals/${manual.makeSlug}/${manual.modelSlug}`;
}

export function makePath(makeSlug: string): string {
  return `/service-manuals/${makeSlug}`;
}

export function blogPath(slug: string): string {
  return `/blog/${slug}`;
}

export function troubleshootingPath(slug: string): string {
  return `/troubleshooting/${slug}`;
}

export function getManual(makeSlug: string, modelSlug: string): ServiceManual | undefined {
  return SERVICE_MANUALS.find((manual) => manual.makeSlug === makeSlug && manual.modelSlug === modelSlug);
}

export function getBlogPost(slug: string): ArticleEntry | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function getTroubleshootingGuide(slug: string): ArticleEntry | undefined {
  return TROUBLESHOOTING_GUIDES.find((guide) => guide.slug === slug);
}

export type MakeGroup = {
  slug: string;
  name: string;
  manuals: ServiceManual[];
};

export function manualsByMake(): MakeGroup[] {
  const order: string[] = [];
  const groups = new Map<string, ServiceManual[]>();
  for (const manual of SERVICE_MANUALS) {
    const existing = groups.get(manual.makeSlug);
    if (!existing) {
      order.push(manual.makeSlug);
      groups.set(manual.makeSlug, [manual]);
    } else {
      existing.push(manual);
    }
  }
  return order.map((slug) => {
    const manuals = groups.get(slug) || [];
    return { slug, name: manuals[0]?.makeName || slug, manuals };
  });
}

export function getMake(makeSlug: string): MakeGroup | undefined {
  return manualsByMake().find((make) => make.slug === makeSlug);
}

export function hubBlocks(path: string): ContentBlock[] {
  return HUB_INTRO[path] || [];
}

export function makeBlocks(make: MakeGroup): ContentBlock[] {
  const types = [...new Set(make.manuals.map((manual) => manual.equipmentType))].join(', ');
  return [
    {
      type: 'p',
      text: `${make.name} service documents in the public library. Equipment types on this page: ${types}. Each model page lists the catalog title, whether the document is a service or operator manual, and original notes on how a field company uses it. The file stays in the signed-in library.`,
    },
    {
      type: 'p',
      text: 'These notes are not limited to lasers. If a make below is an anesthesia machine, a monitor, an ultrasound system, or a C-arm, the PM and the report follow that device. Laser fluence tools stay on the [calculators](/calculators) for the systems that actually have a spot size.',
    },
  ];
}

export type ContentKind = 'Article' | 'TechArticle';

export type IndexableContent = {
  path: string;
  title: string;
  description: string;
  updatedAt: string;
  kind: ContentKind;
  breadcrumbs: { name: string; path: string }[];
};

export function manualIndexable(manual: ServiceManual): IndexableContent {
  return {
    path: manualPath(manual),
    title: manual.title,
    description: manual.description,
    updatedAt: manual.updatedAt,
    kind: 'TechArticle',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Service manuals', path: SERVICE_MANUALS_HUB.path },
      { name: manual.makeName, path: makePath(manual.makeSlug) },
      { name: manual.modelName, path: manualPath(manual) },
    ],
  };
}

export function blogIndexable(post: ArticleEntry): IndexableContent {
  return {
    path: blogPath(post.slug),
    title: post.title,
    description: post.description,
    updatedAt: post.updatedAt,
    kind: 'Article',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Field notes', path: BLOG_HUB.path },
      { name: post.title, path: blogPath(post.slug) },
    ],
  };
}

export function troubleshootingIndexable(guide: ArticleEntry): IndexableContent {
  return {
    path: troubleshootingPath(guide.slug),
    title: guide.title,
    description: guide.description,
    updatedAt: guide.updatedAt,
    kind: 'TechArticle',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Troubleshooting', path: TROUBLESHOOTING_HUB.path },
      { name: guide.title, path: troubleshootingPath(guide.slug) },
    ],
  };
}

export function hubIndexable(
  hub: { path: string; title: string; description: string; updatedAt: string },
  crumb: string,
): IndexableContent {
  let updatedAt = hub.updatedAt;
  if (hub.path === SERVICE_MANUALS_HUB.path) {
    updatedAt = latestDate(SERVICE_MANUALS.map((manual) => manual.updatedAt));
  } else if (hub.path === BLOG_HUB.path) {
    updatedAt = latestDate(BLOG_POSTS.map((post) => post.updatedAt));
  } else if (hub.path === TROUBLESHOOTING_HUB.path) {
    updatedAt = latestDate(TROUBLESHOOTING_GUIDES.map((guide) => guide.updatedAt));
  }
  return {
    path: hub.path,
    title: hub.title,
    description: hub.description,
    updatedAt,
    kind: 'Article',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: crumb, path: hub.path },
    ],
  };
}

export function makeIndexable(make: MakeGroup): IndexableContent {
  const types = [...new Set(make.manuals.map((manual) => manual.equipmentType))].join(', ');
  const updatedAt = latestDate(make.manuals.map((manual) => manual.updatedAt));
  return {
    path: makePath(make.slug),
    title: `${make.name} service manuals`,
    description: `${make.name} service-manual notes on RepairPlanet. Equipment types: ${types}. Model pages list the catalog title and original field notes. Free account to open a document.`,
    updatedAt,
    kind: 'Article',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Service manuals', path: SERVICE_MANUALS_HUB.path },
      { name: make.name, path: makePath(make.slug) },
    ],
  };
}

export function latestDate(dates: string[]): string {
  return dates.filter(Boolean).sort().at(-1) || CONTENT_UPDATED;
}

export type SitemapEntry = { path: string; lastmod: string };

/**
 * Path + content lastmod. The generated sitemap (app/sitemap.ts via
 * serviceManualSitemapPaths / blogSitemapPaths / troubleshootingSitemapPaths
 * in web/lib/seo.ts) lists these paths. lastmod on the XML is the sitemap
 * generation date from sitemapEntries(), not this field.
 */
export function publicContentSitemapEntries(): SitemapEntry[] {
  const manualDates = SERVICE_MANUALS.map((manual) => manual.updatedAt);
  const blogDates = BLOG_POSTS.map((post) => post.updatedAt);
  const guideDates = TROUBLESHOOTING_GUIDES.map((guide) => guide.updatedAt);
  const entries: SitemapEntry[] = [
    { path: SERVICE_MANUALS_HUB.path, lastmod: latestDate(manualDates) },
    ...manualsByMake().map((make) => ({
      path: makePath(make.slug),
      lastmod: latestDate(make.manuals.map((manual) => manual.updatedAt)),
    })),
    ...SERVICE_MANUALS.map((manual) => ({ path: manualPath(manual), lastmod: manual.updatedAt })),
    { path: BLOG_HUB.path, lastmod: latestDate(blogDates) },
    ...BLOG_POSTS.map((post) => ({ path: blogPath(post.slug), lastmod: post.updatedAt })),
    { path: TROUBLESHOOTING_HUB.path, lastmod: latestDate(guideDates) },
    ...TROUBLESHOOTING_GUIDES.map((guide) => ({
      path: troubleshootingPath(guide.slug),
      lastmod: guide.updatedAt,
    })),
  ];
  return entries;
}

/** Hub, make, and model paths. Consumed by serviceManualSitemapPaths() in web/lib/seo.ts. */
export function serviceManualSitemapPaths(): string[] {
  return publicContentSitemapEntries()
    .map((entry) => entry.path)
    .filter((path) => path === '/service-manuals' || path.startsWith('/service-manuals/'));
}

/** Hub and post paths. Consumed by blogSitemapPaths() in web/lib/seo.ts. */
export function blogSitemapPaths(): string[] {
  return publicContentSitemapEntries()
    .map((entry) => entry.path)
    .filter((path) => path === '/blog' || path.startsWith('/blog/'));
}

/** Hub and guide paths. Consumed by troubleshootingSitemapPaths() in web/lib/seo.ts. */
export function troubleshootingSitemapPaths(): string[] {
  return publicContentSitemapEntries()
    .map((entry) => entry.path)
    .filter((path) => path === '/troubleshooting' || path.startsWith('/troubleshooting/'));
}

export function allIndexableContent(): IndexableContent[] {
  return [
    hubIndexable(SERVICE_MANUALS_HUB, 'Service manuals'),
    ...manualsByMake().map(makeIndexable),
    ...SERVICE_MANUALS.map(manualIndexable),
    hubIndexable(BLOG_HUB, 'Field notes'),
    ...BLOG_POSTS.map(blogIndexable),
    hubIndexable(TROUBLESHOOTING_HUB, 'Troubleshooting'),
    ...TROUBLESHOOTING_GUIDES.map(troubleshootingIndexable),
  ];
}

export function collectContentStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectContentStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectContentStrings(item, out);
  }
  return out;
}
