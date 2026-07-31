# Total Service Pro — Cross-Platform UI/UX Code Review

**Date:** 2026-07-28  
**Reviewers:** Grok + Lumina (web agent + Android agent)  
**Requirement:** UI/UX as identical as possible between **Web** (`repairplanet.net` / `total-service-pro-web/web`) and **Android** (`PhotometryTools v1.2` assets + native bridges)  
**Android build under review:** `0.3.48-alpha` (versionCode 43) — note `app-version.js` still says `0.3.47-alpha` / 42  

---

## Executive summary

Both platforms share the same product DNA: navy/gold design tokens, persona dashboards (service / owner / supplier), marketplace, schedule, reports, manuals, parts, test equipment, and company/profile shells.

They **fail** the “identical as possible” bar on:

| Priority | Gap |
|----------|-----|
| **P0** | **Estimates + Invoices** — full on Android, **missing on web** (no routes) |
| **P0** | **Service Report PDF / engineer** — Android mature; web thinner + **broken import** (`@/lib/billing/doc-numbers` missing) |
| **P0** | **Customer profile** — rich on Android; web directory is **list-only** (hub claims “profiles”) |
| **P1** | **Hub composition** — web hub richer; Android hub thin / not persona-branched |
| **P1** | **Team invite email** — production on web; Android insert-only |
| **P1** | **SR visual language** — Android `service_report.html` is a theme island (no `tsp.css`) |
| **P2** | Font (DM Sans vs Geist), chrome (bottom nav vs top header), back glyphs, version label drift |

**Recommendation:** Treat Android as source of truth for **billing docs + SR PDF**; treat web as source of truth for **team invite APIs + hub completeness**. Align nav content first, then ship missing web modules.

---

## Screen map (Web ↔ Android)

| Feature | Web | Android | Parity |
|--------|-----|---------|--------|
| Dashboard | `app/page.tsx` | `index.html` | Good — persona KPIs |
| Auth / signup | `/login`, `/signup/*` | `index.html` modal + tiles | Good (confirm password on both) |
| Onboarding | `/onboarding`, `/onboarding/member` | `onboarding.html` | Partial — web member path stronger |
| Company / team | `/company`, `/api/team/*` | `company_profile.html` | Web-ahead (email invite) |
| Customers list | `/customers` | `customer_directory.html` | Partial |
| Customer profile | **Missing** | `customer_profile.html` | **Android-only** |
| Service schedule | `/service-schedule` | `service_schedule.html` | Good |
| Tickets detail | `/service-tickets/[id]` | schedule/ticket HTML | Partial |
| Reports list | `/reports` | `reports_list.html` | Good |
| Report create | `/reports/new` (`NewServiceReportClient.tsx`) | `service_report.html` | Partial |
| Report PDF / detail | thin `/reports/[id]` + `window.print` | `exportPDF` + `Android.printReport` | Weak |
| Estimates | **None** | `estimates_list` + `estimate_generator` | **Android-only** |
| Invoices | **None** | `invoices_list` + `invoice_form` | **Android-only** |
| Marketplace / bids | `/marketplace/**`, `/bids`, `/accepted-bids` | `marketplace.html`, etc. | Good (web more routes) |
| My Lasers | `/my-lasers` | `my_lasers` + `laser_profile` | Good |
| Manuals | `/manuals` | `manual_library` + pdfjs | Partial (Android offline PDFs) |
| Parts / TE | `/parts`, `/test-equipment` | matching HTML | Good |
| Notifications | `/notifications` | `notifications.html` | Good |
| Settings / profile | `/settings`, `/profile` | matching HTML | Partial (Android signature pad) |
| Tech Hub | `/hub` (rich, persona + business) | `service_hub.html` (7 cards) | Drift |
| Calculators | `/calculators` | menu + tools | Good |
| AI | `/ai-assistant` stub | richer `ai_assistant.html` | Both incomplete |
| TSP Directory | `/directory` (free listings) | `tsp_directory.html` | Good |
| Paywall | ads only | `paywall.html` + Play Billing | Android-only |
| Admin shell | `/admin/*` | N/A | Web-only |

---

## Critical UI/UX gaps (identical-as-possible failures)

