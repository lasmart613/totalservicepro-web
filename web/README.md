This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

**Deployment**: See [DEPLOY.md](./DEPLOY.md) for Netlify production deploy steps, scripts (`npm run deploy`), current URLs (https://repairplanet.net primary recommended + https://totalservicepro.netlify.app), custom domain setup for RepairPlanet.net / MedicalRepairNetwork.com, and fixes applied (netlify.toml redirects, package.json deploy script, etc.).

The site is deployed to Netlify project "totalservicepro" (linked, logged in as larrysmart@gmail.com).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Production Deployment (Netlify)

This app is deployed to Netlify (site: `totalservicepro`).

- **Live Production URL (primary custom domain)**: https://repairplanet.net (DNS records pending - see DEPLOY.md)
- **Netlify App URL (fallback)**: https://totalservicepro.netlify.app
- **Latest unique deploy URL** (post full bidding/accept/contract marketplace, 2026-06): https://6a2966e4b15cd718d2251647--totalservicepro.netlify.app
  - (Prior: https://6a28e78315d56bbf251f2f0f--totalservicepro.netlify.app etc.)
- **Previous recent unique**: https://6a28e5f3e11767e0e5cacf96--totalservicepro.netlify.app
- **Dashboard**: https://app.netlify.com/projects/totalservicepro
- **Build log for latest**: https://app.netlify.com/projects/totalservicepro/deploys/6a28e78315d56bbf251f2f0f
- **Function logs**: https://app.netlify.com/projects/totalservicepro/logs/functions
- **Full deployment guide, commands, custom domain DNS setup (A @ 75.2.60.5 + CNAME www), env vars (Supabase), and troubleshooting (deploys succeed but fetches may 404 until envs/routing confirmed in logs)**: See [DEPLOY.md](./DEPLOY.md)

**Note**: Deploys use `npm run deploy` (builds with webpack, ensures _redirects, deploys via Netlify CLI with --dir=.next + @netlify/plugin-nextjs). Visit unique URL + hard refresh to test latest. Custom domain requires DNS A @ -> 75.2.60.5 and CNAME www -> totalservicepro.netlify.app (see DEPLOY.md).

### Quick Deploy (from the `web/` directory in the worktree)
```powershell
npm run deploy
```
(See DEPLOY.md for prerequisites like `npx netlify login`, linking, build fixes applied for Next 16 + Windows + Netlify adapter, etc.)

**Custom domain note**: `RepairPlanet.net` is configured as the primary custom domain in Netlify. Complete DNS setup at your registrar (Namecheap etc.) per the detailed steps in DEPLOY.md. `MedicalRepairNetwork.com` can be added as an alias or 301 redirect to the primary.

## New Sign-Up Flows & Marketplace (Added 2026)

Professional role-based signups replace the basic engineer-only toggle:

- **/signup** — Overview landing with cards for all types + links. Prominent from Header (when logged out) and Login page.
- **/signup/fse** — For individual Field Service Engineers. Fields: name, email, password+confirm, phone, years exp, certifications (text), preferred regions (chips: Northeast/Southwest etc.), bio, LinkedIn link. Creates profile role=`fse`. No org created (affiliate later).
- **/signup/company** — For service companies. Creates `organizations` (type=`service_company`) + profile role=`service_manager`. Fields: company name, contact name/email/pw, phone, address/city/state, website, services (multi-chip: PM/Emergency/Install etc.), # techs, tax ID (opt), bio.
- **/signup/supplier** — For parts suppliers. Creates `organizations` (type=`parts_supplier`) + profile role=`parts_supplier`. Fields: company name, contact name/email/pw, phone, address/city/state, website, parts categories (multi-chip: Consumables/Handpieces/Optics etc.), # staff, tax ID (opt), bio.
- **/signup/owner** — For laser owners/facilities (customer side). Creates org type=`customer` + profile role=`owner`. Fields: facility name, contact, email/pw, phone, addr/city/state, type (Hospital/MedSpa/Clinic/etc select), # lasers, laser models (multi from shared MODELS), preferred services, notes. On success redirects owners to /marketplace.

All forms:
- Use existing `.card`/`.input`/`.label`/`.btn`/`.filter-chip` styles + Tailwind.
- Client validation (required, email, pw >=6, confirm match).
- Reuse `getSupabaseClient()` + `supabase.auth.signUp` + `upsert user_profiles` + `insert organizations` (with org_id link for company/owner).
- Success: auto-login if session or "check email to confirm" + redirect to `/` or `/marketplace`.
- Error handling matches login page. Mobile friendly. "Already have account? Sign in" links.
- Basic sign-up toggle still present in /login for backward (hardcodes `engineer`).

**Dashboard & roles**: Extended `Role` union + `isHighLevel`/`isFSE`/`isCustomer` in `app/page.tsx`. New roles recognized: `fse`, `owner`, `customer`, `company_admin`, `service_manager` (existing). Added Marketplace quick-access card + teaser section. Title shows "Owner / Facility Dashboard" for customer roles.

**Header updates**: "Sign Up" button (to /signup) next to Sign In for unauth users. Added "Marketplace" to main nav.

**Login page**: Added prominent "Join the Laser Service Network" section with direct links to /signup/fse, /signup/company, /signup/owner.

**Marketplace (/marketplace)**: 
- Service Requests (bidding): Uses `marketplace_requests` table + `bids` table for the bidding flow (see recent changes).
- Other listings (parts, used, consumables): Use `marketplace_parts`, `marketplace_listing` etc.
- Bidding flow implemented: requests list shows bid counts, detail page has bid form (inserts price + notes to bids with bidder_id), "My Bids" page at /bids.
- Create listing form at /marketplace/list supports type=request (and parts/used).
- "My Listings" at /marketplace/my-listings.
- Links from dashboard, hub, header nav, and signup pages.
- Note: DB schema references in older migrations/docs use `service_requests`; current web implementation uses `marketplace_requests` for the request bidding feature. Keep consistent or align via migration.

**Navigation/UX**: Marketplace linked from dashboard (quick access + teaser), hub, header nav. Signup pages mention live bidding. "Sign Up" + "Marketplace" prominent for unauth/auth.

**Docs**: See below + DEPLOY.md for RLS notes and deploy.

New routes live after deploy: visit `/signup`, `/signup/fse`, `/signup/company`, `/signup/owner`, `/marketplace` on your site (or unique Netlify URL).
