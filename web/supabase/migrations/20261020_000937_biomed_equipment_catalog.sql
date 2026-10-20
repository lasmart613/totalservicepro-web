-- 000937: Equipment type → manufacturer → model catalog for non-laser types.
--
-- Bug (Larry, Oct 20): Equipment type = Beds on the estimate form still listed
-- only laser manufacturers. The web fix filters manufacturers by type; this
-- seeds the data so every non-laser type has real manufacturers and models.
--
-- Numbering: 000934-000936 are pending in PRs #330, #331, #332. This file does
-- not depend on them and can apply before or after them.
--
-- What changes
--   1. public.manufacturers: inserts the biomed manufacturers that do not
--      already exist (case-insensitive name match). New rows carry
--      category = '000937 biomed seed' so the rollback removes only them.
--      Existing rows (Dornier, GE OEC, or anything a user added) are reused.
--   2. public.laser_models: inserts 125 real, well-known models with
--      equipment_type set, description = '000937 biomed seed'.
--      ON CONFLICT (manufacturer_id, name) DO NOTHING (idempotent).
--      Infant warmers (GE Giraffe / Panda) are not seeded: no fitting type yet.
--   beds                3 manufacturers, 19 models
--   anesthesia          3 manufacturers, 12 models
--   c_arm               4 manufacturers, 8 models
--   defibrillator       4 manufacturers, 12 models
--   endoscope           4 manufacturers, 7 models
--   infusion_pump       4 manufacturers, 9 models
--   patient_monitor     5 manufacturers, 14 models
--   sterile_processing  3 manufacturers, 9 models
--   ultrasound          5 manufacturers, 17 models
--   ventilator          5 manufacturers, 12 models
--   lithotriptor        3 manufacturers, 6 models
--   3. public.equipment: new nullable column equipment_type text with a CHECK
--      on the 12 RepairPlanet types, so My Lasers / equipment forms can store
--      the type the user picked. Existing 2,387 rows stay NULL (read as laser).
--
-- Grants / RLS: no new table. manufacturers, laser_models and equipment keep
-- RLS on and their existing table-level grants, which already cover a new
-- column (no column-level grants exist on equipment). The column is granted
-- explicitly anyway so nothing relies on default privileges.
--
-- Drift guards: the expected columns / unique keys exist, equipment has no
-- equipment_type column of another type, and no unrelated laser_models row
-- already carries the seed marker.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_type text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.manufacturers'::regclass AND contype = 'u'
                   AND pg_get_constraintdef(oid) = 'UNIQUE (name)') THEN
    RAISE EXCEPTION '000937 drift: manufacturers UNIQUE (name) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.laser_models'::regclass AND contype = 'u'
                   AND pg_get_constraintdef(oid) = 'UNIQUE (manufacturer_id, name)') THEN
    RAISE EXCEPTION '000937 drift: laser_models UNIQUE (manufacturer_id, name) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'laser_models'
                   AND column_name = 'equipment_type' AND data_type = 'text') THEN
    RAISE EXCEPTION '000937 drift: laser_models.equipment_type text missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'laser_models'
                   AND column_name = 'description' AND data_type = 'text') THEN
    RAISE EXCEPTION '000937 drift: laser_models.description text missing';
  END IF;
  SELECT data_type INTO v_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'equipment_type';
  IF v_type IS NOT NULL AND v_type <> 'text' THEN
    RAISE EXCEPTION '000937 drift: equipment.equipment_type exists as %', v_type;
  END IF;
  IF EXISTS (SELECT 1 FROM public.laser_models
             WHERE description = '000937 biomed seed' AND equipment_type = 'laser') THEN
    RAISE EXCEPTION '000937 drift: a laser row carries the 000937 seed marker';
  END IF;
END
$guard$;

