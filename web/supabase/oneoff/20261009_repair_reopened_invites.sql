-- One-off data repair. Not a migration and not applied by the app.
-- WHERE stays the generic #236 resend window (expires_at = send time + 7 days):
-- accepted is false and the invitee is still a member of the inviting org.
-- Live read on 2026-10-09: only invite 42 matches. Invite 30 is outside the
-- window (expires 2026-10-13) and is left unchanged.

SET LOCAL lock_timeout = '5s';

UPDATE public.engineer_invitations AS i
SET
  accepted = true,
  accepted_at = COALESCE(i.accepted_at, now())
WHERE i.accepted = false
  AND i.expires_at >= '2026-10-16 15:40:00+00'
  AND i.expires_at <= '2026-10-16 16:25:00+00'
  AND EXISTS (
    SELECT 1
    FROM auth.users AS u
    JOIN public.user_profiles AS p
      ON p.id = u.id
    WHERE lower(u.email) = lower(i.email)
      AND p.organization_id = i.organization_id
  )
RETURNING i.id;