### 1. Estimates & Invoices — high (web missing)
- **Android:** Business Management on home = Customers + Estimates + Invoices (`index.html`). Full list/form/PDF/deposit/convert flows.
- **Web:** Hub Business Management = Customers + Company only (`hub/page.tsx`). **No** `/estimates` or `/invoices` routes; repo grep finds no estimate/invoice pages under `web/app`.
- **Impact:** Desktop users cannot run quote → invoice; phone-created docs are app-only.
- **Fix:** Port Android list + form UIs; share `doc-numbers` + line-item catalog patterns; add same tiles/order/labels as Android.

### 2. Service Report engineer + professional PDF — high
- **Android:** `#engineer` with admin edit / FSE lock; PDF snapshots engineer, signature, checklists; table layout for print WebView (0.3.48 fixes).
- **Web:** `NewServiceReportClient.tsx` lacks `service_engineer` parity; print is `window.print()` on live form; `/reports/[id]` is a summary card, not full printable SR.
- **Fix:** Port engineer field + role rules; port snapshot print HTML (or shared print component); full report view on `[id]`.

### 3. Missing web module breaks SR create — high
- Web SR imports `generateDocNumber` from `@/lib/billing/doc-numbers`.
- **`web/lib/billing/` does not exist** (only `award.ts`, `roles.ts`, `models.ts`, etc.).
- **Fix:** Port `assets/doc-numbers.js` → `lib/billing/doc-numbers.ts` immediately.

### 4. Customer CRM depth — high/med
- Android: directory → `customer_profile.html` (hero, tabs, equipment, sites, contacts, history).
- Web: `/customers` cards **not deep-linked**; hub copy says “Directory & customer profiles” but profiles don’t exist.
- **Fix:** `/customers/[id]` + clickable cards; match tab density.

### 5. Hub & Business tiles out of sync — med
| Item | Web hub | Android hub |
|------|---------|-------------|
| My Bids / Accepted Bids | Yes | No |
| Test Equipment | Yes | No |
| Photometry / Calculators | Yes | No (bottom nav only) |
| Business: Estimates / Invoices | No | On **index** only, not hub |
| Persona branching | owner/supplier/service | Flat 7 cards |

- **Fix:** Align card **set, labels, order** first. Keep platform chrome (top Header vs bottom nav).

### 6. Team invite — med/high (ops)
- Web: `/api/team/invite` + claim + set-password.
- Android company invite: insert row, **no email** (“No email sent yet”).
- **Fix:** Android call same invite API; copy-link fallback when SMTP throttles.

### 7. Visual identity drift — med
| Token / chrome | Web | Android |
|----------------|-----|---------|
| Brand colors | `globals.css` gold `#FBBF24`, dark surfaces | `tsp.css` aligned |
| Body font | Geist primary (DM Sans loaded) | DM Sans common |
| Service Report theme | Shared CSS vars | **Private black palette**, no `tsp.css` |
| Nav shell | Sticky top `Header.tsx` | Per-page headers + bottom nav |
| Back control | Browser/header | Mix of `‹` / `←` / `◀` |
| Version label | N/A | `app-version.js` lag vs gradle |

- **Fix:** Load `tsp.css` on SR; body font DM Sans on web; one back glyph kit; bump `app-version.js` with every release.

### 8. Profile signature — med
- Android `user_profile.html` signature canvas → `signature_data` for SR fallback.
- Web profile has no signature pad while SR still falls back to `signature_data`.
- **Fix:** Port pad to web profile.

### 9. TSP Directory & Paywall — med/product
- Android shows TSP Directory on persona grids; paywall + native billing.
- Web: no directory route; ads banner only.
- **Product call:** ship both on web, or hide Android-only until parity.

### 10. Feedback patterns — low
- Web SR still uses `alert()` in places; Android uses toasts. Prefer sonner everywhere on web.

---

## What already matches well

- Gold/dark design tokens and card/button language (`tsp.css` ↔ `globals.css`).
- Persona dashboards (service / owner / supplier) via roles + org type.
- Service report **core form** on web intentionally ports Android checklists, performance, safety, TE, canvas signature.
- Reports list: stats, search, filter chips.
- Marketplace, repair jobs, bids, My Lasers, parts, TE, schedule, manuals, notifications.
- Auth hygiene: password confirm + email redirect patterns (Confirm email still a Supabase Dashboard requirement).
- Company profile multi-persona titles and admin team UI (web).

---

## Platform strengths (source of truth)

