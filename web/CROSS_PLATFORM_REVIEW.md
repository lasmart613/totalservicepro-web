# Total Service Pro — Cross-Platform Review (Web + Android)

**Date:** 2026-07-18  
**Reviewer framing:** Lumina-style product/engineering parity audit + security checks  
**Sources:** Android `app/src/main/assets/*`, Web `web/app/*`, live Supabase data patterns, recent session fixes  

---

## Executive summary

Both platforms share Supabase and a solid operational core (personas, schedule, reports, marketplace, lasers, test equipment, parts, manuals, company profile). The biggest gaps are:

1. **Team invites** — production-ready on **web**; Android still inserts invitation rows without sending email.
2. **Billing docs** — **estimates & invoices Android-only**.
3. **Auth hygiene** — password confirm + email verification redirect were incomplete on some signup paths (fixed this review for login + Android index).
4. **Team roster visibility** — was broken by RLS (web fixed via `/api/team/list`); Android still client-only.

Your specific concerns:

| Concern | Status |
|--------|--------|
| Team members not showing in org | **Root cause:** RLS hid other `user_profiles`. Web fixed via service-role `/api/team/list`. Members **exist** in DB for org 101. |
| No email verification on signup | **Partial.** Supabase “Confirm email” project setting is authoritative. Clients now always set `emailRedirectTo`. Login signup forces verify message + sign-out if session returned early. **Must enable Confirm email in Supabase Dashboard.** |
| No password double-check on new signup | **Fixed** on web `/login` signup and Android `index.html` signup. Org signup pages (`/signup/company|owner|supplier`) already had confirm password. Invite path already had match on set-password. |

---

## Auth & identity (P0)

### Password confirmation

| Path | Before | After this review |
|------|--------|-------------------|
| Web `/login` signup mode | Single password field | **Confirm password** required |
| Web `/signup/*` org tiles | Already had confirm | Unchanged |
| Web invite `/auth/set-password` | Already had confirm | Unchanged |
| Android `index.html` signup | Single password field | **Confirm password** field + match check |

### Email ownership verification

| Layer | Requirement |
|-------|-------------|
| **Supabase Dashboard** | Authentication → Providers → Email → **Confirm email = ON** |
| **SMTP** | Custom SMTP strongly recommended (built-in ≈ 2–3 emails/hour) |
| **Redirect allowlist** | `https://repairplanet.net/auth/callback`, `https://repairplanet.net/**` |
| **Client** | `emailRedirectTo` on all `signUp` paths; login signup no longer auto-enters app without verification intent |

**Risk if Confirm email is OFF:** Anyone can register any email and get a session immediately. Enabling Confirm email is non-negotiable for production.

**Android** already tries harder after signup (resend + OTP UI). Web login signup now signs out if a session was granted and asks user to open the confirmation email.

### Incomplete invite / password set (prior session)

- Invite creates Auth user without password → must land on set-password.
- Web has full path: invite email → callback → set-password → claim → member onboarding.
- Android company invite: **still no email backend**.

---

## Team & organization (P0)

| Capability | Web | Android |
|------------|-----|---------|
| Invite email (Auth) | `/api/team/invite` service role | **Missing** — insert only |
| Copy invite link if SMTP rate-limited | Yes | No |
| Claim invite to `organization_id` | `/api/team/claim` | Weak / manual |
| Roster list | `/api/team/list` (bypasses RLS) | Client query (RLS may hide teammates) |
| Pending invites UI | Company + Admin team | Company profile pending list |
| Member onboarding (locked org/role) | `/onboarding/member` | No dedicated page |

### Data check (example org 101)

Profiles linked correctly after invite/claim:

- company_admin (you)
- fse / dispatcher teammates

Pending invite rows that never finished stay `accepted=false` (plus example.com test rows).

### Required SQL (if not applied)

