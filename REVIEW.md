# Code review — repairplanet.net

**Scope:** `lasmart613/totalservicepro-web` as it exists on current `main`  
**SHA:** `9e82429` (merge of PR #10, marketplace parts + Stripe Purchase)  
**Date:** 2026-08-22  
**Method:** Read-only review of the actual source. No features implemented. No secrets committed here.

This is for Larry / CEO. Each finding is something the code does today, with a file pointer. “Launch-blocking” means: do not advertise a loud production launch (more clinics, more RSPs, live card charges) until this is fixed or explicitly accepted as a business risk.

---

## Bottom line

The product can run a **soft launch with a known first customer** if you treat Stripe as “collect money, then settle by hand” and you do not yet have many orgs sharing one database.

It is **not ready for a loud launch** as a multi-tenant marketplace. The two highest-risk themes:

1. **A signed-in user can become another company’s admin** (profile RLS + signup metadata). After that, they see that company’s team and can act as that company.
2. **Stripe Checkout creates a payment session, then the app never confirms the payment.** Parts stay for sale. Invoices stay unpaid. `?paid=1` is trusted as a toast, not as money.

Directory invite/claim (PR #8/#9) and listing-description sanitization (PR #10) are in better shape than the older billing and team-sync APIs.

**No Stripe secret, no service-role key, and no Resend key is committed.** The public Supabase anon key is hardcoded as a fallback (expected for an anon key; RLS must hold).

---

## Launch-blocking findings

### 1. Any account can join any organization as admin  
**Severity:** Critical  
**Launch-blocking:** Yes  
**Confirmed in this repo**

Three cooperating holes:

**A. Own-profile UPDATE does not lock `organization_id` or `role`.**  
`web/supabase/migrations/20260717_000001_user_profiles_org_team_select.sql` lines 38–43:

```sql
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
```

A browser client can `UPDATE user_profiles SET organization_id = <victim>, role = 'admin'` on its own row. Same-org SELECT then shows that company’s roster.

**B. New-user trigger copies org + role from signup metadata with no invite check.**  
`web/supabase/migrations/20260813_000001_auth_trigger_no_default_fse.sql` lines 13–18. Supabase `signUp({ options: { data: { organization_id, role: 'admin' } } })` is client-callable.

**C. Client claim path falls back to metadata org if no invite row exists.**  
`web/lib/supabase/client.ts` lines 245–257 and `web/app/api/team/claim/route.ts` lines 71–73 (`inv?.organization_id ?? meta.organization_id`).

**Why it matters:** One extra test account can attach itself to the first real customer’s org and see their team. This gets worse the moment a second clinic or RSP exists.

**Fix direction (do not apply blindly — onboarding historically broke when RLS was tightened):** forbid client changes to `organization_id` / `role`; assign org only via service-role invite/claim; drop metadata fallback.

---

### 2. Every signed-in user can read every clinic’s equipment  
**Severity:** Critical  
**Launch-blocking:** Yes (before more clinics join)  
**Confirmed in this repo**

`web/supabase/migrations/20260714_000008_fix_equipment_rls_for_onboarding.sql` lines 50–54:

```sql
CREATE POLICY equipment_authenticated_select ON public.equipment
  FOR SELECT TO authenticated
  USING (true);
```

Added so onboarding inserts would not fail. The write policy is org-scoped (`equipment_facility_manage`). The read policy is not. Any authenticated role (owner, rental, FSE, supplier, random signup) can `SELECT` all lasers, serials, and notes.

`web/app/my-lasers/page.tsx` and customer equipment views rely on RLS for scoping.

---

### 3. Team roster load can steal a user from another org  
**Severity:** High  
**Launch-blocking:** Yes  
**Confirmed in this repo**

`web/app/api/team/list/route.ts` lines 52–75. Any member of an org (not just admin) who loads the team list causes this side effect via service role:

- Load all `engineer_invitations` for the caller’s org (including pending).
- If a profile exists with that email and `organization_id` is different, **overwrite** that profile’s `organization_id` and `role`.

`POST /api/team/invite` correctly **refuses** this (lines 171–178: 409 if the email already belongs elsewhere). `GET /api/team/list` then undoes that protection. `POST /api/team/sync` (lines 127–135) does the same steal, but at least requires an admin role.

**Trigger:** opening Company Profile / Team. No accept click required.

---

### 4. Invoice / estimate / report email APIs are an authenticated mail relay  
**Severity:** High  
**Launch-blocking:** Yes  
**Confirmed in this repo**

`web/app/api/billing/send-invoice/route.ts`  
`web/app/api/billing/send-estimate/route.ts`  
`web/app/api/billing/send-report/route.ts`

All three require only a valid JWT. None check `canAddCustomers` or “this user owns this document” before sending via Resend. If the row is missing, they still send when the client supplies `html` (≥40 chars) and a recipient.

Contrast: `web/app/api/customers/invite/route.ts` lines 85–104 correctly requires service-company role **and** an `organization_customers` link, and never uses a caller-supplied destination.

**Impact:** Any signed-in clinic/owner/supplier account can send arbitrary HTML from `NOTIFY_FROM_EMAIL` / Resend (default From is `contact@medicalrepairnetwork.com`) to any address.

---

### 5. Billing APIs leak CRM emails and can charge a client-chosen amount  
**Severity:** High  
**Launch-blocking:** Yes  
**Confirmed in this repo**

**CRM probe:** `send-invoice` lines 153–179, `send-estimate` 118–140, `send-report` 110–124. `body.customer_organization_id` is **not** checked against the caller’s directory. With `SUPABASE_SERVICE_ROLE_KEY` set (required for production invites), the handler reads `organizations.email` / `phone` and `contacts.email` for that id. Org ids are sequential.

**Invoice ownership hole:** `send-invoice` lines 116–121. Service-role fallback treats `organization_id == null` as owned by **everyone**. Solo-tech invoices become readable and re-mailable by any signed-in user.

**Payment amount:** `send-invoice` lines 246–280. Stripe Checkout amount comes from `body.balance_due` / `body.total` when the row is not loaded. That is a client-controlled charge on the RepairPlanet Stripe account.

**Persist without re-check:** lines 321–325 update `service_invoices` by id via service role.

---

### 6. Stripe Checkout has no webhook and does not mark anything paid / sold  
**Severity:** High  
**Launch-blocking:** Yes if you take live card payments  
**Confirmed in this repo**

Repo-wide search for `webhook`, `constructEvent`, `stripe.webhooks`: **zero handlers**.

Checkout is created here:

- Invoice: `web/lib/billing/stripe-pay.ts` lines 54–55 → `/invoices?paid=1&session_id={CHECKOUT_SESSION_ID}`
- Parts: `web/lib/billing/stripe-marketplace.ts` lines 333–334 → `/marketplace/parts/{id}?paid=1&session_id=…`

Return pages do **not** retrieve the session from Stripe:

- Parts toast only: `web/app/marketplace/parts/[id]/page.tsx` lines 59–64 (`paid === '1'` → “Payment received”). `session_id` is ignored.
- Invoice list: `web/app/invoices/page.tsx` never reads `paid` or `session_id`. Status stays whatever was saved (usually sent/draft) until someone clicks “mark paid”.

Nothing sets `marketplace_listings.status = 'sold'`, decrements quantity, writes an order row, or emails the seller. `listingAvailability()` (`web/lib/marketplace/parts.ts` 145–176) will keep the Buy button live.

**What this is not:** appending `?paid=1` does not move money. It only shows a success toast. Money still goes through Stripe Checkout.

**What it is:** two buyers can pay for the same in-stock part; the seller is not told by the app; invoices that were paid in Stripe still look unpaid.

Guest checkout is intentional (`web/app/api/marketplace/parts/[id]/checkout/route.ts` lines 32–35). Price for parts is bound to the server-synced Stripe Price ID (good). Invoice amount is not (see #5).

There is **no listing-fee gate**. `web/app/marketplace/list/page.tsx` line 495 inserts `status: 'active'` immediately.

---

## High (fix before a loud launch; not a same-day outage if you stay small)

### 7. Logos and equipment photos: any logged-in user can overwrite any object  
**Launch-blocking:** Yes for brand trust once more than one company uploads files  
**Confirmed**

`web/supabase/migrations/20260821_000000_logos_bucket.sql` lines 16–34  
`web/supabase/migrations/20260714_000002_equipment_photos_and_bid_lines.sql` lines 5–23  

INSERT/UPDATE/DELETE only check `bucket_id`. Contrast marketplace images, which correctly require `(storage.foldername(name))[0] = auth.uid()` (`20260620_000000_marketplace_tables_and_rls.sql` lines 248–276).

---

### 8. Public parts catalog (service role) does not filter status  
**Launch-blocking:** No (checkout still blocks sold/draft)  
**Confirmed**

`web/app/api/marketplace/parts/route.ts` lines 35–40 — no `.eq('status', 'active')`.  
`web/app/api/marketplace/parts/[id]/route.ts` lines 40–67 — full row by UUID, including draft/sold.  
`web/lib/billing/stripe-marketplace.ts` `loadMarketplaceListing` 379–389 — same.

`/api/share/listing/[id]` correctly rejects non-active (lines 53–58) and strips seller contact. Catalog/detail APIs do not.

---

### 9. RFQ “Sign up free to bid” drops `next=`  
**Launch-blocking:** Yes for marketplace bidder conversion, not a security hole  
**Confirmed — historical bug still present**

`web/app/marketplace/requests/[id]/page.tsx` lines 629–630 links to `/signup?next=/marketplace/requests/{id}`.

`web/app/signup/page.tsx` has no `useSearchParams` and does not forward `next` to `/signup/company`. Company signup hardcodes `emailRedirectTo: …/auth/callback?next=/onboarding` (`web/app/signup/company/page.tsx` line 111).

Login **does** preserve `next`. Signup from an RFQ lands on onboarding/home, not the job.

---

### 10. Unauthenticated `syncOnly` creates Stripe Products/Prices  
**Launch-blocking:** No  
**Confirmed**

`web/app/api/marketplace/parts/[id]/checkout/route.ts` lines 63–66. Parts detail page fires this for logged-in viewers (page.tsx 116–121). Anyone can pollute the Stripe catalog / incur API usage.

---

## Medium / ops

| # | Issue | Launch-blocking? | Evidence |
|---|--------|------------------|----------|
| 11 | No test-vs-live Stripe key check. Live site can silently use `sk_test_`. | No (ops) | `web/lib/billing/stripe-pay.ts` 7–9 |
| 12 | Invite HMAC falls back to `SUPABASE_SERVICE_ROLE_KEY` if `CUSTOMER_INVITE_SECRET` unset. Forging an invite and owning the DB become the same secret. | No if service role stays server-only | `web/lib/customer-invite.ts` 23–28. Tokens are 30-day HMAC, verified with `timingSafeEqual`. |
| 13 | `/api/admin/ensure-profile-columns` has no auth; returns probe SQL + project ref `yljztfajyvjzqikxdddf`. | No | `web/app/api/admin/ensure-profile-columns/route.ts` 11–66 |
| 14 | RFQ INSERT allows `created_by = me` with another org’s `organization_id` (job can look like it came from another clinic). | No (integrity) | `20260714_000006_fix_service_requests_rls_recursion.sql` 93–97 |
| 15 | Any authenticated user can insert a `notifications` row for any `user_id`. | No | `20260714_000003_award_notifications.sql` 22–25 |
| 16 | Host header used for invite URLs only if `NEXT_PUBLIC_SITE_URL` / `URL` / `DEPLOY_PRIME_URL` are all unset. | No if Netlify `URL` is set | `web/lib/customer-invite.ts` 102–110 |
| 17 | Owner/supplier signup label says “min 6”; validation is 8. | No | `web/app/signup/owner/page.tsx` ~385; `web/app/signup/supplier/page.tsx` ~229 |
| 18 | Facility create is still a **client** `organizations.insert` (`web/lib/pending-signup.ts` ~280). No INSERT policy for `organizations` is in this repo. If live RLS blocks it, the old “facility not created” bug returns. | Conditional | App now throws instead of failing silently (`web/app/signup/owner/page.tsx` 169–171). |

**CRM tables (`organizations`, `organization_customers`, `contacts`, `service_invoices`, `service_estimates`):** this repo does not contain their full RLS. Isolation there is **unverified from git**. Do not assume they leak; do not assume they are locked. Production SQL Editor may have extra policies.

---

## Historical onboarding / role bugs — still present?

| Historical bug | Status on `9e82429` |
|---|---|
| Email-confirm / verify redirect sent people to set-password | **Fixed.** `web/app/auth/callback/page.tsx` 65–80. Signup confirm no longer treated as invite. Pending signup applied from localStorage **or** user metadata (Gmail new-tab). |
| Owner assigned as FSE by default | **Fixed in migration** `20260813_000001` (role stays NULL unless metadata). App still compensates if the old trigger is what production has (`auth/callback` 208–218, `onboarding/page.tsx` 204–208). **Confirm that migration is applied on live Supabase.** |
| Owner / rental first-run trap (RSP onboarding) | **Mostly fixed.** Owners with an org skip to My Lasers. Home + onboarding re-run `applyPendingSignup` if org is missing. Still depends on client org insert succeeding (#18). |
| Facility not created from signup | **Improved, not eliminated.** Multiple create/retry paths; hard error if link missing. Same RLS risk as #18. |
| Clinic labels on rental/reseller | **Mostly fixed.** `web/lib/labels.ts` + Header. Residual static “Clinic” copy in directory/RFQ is cosmetic. |
| RFQ redirect after signup | **Still present.** See #9. |
| Claimed-owner facility profile save | Works only if `SUPABASE_SERVICE_ROLE_KEY` is on Netlify (`web/app/api/org/profile/route.ts` 77–84). Migration `20260821_000001` is documented as **not auto-applied**. |

---

## XSS / part descriptions

**Not a launch issue.** `web/components/ListingDescription.tsx` renders through `sanitizeListingHtml` (`web/lib/marketplace/listing-copy.ts` 89–119): tag allowlist, `on*` stripped, `javascript:` blocked, links/`img` require `http(s)`. Markdown path HTML-escapes first.

AI assistant escapes before injecting `<strong>` / `<br/>`. Customer-invite emails escape dynamic fields. Billing document HTML is intentionally unsanitized (amplifies finding #4 if a bad actor can send).

---

## What looks solid (do not “fix”)

- **Customer invite POST:** role gate, directory-link check, CRM email only, no BCC. `web/app/api/customers/invite/route.ts`
- **Customer claim POST:** HMAC + email must match signed-in user; refuses other-org and existing owner. `web/app/api/customers/claim/route.ts`
- **Org profile POST:** updates only the caller’s linked org; rejects foreign ids. `web/app/api/org/profile/route.ts` 121–124
- **Team invite POST:** admin-only; 409 if email already on another org
- **Marketplace parts checkout price:** server Stripe Price ID, not a client dollar amount
- **Share APIs:** status filter + strip seller email/phone. `web/app/api/share/listing/[id]/route.ts`, `…/share/request/[id]/route.ts`
- **RFQ bid isolation:** owners see bids on their jobs; bidders see own bids; awarded job readable by winner + owner (`20260714_000006`)
- **Open RFQs visible to all authenticated users:** intentional marketplace behavior, not a leak
- **Estimate public CTA:** 256-bit token, format-checked (`web/lib/billing/estimate-action.ts`)
- **Auth callback:** does not print JWTs / project URLs into the UI
- **`.env` / `.env.*` gitignored.** Root `.env.example` is empty placeholders only.

---

## Secrets / env (no values in this file)

| Item | Status |
|---|---|
| `STRIPE_SECRET_KEY` / `STRIPE_SECRET` | Not in git. Required for invoice pay + parts checkout. |
| `SUPABASE_SERVICE_ROLE_KEY` | Not in git. Required for checkout listing load, team roster, org profile save, robust claims. |
| `RESEND_API_KEY` | Not in git. Without it, invite/invoice email is skipped or 503. |
| `CUSTOMER_INVITE_SECRET` | Optional; falls back to service role (#12). |
| `NEXT_PUBLIC_SITE_URL` | Should be `https://repairplanet.net` so Stripe success/cancel and invite links cannot follow a bad Host header. |
| Anon key fallback | `web/lib/supabase/client.ts` 13–15. Public client credential for project `yljztfajyvjzqikxdddf`. Safe only if RLS holds (it does not fully — see #1 and #2). |

**Live-key check:** confirm Netlify production uses `sk_live_…`, not `sk_test_…`. The code will not warn you.

---

## Suggested fix order (for a later PR — not done here)

1. Lock `user_profiles.organization_id` and `role` on client UPDATE; stop trusting signup metadata for org membership (#1).
2. Replace equipment `USING (true)` with a job-scoped or org-scoped SELECT (#2).
3. Stop team list/sync from moving profiles that already have a different `organization_id` (#3).
4. Gate send-invoice / send-estimate / send-report on role + document ownership + directory link; never send if the row is not loaded; never take `balance_due` from the client when a row exists (#4, #5).
5. Add a Stripe webhook (`checkout.session.completed`) that verifies the signature and marks invoice paid / listing sold (idempotent). Stop treating `?paid=1` as truth (#6).
6. Scope logos + equipment-photos storage to the uploader or org prefix (#7).
7. Forward `next=` through `/signup` → company/owner → auth callback (#9).
8. Confirm production has `20260813_000001` applied; confirm `organizations` INSERT works for founder signup.

---

## Files reviewed

All 17 API routes under `web/app/api/`. Stripe libs (`stripe-pay.ts`, `stripe-marketplace.ts`). Invite/claim (`customer-invite.ts`, customers + team APIs). Auth/onboarding (`middleware.ts`, `auth/callback`, `signup/*`, `onboarding/*`, `pending-signup.ts`, `roles.ts`). Marketplace parts UI + listing sanitizer. All SQL under `web/supabase/migrations/` and `supabase/migrations/`. Env/gitignore. No dummy products added. No production data accessed.
