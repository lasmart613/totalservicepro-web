-- Read-only. Not a migration and not applied by the app.
-- A resend sets expires_at to the send time plus 7 days (TEAM_INVITE_TTL_MS).
-- #236 merged about 2026-10-09 15:46Z and #237 about 2026-10-09 16:18Z, so a
-- resend in that window has expires_at from 2026-10-16 15:40Z through 16:25Z.
-- Live read: only invite 42 (org 2639) is inside this window.
-- Invite 30 (org 2655, expires 2026-10-13) is an older member whose invite was
-- never marked accepted. It is outside the window and is not part of this repair.

SELECT
  i.id,
  i.organization_id,
  i.email,
  i.accepted,
  i.accepted_at,
  i.expires_at,
  i.created_at,
  p.id AS profile_id,
  p.organization_id AS profile_organization_id
FROM public.engineer_invitations AS i
JOIN auth.users AS u
  ON lower(u.email) = lower(i.email)
JOIN public.user_profiles AS p
  ON p.id = u.id
WHERE i.accepted = false
  AND p.organization_id = i.organization_id
  AND i.expires_at >= '2026-10-16 15:40:00+00'
  AND i.expires_at <= '2026-10-16 16:25:00+00'
ORDER BY i.id;
