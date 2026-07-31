-- Owner-side organization types (application-enforced; no CHECK constraint).
-- Valid organizations.type values used by the app:
--   service_company
--   parts_supplier | vendor
--   customer | laser_clinic | laser_rental | laser_reseller
--
-- laser_rental and laser_reseller use the owner product persona
-- (My Lasers, marketplace service needs, award bids) — see lib/org-types.ts.

COMMENT ON TABLE public.organizations IS
  'Org types: service_company | parts_supplier | vendor | customer | laser_clinic | laser_rental | laser_reseller';
