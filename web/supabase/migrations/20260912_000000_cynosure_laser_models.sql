-- Seed Cynosure make + models for estimate / service-report / ticket dropdowns.
-- Cynosure existed as a fallback manufacturer name with zero child models,
-- so selecting it on the estimate form left the model list empty.
-- Idempotent: does not update or delete existing customer equipment rows.

INSERT INTO public.manufacturers (name)
VALUES ('Cynosure')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT v.name, v.label, m.id, 'laser'
FROM public.manufacturers m
CROSS JOIN (
  VALUES
    ('Apogee', 'Apogee'),
    ('Apogee+', 'Apogee+'),
    ('Apogee Elite', 'Apogee Elite'),
    ('Apogee Elite+', 'Apogee Elite+ / Elite Plus'),
    ('Apogee Elite MPX', 'Apogee Elite MPX'),
    ('Elite', 'Elite'),
    ('Elite+', 'Elite+'),
    ('Elite iQ', 'Elite iQ'),
    ('Accolade', 'Accolade'),
    ('Cynergy', 'Cynergy'),
    ('Cynergy Multiplex', 'Cynergy Multiplex'),
    ('PicoSure', 'PicoSure'),
    ('PicoSure Pro', 'PicoSure Pro'),
    ('SmartLipo', 'SmartLipo'),
    ('SmartLipo MPX', 'SmartLipo MPX'),
    ('SmartLipo Triplex', 'SmartLipo Triplex'),
    ('Affirm', 'Affirm'),
    ('Icon', 'Icon'),
    ('Vectus', 'Vectus'),
    ('SculpSure', 'SculpSure'),
    ('RevLite SI', 'RevLite SI'),
    ('Potenza', 'Potenza'),
    ('MonaLisa Touch', 'MonaLisa Touch'),
    ('TempSure', 'TempSure'),
    ('PrecisionTx', 'PrecisionTx'),
    ('Cellulaze', 'Cellulaze'),
    ('PinPointe', 'PinPointe FootLaser')
) AS v(name, label)
WHERE m.name = 'Cynosure'
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = v.name
  );
