-- Expand manuals library rooms with real BMET categories and remove Other.
-- Column stays text — drop the closed-set checks so future rooms are not blocked.
-- Apply in the Supabase SQL editor if you are not running `supabase db push`.

ALTER TABLE public.manuals
  DROP CONSTRAINT IF EXISTS manuals_equipment_type_check;

ALTER TABLE public.laser_models
  DROP CONSTRAINT IF EXISTS laser_models_equipment_type_check;

-- 1. Known live Other rows (14) → real rooms
UPDATE public.manuals SET equipment_type = 'sterile_processing' WHERE id::text = '212'; -- Euronda E9 Steam Sterilizer
UPDATE public.manuals SET equipment_type = 'sterile_processing' WHERE id::text = '216'; -- Trans SMART Steam Sterilizer
UPDATE public.manuals SET equipment_type = 'defibrillator' WHERE id::text = '217'; -- CU Medical iPAD NF1200 Defibrillator
UPDATE public.manuals SET equipment_type = 'infusion_pump' WHERE id::text = '224'; -- CME BodyGuard infusion
UPDATE public.manuals SET equipment_type = 'defibrillator' WHERE id::text = '225'; -- Burdick Medic5 Defibrillator
UPDATE public.manuals SET equipment_type = 'ultrasound' WHERE id::text = '227'; -- Samsung HS50A/HS60A Ultrasound
UPDATE public.manuals SET equipment_type = 'infusion_pump' WHERE id::text = '228'; -- QCore Sapphire Infusion
UPDATE public.manuals SET equipment_type = 'patient_monitor' WHERE id::text = '229'; -- Contec CMS8000 Patient Monitor
UPDATE public.manuals SET equipment_type = 'beds' WHERE id::text = '231'; -- Ohmeda Ohio Infant Warmer
UPDATE public.manuals SET equipment_type = 'patient_monitor' WHERE id::text = '232'; -- GE Dash 3000/4000 Patient Monitor
UPDATE public.manuals SET equipment_type = 'ultrasound' WHERE id::text = '233'; -- Samsung RS80A Ultrasound
UPDATE public.manuals SET equipment_type = 'anesthesia' WHERE id::text = '235'; -- Draeger Fabius GS Anesthesia
UPDATE public.manuals SET equipment_type = 'anesthesia' WHERE id::text = '236'; -- Draeger Narkomed 6000 Anesthesia
UPDATE public.manuals SET equipment_type = 'c_arm' WHERE id::text = '245'; -- UroView 2800 (urology fluoro)

-- 2. Any leftover Other → best title/brand guess, laser last resort
UPDATE public.manuals
SET equipment_type = CASE
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'steriliz|autoclave|washer[- ]disinfect|\yspd\y|sterile\s+processing'
    THEN 'sterile_processing'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* '\yventilator|\yrespirator\y'
    THEN 'ventilator'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'infant\s+warmer|\ystretcher|\ybeds?\y'
    THEN 'beds'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'defibrillator|\yaeds?\y|\ydefib\y'
    THEN 'defibrillator'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'infusion|syringe\s+pump'
    THEN 'infusion_pump'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'patient\s+monitor|vital\s+signs'
    THEN 'patient_monitor'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* '\yultrasound\y|\ysonograph'
    THEN 'ultrasound'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'anesthe|\yfabius\y|\ynarkomed\y'
    THEN 'anesthesia'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'endoscop'
    THEN 'endoscope'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* '\yc[- _]?arm\y|\yoec\y|fluoroscop|\yuroview\y'
    THEN 'c_arm'
  WHEN coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(model, '')
    ~* 'lithotrip|shock\s*wave|shockwave|\yeswl\y'
    THEN 'lithotriptor'
  ELSE 'laser'
END
WHERE equipment_type = 'other';

UPDATE public.laser_models
SET equipment_type = 'laser'
WHERE equipment_type = 'other';

COMMENT ON COLUMN public.manuals.equipment_type IS
  'Library room (text). laser | lithotriptor | c_arm | anesthesia | beds | defibrillator | endoscope | infusion_pump | patient_monitor | sterile_processing | ultrasound | ventilator. Not a closed enum.';

COMMENT ON COLUMN public.laser_models.equipment_type IS
  'Catalog type for this model (text, same rooms as manuals). Not a closed enum.';

COMMENT ON COLUMN public.clinic_service_leads.equipment_type IS
  'Same rooms as manuals. Other free-text path retired; equipment_type_other unused.';

NOTIFY pgrst, 'reload schema';
