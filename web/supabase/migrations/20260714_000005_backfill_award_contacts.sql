-- Backfill awarded_bid_id for already-awarded jobs from accepted bids
UPDATE public.service_requests sr
SET
  awarded_bid_id = b.id,
  awarded_at = COALESCE(sr.awarded_at, now())
FROM public.bids b
WHERE b.request_id = sr.id
  AND b.status = 'accepted'
  AND sr.status = 'awarded'
  AND sr.awarded_bid_id IS NULL;

-- Facility contact snapshot
UPDATE public.service_requests sr
SET facility_contact = jsonb_build_object(
  'organization_id', sr.organization_id,
  'name', o.name,
  'address', o.address,
  'city', COALESCE(o.city, sr.city),
  'state', COALESCE(o.state, sr.state),
  'zip', o.zip,
  'phone', COALESCE(o.phone, o.alt_phone),
  'email', o.email,
  'contact_name', o.contact_name
)
FROM public.organizations o
WHERE o.id = sr.organization_id
  AND sr.status = 'awarded'
  AND sr.facility_contact IS NULL;

-- Provider contact snapshot from winning bid
UPDATE public.service_requests sr
SET provider_contact = jsonb_build_object(
  'user_id', COALESCE(b.bidder_id, b.bidder_user_id),
  'organization_id', COALESCE(b.bidder_org_id, up.organization_id),
  'contact_person', trim(both ' ' from concat_ws(' ', up.first_name, up.last_name)),
  'phone', up.phone,
  'email', up.email,
  'company_name', po.name,
  'company_phone', po.phone,
  'company_email', po.email,
  'address', po.address,
  'city', po.city,
  'state', po.state,
  'zip', po.zip
)
FROM public.bids b
LEFT JOIN public.user_profiles up ON up.id = COALESCE(b.bidder_id, b.bidder_user_id)
LEFT JOIN public.organizations po ON po.id = COALESCE(b.bidder_org_id, up.organization_id)
WHERE b.id = sr.awarded_bid_id
  AND sr.status = 'awarded'
  AND sr.provider_contact IS NULL;

SELECT 'ok' AS status;