CREATE TEMP TABLE _m937 (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _m937 (name) VALUES
    ('B. Braun'),
    ('Baxter'),
    ('BD'),
    ('Cardiac Science'),
    ('Dornier'),
    ('Draeger'),
    ('Fujifilm'),
    ('FUJIFILM Sonosite'),
    ('GE Healthcare'),
    ('GE OEC'),
    ('Hamilton Medical'),
    ('Hill-Rom'),
    ('ICU Medical'),
    ('Karl Storz'),
    ('Medtronic'),
    ('Midmark'),
    ('Mindray'),
    ('Olympus'),
    ('Pentax Medical'),
    ('Philips'),
    ('Physio-Control'),
    ('Richard Wolf'),
    ('Samsung Medison'),
    ('Siemens Healthineers'),
    ('Spacelabs'),
    ('STERIS'),
    ('Storz Medical'),
    ('Stryker'),
    ('Tuttnauer'),
    ('Welch Allyn'),
    ('Ziehm Imaging'),
    ('ZOLL');

INSERT INTO public.manufacturers (name, category)
SELECT s.name, '000937 biomed seed'
  FROM _m937 s
 WHERE NOT EXISTS (SELECT 1 FROM public.manufacturers m WHERE lower(m.name) = lower(s.name))
ON CONFLICT (name) DO NOTHING;

CREATE TEMP TABLE _l937 (manufacturer text, name text, equipment_type text) ON COMMIT DROP;
INSERT INTO _l937 (manufacturer, name, equipment_type) VALUES
    ('Midmark', 'Ritter 111', 'beds'),
    ('Midmark', 'Ritter 112', 'beds'),
    ('Midmark', 'Ritter 119', 'beds'),
    ('Midmark', 'Ritter 204', 'beds'),
    ('Midmark', '223', 'beds'),
    ('Midmark', '224', 'beds'),
    ('Midmark', '626', 'beds'),
    ('Midmark', '641', 'beds'),
    ('Hill-Rom', 'Progressa', 'beds'),
    ('Hill-Rom', 'VersaCare', 'beds'),
    ('Hill-Rom', 'TotalCare', 'beds'),
    ('Hill-Rom', 'Centrella', 'beds'),
    ('Hill-Rom', 'Advanta 2', 'beds'),
    ('Hill-Rom', 'CareAssist ES', 'beds'),
    ('Stryker', 'S3 MedSurg Bed', 'beds'),
    ('Stryker', 'InTouch Critical Care Bed', 'beds'),
    ('Stryker', 'ProCuity', 'beds'),
    ('Stryker', 'Secure II', 'beds'),
    ('Stryker', 'Prime Series Stretcher', 'beds'),
    ('Draeger', 'Fabius GS', 'anesthesia'),
    ('Draeger', 'Fabius Plus', 'anesthesia'),
    ('Draeger', 'Apollo', 'anesthesia'),
    ('Draeger', 'Perseus A500', 'anesthesia'),
    ('Draeger', 'Narkomed 2B', 'anesthesia'),
    ('Draeger', 'Narkomed 6000', 'anesthesia'),
    ('GE Healthcare', 'Aisys CS2', 'anesthesia'),
    ('GE Healthcare', 'Aespire 7900', 'anesthesia'),
    ('GE Healthcare', 'Avance CS2', 'anesthesia'),
    ('GE Healthcare', 'Carestation 650', 'anesthesia'),
    ('Mindray', 'A7', 'anesthesia'),
    ('Mindray', 'WATO EX-65', 'anesthesia'),
    ('GE OEC', '9800', 'c_arm'),
    ('GE OEC', 'OEC Elite', 'c_arm'),
    ('Siemens Healthineers', 'Cios Alpha', 'c_arm'),
    ('Siemens Healthineers', 'Arcadis Orbic', 'c_arm'),
    ('Philips', 'BV Pulsera', 'c_arm'),
    ('Philips', 'Zenition 70', 'c_arm'),
    ('Ziehm Imaging', 'Ziehm Vision RFD', 'c_arm'),
    ('Ziehm Imaging', 'Ziehm Solo', 'c_arm'),
    ('ZOLL', 'R Series', 'defibrillator'),
    ('ZOLL', 'X Series', 'defibrillator'),
    ('ZOLL', 'M Series', 'defibrillator'),
    ('ZOLL', 'AED Plus', 'defibrillator'),
    ('Philips', 'HeartStart MRx', 'defibrillator'),
    ('Philips', 'HeartStart XL', 'defibrillator'),
    ('Philips', 'HeartStart FRx', 'defibrillator'),
    ('Physio-Control', 'LIFEPAK 15', 'defibrillator'),
    ('Physio-Control', 'LIFEPAK 20e', 'defibrillator'),
    ('Physio-Control', 'LIFEPAK 1000', 'defibrillator'),
    ('Physio-Control', 'LIFEPAK CR2', 'defibrillator'),
    ('Cardiac Science', 'Powerheart G5', 'defibrillator'),
    ('Olympus', 'CV-190', 'endoscope'),
    ('Olympus', 'CV-180', 'endoscope'),
    ('Olympus', 'GIF-H190', 'endoscope'),
    ('Olympus', 'CF-HQ190', 'endoscope'),
    ('Pentax Medical', 'EPK-i7000', 'endoscope'),
    ('Fujifilm', 'EPX-4450HD', 'endoscope'),
    ('Karl Storz', 'IMAGE1 S', 'endoscope'),
    ('BD', 'Alaris 8015 PC Unit', 'infusion_pump'),
    ('BD', 'Alaris 8100 LVP Module', 'infusion_pump'),
    ('Baxter', 'Sigma Spectrum', 'infusion_pump'),
    ('Baxter', 'Colleague', 'infusion_pump'),
    ('ICU Medical', 'Plum 360', 'infusion_pump'),
    ('ICU Medical', 'Plum A+', 'infusion_pump'),
    ('ICU Medical', 'Medfusion 3500', 'infusion_pump'),
    ('B. Braun', 'Infusomat Space', 'infusion_pump'),
    ('B. Braun', 'Perfusor Space', 'infusion_pump'),
    ('Philips', 'IntelliVue MX450', 'patient_monitor'),
    ('Philips', 'IntelliVue MX800', 'patient_monitor'),
    ('Philips', 'IntelliVue MP50', 'patient_monitor'),
    ('Philips', 'SureSigns VS4', 'patient_monitor'),
    ('GE Healthcare', 'Dash 4000', 'patient_monitor'),
    ('GE Healthcare', 'CARESCAPE B450', 'patient_monitor'),
    ('GE Healthcare', 'CARESCAPE V100', 'patient_monitor'),
    ('Mindray', 'ePM 10M', 'patient_monitor'),
    ('Mindray', 'Passport 12', 'patient_monitor'),
    ('Mindray', 'BeneView T5', 'patient_monitor'),
    ('Spacelabs', 'Xprezzon', 'patient_monitor'),
    ('Spacelabs', 'Qube', 'patient_monitor'),
    ('Welch Allyn', 'Connex Spot Monitor', 'patient_monitor'),
    ('Welch Allyn', 'Spot Vital Signs LXi', 'patient_monitor'),
    ('STERIS', 'Amsco Century', 'sterile_processing'),
    ('STERIS', 'Amsco 400', 'sterile_processing'),
    ('STERIS', 'Reliance 444', 'sterile_processing'),
    ('STERIS', 'V-PRO maX', 'sterile_processing'),
    ('Tuttnauer', '2540M', 'sterile_processing'),
    ('Tuttnauer', '3870EA', 'sterile_processing'),
    ('Tuttnauer', 'EZ10', 'sterile_processing'),
    ('Midmark', 'M11 UltraClave', 'sterile_processing'),
    ('Midmark', 'M9 UltraClave', 'sterile_processing'),
    ('GE Healthcare', 'LOGIQ E10', 'ultrasound'),
    ('GE Healthcare', 'LOGIQ P9', 'ultrasound'),
    ('GE Healthcare', 'Vivid E95', 'ultrasound'),
    ('GE Healthcare', 'Voluson E10', 'ultrasound'),
    ('GE Healthcare', 'Venue', 'ultrasound'),
    ('Philips', 'EPIQ 7', 'ultrasound'),
    ('Philips', 'Affiniti 70', 'ultrasound'),
    ('Philips', 'CX50', 'ultrasound'),
    ('Philips', 'Lumify', 'ultrasound'),
    ('Siemens Healthineers', 'ACUSON Sequoia', 'ultrasound'),
    ('Siemens Healthineers', 'ACUSON Juniper', 'ultrasound'),
    ('Samsung Medison', 'HS60', 'ultrasound'),
    ('Samsung Medison', 'RS80A', 'ultrasound'),
    ('Samsung Medison', 'HM70A', 'ultrasound'),
    ('FUJIFILM Sonosite', 'Edge II', 'ultrasound'),
    ('FUJIFILM Sonosite', 'M-Turbo', 'ultrasound'),
    ('FUJIFILM Sonosite', 'X-Porte', 'ultrasound'),
    ('Hamilton Medical', 'HAMILTON-C1', 'ventilator'),
    ('Hamilton Medical', 'HAMILTON-C3', 'ventilator'),
    ('Hamilton Medical', 'HAMILTON-C6', 'ventilator'),
    ('Hamilton Medical', 'HAMILTON-T1', 'ventilator'),
    ('Hamilton Medical', 'HAMILTON-G5', 'ventilator'),
    ('Medtronic', 'Puritan Bennett 840', 'ventilator'),
    ('Medtronic', 'Puritan Bennett 980', 'ventilator'),
    ('Draeger', 'Evita V500', 'ventilator'),
    ('Draeger', 'Savina 300', 'ventilator'),
    ('Philips', 'Respironics V60', 'ventilator'),
    ('Philips', 'Trilogy 100', 'ventilator'),
    ('GE Healthcare', 'CARESCAPE R860', 'ventilator'),
    ('Dornier', 'Compact Delta II', 'lithotriptor'),
    ('Dornier', 'Compact Sigma', 'lithotriptor'),
    ('Dornier', 'Delta III', 'lithotriptor'),
    ('Dornier', 'Gemini', 'lithotriptor'),
    ('Storz Medical', 'Modulith SLX-F2', 'lithotriptor'),
    ('Richard Wolf', 'Piezolith 3000', 'lithotriptor');

-- One manufacturers row per seed name: exact spelling first, else the lowest id.
INSERT INTO public.laser_models (manufacturer_id, name, equipment_type, description)
SELECT (SELECT m.id FROM public.manufacturers m
         WHERE lower(m.name) = lower(s.manufacturer)
         ORDER BY (m.name = s.manufacturer) DESC, m.id
         LIMIT 1),
       s.name, s.equipment_type, '000937 biomed seed'
  FROM _l937 s
ON CONFLICT (manufacturer_id, name) DO NOTHING;

ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS equipment_type text;
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.equipment'::regclass
                   AND conname = 'equipment_equipment_type_check') THEN
    ALTER TABLE public.equipment ADD CONSTRAINT equipment_equipment_type_check CHECK (
      equipment_type IS NULL OR equipment_type IN ('laser', 'lithotriptor', 'c_arm', 'anesthesia', 'beds', 'defibrillator', 'endoscope', 'infusion_pump', 'patient_monitor', 'sterile_processing', 'ultrasound', 'ventilator')
    );
  END IF;
END
$chk$;
COMMENT ON COLUMN public.equipment.equipment_type IS
  '000937: RepairPlanet equipment type picked on the equipment form. NULL = legacy (laser).';
GRANT SELECT (equipment_type) ON public.equipment TO anon;
GRANT SELECT (equipment_type), INSERT (equipment_type), UPDATE (equipment_type)
  ON public.equipment TO authenticated;

DO $post$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing FROM _l937 s
   WHERE NOT EXISTS (
     SELECT 1 FROM public.laser_models l JOIN public.manufacturers m ON m.id = l.manufacturer_id
      WHERE lower(m.name) = lower(s.manufacturer) AND l.name = s.name);
  IF v_missing > 0 THEN
    RAISE EXCEPTION '000937: % seed models missing after insert', v_missing;
  END IF;
END
$post$;

COMMIT;