| Domain | Source of truth | Port to |
|--------|-----------------|---------|
| Estimates / invoices / deposit / convert | **Android** | Web |
| SR PDF snapshot + engineer field | **Android** | Web |
| Customer profile CRM | **Android** | Web |
| Offline manuals / PDF.js | **Android** | Optional web |
| Keyboard defaults / doc-numbers / equipment-ensure | **Android** (assets) | Web shared lib |
| Team invite email + claim | **Web APIs** | Android |
| Hub completeness + persona cards | **Web** | Android |
| Biometrics / Play Billing | **Android** | Keep native |

---

## Recommended parity sprint (ordered)

### Sprint A — Stop the bleeding (1–2 days) — **DONE 2026-07-28**
1. ~~Add `web/lib/billing/doc-numbers.ts`~~ (port from `assets/doc-numbers.js`).
2. ~~Sync `app-version.js` → `0.3.48-alpha` / 43.~~
3. ~~Web SR: Service Engineer field + save/load (`?id=` editor load).~~
4. ~~Replace web SR `alert()` with sonner.~~
5. Bonus: report detail shows engineer; load existing report into editor.

### Sprint B — Money + CRM parity (web) — **DONE 2026-07-28**
5. ~~Web `/estimates` + create/edit~~ (`estimates/page.tsx`, `estimates/new/*`)
6. ~~Web `/invoices` + form + convert-from-estimate~~ (`invoices/*`, `?fromEstimate=`)
7. ~~Dashboard + hub + Header Business tiles: Customers / Estimates / Invoices / Company~~
8. ~~Web `/customers/[id]` + clickable directory~~
9. Shared `lib/billing/save-helpers.ts` (line items, schema-drift writes, 30-day expiry)

### Sprint C — SR PDF + identity + equipment history — **DONE 2026-07-28**
9. ~~Web professional print/PDF~~ (`lib/service-report-print.ts`, full `/reports/[id]` + Print)
10. ~~Android SR theme tokens~~ aligned to tsp.css (+ light mode, DM Sans)
11. ~~Web body font → DM Sans~~
12. ~~Service reports linked to equipment~~ (`equipment_id` + serial; ensure reuses row on transfer; history on laser profile / customers / My Lasers; RLS migration)

### Sprint D — Shell + team (both) — **DONE 2026-07-28**
12. ~~Android hub~~ persona grids + Business Management (Customers / Estimates / Invoices / Company)
13. ~~Android invite~~ → `https://repairplanet.net/api/team/invite` + clipboard link / rate-limit UI
14. ~~Chrome~~ dirty leave for SR + estimate + invoice; back glyph notes; hub `←`
15. ~~Web profile signature pad~~ (`signature_data` for SR fallback)

### Sprint E — Product complete
16. ~~TSP Directory on web~~ — free listings only (`/directory`, company + onboarding opt-in). Future: optional premium profile/boosting TBD.
17. Web paywall/entitlements strategy (ads-only vs Stripe/Play) — **separate** from directory (directory stays free).
18. AI: one real implementation, both clients thin.

---

## Incomplete workflows (ops)

1. Android invite → no email (blocks phone-only team onboarding).
2. Web estimates/invoices (blocks desktop billing).
3. Web customer detail.
4. Web SR professional PDF.
5. Org signup before email confirm race (if Confirm email ON).
6. Admin analytics still shell.
7. Custom SMTP still required for invite/reset reliability.

---

## Security / ops notes (brief)

| Issue | Severity | Notes |
|-------|----------|--------|
| Missing `@/lib/billing/doc-numbers` | High | Breaks web SR create if imported |
| Android invite without email | High (ops) | Teammates never get set-password from phone |
| Session in query `_s=` | Medium | Known Android nav pattern; long-term reduce |
| Supabase Confirm email / SMTP | High (ops) | Production requirement; not re-verified live this run |

---

## Bottom line

Web and Android already feel like **one product** for field ops + marketplace. They do **not** yet meet **identical UI/UX**:

- **Money path** lives only on Android.
- **Team email path** lives only on web.
- **Service Report** is almost shared, but engineer + PDF + theme still diverge.
- **Hub/home tiles** advertise different tool sets.

Ship Sprint A immediately; prioritize Sprint B so desktop and phone can run the same business workflows with the same labels, order, and screens.

---

*Agents:* Lumina web explore `019fb66f-88b4-7a62-bb11-ab54a99c99f6`, Lumina Android explore `019fb66f-88bd-74a2-a16d-a181cfb66777`.  
*Prior review (auth/team, 2026-07-18):* `CROSS_PLATFORM_REVIEW.md`.