1. `20260717_000000_auth_user_profile_trigger.sql` — profile on Auth user create  
2. `20260717_000001_user_profiles_org_team_select.sql` — same-org SELECT for teammates  

---

## Feature parity matrix (high level)

| Area | Both | Web stronger | Android stronger / only |
|------|------|--------------|-------------------------|
| Persona dashboards | ✓ | Cleaner KPIs | — |
| Tech hub | Partial | Full cards (bids, TE, etc.) | Subset hub |
| Schedule / tickets | ✓ | Ticket detail route | — |
| Service reports | Partial | — | Full `service_report.html` depth |
| Marketplace / bids | ✓ | My Bids page | — |
| My Lasers / test equip / parts | ✓ | — | — |
| Manuals | Partial | Signed URLs / tiers | Local PDFs + PDF.js |
| CRM directory | ✓ | — | Customer **profile** page |
| Estimates / invoices | — | — | **Android only** |
| Team invite email | — | **Web only** | Stub |
| AI assistant | Partial | Stub | Richer + entitlements |
| Paywall / biometrics | — | Ads banner only | Full Android |

---

## Incomplete workflows

1. **Android invite → no email** — blockers for field teams onboarded from phone only.  
2. **Web estimates / invoices** — business management incomplete.  
3. **Web customer detail** — no `/customers/[id]`.  
4. **Web AI** — keyword stub, not production.  
5. **Email rate limits** without custom SMTP — invites/resets drop.  
6. **Admin analytics** — “Coming soon”.  
7. **Org signup creates org before email confirm** — race if Confirm email ON and session delayed (partial accounts).  

---

## Security notes

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Unconfirmed signup sessions | High | Enable Confirm email; clients sign out / wait for link |
| RLS-only multi-tenant isolation | High | Apply all migrations; never ship service role to client |
| Android token-in-URL (`_s`) | Medium | Prefer secure storage only |
| Built-in SMTP rate limit | High operational | Custom SMTP |
| Client anon keys in HTML | Expected | Ensure RLS tight |

---

## Priority roadmap

### P0 (do now)

1. Supabase: **Confirm email ON** + custom SMTP + redirect URLs.  
2. Apply team/profile SQL migrations in production.  
3. Ship auth password confirm + emailRedirect (done this review — deploy web + rebuild Android).  
4. Verify Company Profile roster shows all members after `/api/team/list` deploy.

### P1

5. Android company invite → call web `/api/team/invite` (or Edge Function).  
6. Android deep-link for set-password / claim.  
7. Web estimates + invoices.  
8. Web `/customers/[id]` profile.

### P2

9. Web OTP login parity with Android.  
10. Web AI backend or hide stub.  
11. Web paywall/entitlements.  
12. Reduce token-in-URL on Android.

---

## Fixes shipped in this review pass

### Web

- `/login`: confirm password; `emailRedirectTo`; force verify messaging (no silent session entry).  
- `/signup/company|owner|supplier`: `emailRedirectTo` to `/auth/callback?next=/onboarding`.  

### Android

- `index.html`: confirm password field + match validation; confirm signup email redirect uses web callback for browser-openable links.

### Already live (prior session)

- Team list/sync/claim APIs, pending invite UI, invite personalized metadata, set-password, member onboarding.

---

## How to verify

1. **New signup (web):** mismatch passwords → error; match → “check email”; cannot use app until confirm.  
2. **Supabase Auth settings:** Confirm email enabled; test signup receives Confirm email.  
3. **Team:** invite → set password → member onboarding → appears under Current Team + Invite history “on team”.  
4. **Android:** rebuild app; signup shows confirm password; team invite still needs backend (P1).

---

## Bottom line

Platforms are close on field operations and marketplace. **Auth verification and team invite reliability are the production blockers.** Password confirm and email redirect are fixed in code; **you must turn on Confirm email + custom SMTP in Supabase** for true ownership verification and reliable delivery. Team membership data is fine; **display depended on server list APIs / RLS policy**.
