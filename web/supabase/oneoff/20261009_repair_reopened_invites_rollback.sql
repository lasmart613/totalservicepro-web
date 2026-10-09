-- Rolls back the one known row in the #236 window: invite 42.
-- Prior values from the live read: accepted false, accepted_at null,
-- expires_at 2026-10-16 15:57:26.206+00.
-- Invite 30 was not updated. Not a migration and not applied by the app.

SET LOCAL lock_timeout = '5s';

UPDATE public.engineer_invitations
SET
  accepted = false,
  accepted_at = NULL,
  expires_at = '2026-10-16 15:57:26.206+00'
WHERE id = 42
RETURNING id;
