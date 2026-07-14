# Web ↔ Android Role/Dashboard Parity Notes

Date: 2026-07-12

## Review findings (before changes)

| Area | Web (before) | Android assets |
|------|--------------|----------------|
| Role helpers | Scattered `role === 'admin' \|\| role === 'company_admin'` checks | Shared flags: `isPro`, `isOwnerish`, `isSupplier`, dashboard layout switch |
| Dashboard `/` | Single service-company KPI set for all roles | Three personas: service / owner / supplier |
| My Lasers | Missing | `my_lasers.html` CRUD on `equipment.customer_organization_id` |
| Company profile | Service-admin oriented; `ensureCreatorIsAdmin` could overwrite owner/supplier → `company_admin` | Allows owner + supplier; retitles Facility / Supplier; hides team for non-service |
| Marketplace | No role guards on post/bid; `isPro` omitted `admin` in Android, web had none | Owners/suppliers post; pros bid; owners accept; suppliers post parts |
| Onboarding | Team-centric; forced admin; syntax bug (duplicate `}, [deps]);`); no clinic lasers / supplier categories | Org-type branched; preserve owner / parts_supplier |
| Reports detail | Always offered “Open in Editor” | Owners should be view-only |

## What we changed

### New
- `lib/roles.ts` — `isAdmin`, `isPro` (admin + company_admin + service_manager + fse + engineer), `isOwnerish`, `isSupplier`, `isServiceCompany`, `canAccessCompanyProfile`, `canCreateTickets`, `canBidMarketplace`, `canPostMarketplaceNeed`, `canAcceptBids`, `getDashboardPersona`. Treats **admin ≡ company_admin**.
- `app/my-lasers/page.tsx` — facility equipment CRUD matching Android UX (list + modal).

### Updated
- `app/page.tsx` — role-branched dashboard:
  - **Service**: tickets/reports KPIs, photometry, schedule, hub, reports, admin portal (admins).
  - **Owner**: My Lasers, open requests, service history, bids received; links to `/my-lasers`, `/marketplace`, `/reports`, `/company`, `/settings`.
  - **Supplier**: catalog, listings, open demand, brands; links to `/parts`, `/marketplace`, `/company`, `/settings`.
- `app/company/page.tsx` — access for owner/customer/parts_supplier; hide team invite/CRM unless service admin; Facility / Supplier titles; **do not overwrite** owner/supplier roles to admin.
- `app/marketplace/page.tsx` + `list/page.tsx` + `requests/[id]/page.tsx` — `isPro` includes admin; post guard via `canPostMarketplaceNeed` (requests); suppliers post parts; owners/suppliers accept bids on own posts; pros bid.
- `app/onboarding/page.tsx` — fixed syntax bug; clinic lasers step; supplier categories + brands; **preserve** `owner` / `parts_supplier` on save; service team flow unchanged.
- `app/reports/[id]/page.tsx` — owners get view-only (no editor unlock).
- `components/Header.tsx` — nav + dropdown labels by persona (My Lasers / Parts / Facility Profile / Supplier Profile).

## Residual risks

1. **RLS**: Owner equipment CRUD and bid accept depend on Supabase RLS policies allowing `customer_organization_id` access and bid updates by post owners. If RLS is incomplete, UI will show errors.
2. **Dual request tables**: Android often uses `service_requests`; web list form uses `marketplace_requests`. Owner open-request KPIs try `service_requests` then fall back. Counts may diverge until tables unify.
3. **Owner signup equipment**: `/signup/owner` still inserts with `organization_id` (legacy) rather than `customer_organization_id` — onboarding path is correct; signup path may need a follow-up fix.
4. **`specialties` column**: Supplier categories written to `organizations.specialties` if present; ignored if column missing.
5. **FSE Performance**: Still admin-only (not all isPro) to avoid noise for field techs.

## How to test by org type

### Service company (admin / manager / fse)
1. Sign in as `company_admin` or `admin`.
2. `/` shows open tickets, completed/total reports, photometry + hub + schedule + reports.
3. Admin sees Admin Portal + FSE performance when data exists.
4. `/company` shows team invite section.
5. Marketplace: create part/used listing; bid on someone else’s request (`isPro` includes admin).
6. Onboarding as RSP still requires ≥1 admin and can invite FSEs.

### Facility owner (`owner` / `customer` or org.type `customer`)
1. Sign in as owner.
2. `/` hides tickets/photometry; shows My Lasers / Open Requests / Service History / Bids Received.
3. Quick links: My Lasers, Marketplace, History, Facility Profile, Settings.
4. `/my-lasers` — add/edit/delete equipment scoped to facility org.
5. `/company` titled **Facility Profile**, no team section.
6. Post marketplace need; accept bids on own post; cannot bid as pro.
7. Report detail is view-only (no Open in Editor).
8. Onboarding: lasers step + brands; role remains `owner`.

### Parts supplier (`parts_supplier` / `supplier`)
1. Sign in as supplier.
2. `/` shows Catalog / Listings / Open Demand / Brands Stocked.
3. Links: Parts, Marketplace, Supplier Profile, Settings.
4. `/company` titled **Supplier Profile**, no team section.
5. Post parts listing; accept bids on own posts.
6. Onboarding: categories + brands; role remains `parts_supplier`.
