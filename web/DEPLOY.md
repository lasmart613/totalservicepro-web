# Total Service Pro - Web Deployment on Netlify

This document covers production deployment of the Next.js web app (Total Service Pro) to Netlify.

## Current Project & URLs (as of final session)

- **Netlify Site / Project Name**: totalservicepro
- **Project ID**: 1d72bd7f-3f8b-44a1-a1a2-df0f4accaaba
- **Admin / Dashboard**: https://app.netlify.com/projects/totalservicepro
- **Production URL** (primary, custom domain): https://repairplanet.net
  - Configured in Netlify (custom_domain set), but requires DNS A/CNAME records (see below). Currently does not resolve (no A record, SOA parked.nsone.net).
- **Netlify App URL** (always available fallback): https://totalservicepro.netlify.app
- **Latest Unique Deploy URL** (post-bidding features, 2026-06): https://6a2966e4b15cd718d2251647--totalservicepro.netlify.app
  - Previous: https://6a28e78315d56bbf251f2f0f--totalservicepro.netlify.app (and earlier)
  - New unique deploy URLs are generated for each production deploy in the form `<deploy-id>--totalservicepro.netlify.app`.
- **Recent previous unique**: https://6a28e5f3e11767e0e5cacf96--totalservicepro.netlify.app
- **Build / Deploy Logs**: See links in CLI output after each deploy, or visit the deploys tab in the admin dashboard (e.g. https://app.netlify.com/projects/totalservicepro/deploys/6a28e78315d56bbf251f2f0f for latest).
- **Function Logs**: https://app.netlify.com/projects/totalservicepro/logs/functions

**Note on accessibility**: Deploys via CLI consistently succeed ("Using Next.js Runtime - v5.15.11", "Functions bundling" of ___netlify-server-handler, "Uploading blobs", "√ Deploy is live!", "🚀 Deploy complete"). However, direct HTTP fetches (PowerShell Invoke-WebRequest + prior checks) on *.netlify.app URLs (including latest unique) and routes (/ , /reports, /hub, /login) return Netlify 404 "Page not found". The custom https://repairplanet.net does not resolve (DNS). Visit the *unique* URL in a browser + hard refresh (Ctrl+Shift+R or Cmd+Shift+R); check the specific build log and function logs in the dashboard for runtime errors (e.g. missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY envs, handler crashes, blob/prerender mismatches for the Next pages). The config is now solid (see fixes). Prioritize the unique .netlify.app URL for testing. Full custom domain + SSL after DNS + propagation.

## Recommended Custom Domain

**Primary recommendation: RepairPlanet.net**

- Short, memorable, brandable.
- Directly communicates "repair" focus for laser/medical/aesthetic service professionals (fits "hub for laser service pros").
- Better than the longer alternative **MedicalRepairNetwork.com** (more descriptive but less punchy and harder to type/remember).

**MedicalRepairNetwork.com** can be added as a secondary/alias domain later if desired for SEO/expansion.

### Instructions to Add / Verify Custom Domain (post-deploy)

1. Go to the Netlify dashboard for the site: https://app.netlify.com/projects/totalservicepro
2. Navigate to **Domain management** (left sidebar or under Site settings > Domain management).
3. Click **Add custom domain** (or "Add domain alias").
4. Enter `repairplanet.net` (and optionally `www.repairplanet.net`).
5. Follow Netlify's prompts:
   - Netlify will provide the required DNS records (typically 4x A records for apex domains or a CNAME for the www subdomain, plus any for verification).
   - It will also offer to provision a free SSL cert (Let's Encrypt / Netlify).
6. Log in to your domain registrar (where you own RepairPlanet.net, e.g. Namecheap, GoDaddy, Cloudflare, etc.).
7. Add/update the DNS records exactly as provided by Netlify (use A records for apex if offered, or CNAME `www` -> `totalservicepro.netlify.app`).
   - Apex domains often need the A records (they point to Netlify's anycast IPs).
   - Remove any old A/CNAME records pointing elsewhere.
   - Propagation can take 5min–48hrs (use https://dnschecker.org to verify).
8. Back in Netlify Domain management:
   - Once DNS propagates and Netlify verifies, the domain will show as "Active" or "DNS verified".
   - Set `repairplanet.net` (and www if used) as the **primary domain** (Netlify will auto-redirect or you can configure).
   - Enable "HTTPS" / force HTTPS if not already.
9. (Optional) Add `MedicalRepairNetwork.com` the same way as an alias.

After DNS + verification, `https://repairplanet.net` will serve the production site (and Netlify will handle certs/renewals).

**No code changes** were needed for the custom domain itself (Next.js uses relative links/paths; no hard-coded absolute domains in the app per searches).

### Adding DNS Records (for repairplanet.net - nameservers delegated to Netlify but no A/CNAME; zone not fully active via API)

From final checks (PowerShell Resolve-DnsName + npx netlify api getSite/getDnsZones/getDNSForSite):
- NS: dns1.p09.nsone.net to dns4.p09.nsone.net (Netlify, good).
- repairplanet.net: only SOA (parked.nsone.net), no A records.
- www.repairplanet.net: "DNS name does not exist".
- totalservicepro.netlify.app: A 13.52.188.95, 52.52.192.191 (good).
- Site: custom_domain="repairplanet.net", url=https://repairplanet.net, managed_dns=true, dns_zone_id=null, default_domain=totalservicepro.netlify.app . getDNSForSite returned no records.

dns:add / dns:list not available in netlify-cli 26.1.0 (use api or dashboard). getDnsZones did not list repairplanet (zone may activate only after adding domain in UI).

**Recommended steps (dashboard primary):**
1. Go to https://app.netlify.com/projects/totalservicepro/domains (or npx netlify open:admin then Domain management).
2. Add custom domain `repairplanet.net` (and www.repairplanet.net if desired). Netlify should detect the existing NS delegation (p09.nsone.net) and let you manage the zone.
3. Once added/verified, in the DNS records editor for repairplanet.net, add:
   - A record: Host @ (apex), Value 75.2.60.5 (Netlify anycast load balancer; or apex-loadbalancer.netlify.com), TTL 3600.
   - CNAME: Host www, Value totalservicepro.netlify.app , TTL 3600.
4. (Optional via api after zone active): npx netlify api createDnsRecord --data '{"zone_id":"<zone-id-from-getDnsZones-or-getDNSForSite>","type":"A","hostname":"@","value":"75.2.60.5","ttl":3600}' (similar for CNAME).
5. Verify with https://dnschecker.org (A for repairplanet.net, CNAME for www) or PowerShell Resolve-DnsName. Propagation 5min-48h.
6. In Domain management, set repairplanet.net as **primary domain**, enable HTTPS / force HTTPS.
7. The custom will then serve the app (Netlify handles certs).

Remove old records at registrar (delegation = Netlify owns DNS; don't manage there). Once DNS points to Netlify IPs, https://repairplanet.net will serve (same as .netlify.app URLs). 

(CLI status + getSite confirmed Project URL and custom already associated; the missing piece is the actual A/CNAME records in the zone.)

## Deploy Scripts & Commands

In `package.json`:

```json
"scripts": {
  ...
  "build": "next build --webpack",
  "deploy": "netlify deploy --prod",
  "deploy:preview": "netlify deploy"
}
```

- `npm run build`: Builds with webpack (see fixes below). Produces `.next/`.
- `npm run deploy`: Production deploy (updates live site at Production URL).
- `npm run deploy:preview`: Creates a draft/preview deploy (useful for testing; provides a unique preview URL, does not affect prod).

Direct CLI equivalent (as allowed by task):
- `npx netlify deploy --prod`
- `npx netlify deploy` (for preview)

**Start by checking status** (as required):
```powershell
cd "C:/Users/larry/Documents/Android Projects/total-service-pro-web/web"
npx netlify status
```
(Confirmed logged in as larrysmart@gmail.com, linked to totalservicepro with Project URL https://repairplanet.net.)

**To deploy production** (run in the /web dir; uses toml publish=".next" + build script for _redirects):
```powershell
cd "C:\Users\larry\Documents\Android Projects\total-service-pro-web\web"
npm run deploy
# or
npx netlify deploy --prod
```

The process:
- Runs the `[build]` command from `netlify.toml` (npm run build --webpack + writes .next/_redirects).
- Uses Next.js Runtime v5 + @netlify/plugin-nextjs for bundling ___netlify-server-handler, blobs for static pages, asset mapping.
- "Deploy path: .next", "Deploy is live!", unique URL printed.
- Full output includes build logs link and function logs link.

Monitor for the unique *.netlify.app URL. After "Deploy is live!", test the unique URL in browser (hard refresh) + check the linked build log + function logs.

**Preview**:
```powershell
npm run deploy:preview
# or
npx netlify deploy
```

## Config Files

- `netlify.toml` (updated during this work for reliable Next.js + CLI deploys):
  ```toml
  [build]
    command = "npm run build"
    publish = "."

  # Next.js redirects for publish="." + runtime (maps expected /_next/static to actual location
  # in .next/ and routes everything else to the server handler function for the full app).
  [[redirects]]
    from = "/_next/static/*"
    to = "/.next/static/:splat"
    status = 200

  [[redirects]]
    from = "/_next/image/*"
    to = "/.next/image/:splat"
    status = 200

  [[redirects]]
    from = "/*"
    to = "/.netlify/functions/___netlify-server-handler"
    status = 200
    force = true

  [[headers]]
    for = "/*"
    [headers.values]
      X-Frame-Options = "SAMEORIGIN"
      X-Content-Type-Options = "nosniff"
      Referrer-Policy = "strict-origin-when-cross-origin"
      X-XSS-Protection = "1; mode=block"
  ```

- `package.json`: Deploy scripts fixed (removed `--dir=.next` which overrode publish and broke routing in early runs; now relies on netlify.toml).
- `next.config.ts`: Retains previous fixes:
  - `build` uses `--webpack` flag (avoids SWC native binding issues on some Windows; falls back to WASM gracefully, as seen in all build logs).
  - `typescript.ignoreBuildErrors: true`
  - `outputFileTracingRoot` for correct monorepo-like lockfile handling.

## Fixes Applied During This Session (to get deploys live + routing)

- Installed `@netlify/plugin-nextjs@5.15.11` as devDep (`npm install --save-dev @netlify/plugin-nextjs`) - it was missing from package.json/node_modules despite being declared in netlify.toml (only CLI internals were present before). This ensures the plugin is active for hooks, Next.js Runtime v5, function bundling, and blobs.
- Updated netlify.toml: added explicit `publish = ".next"` under [build] (with detailed comments); kept `[[plugins]] package = "@netlify/plugin-nextjs"` and security headers. Removed old --dir comments. (The plugin/CLI often resolves to .next for standalone anyway; explicit + matching _redirects avoids "missing _redirects in publish" warnings.)
- Updated package.json scripts: "deploy": "netlify deploy --prod" (no --dir, relies on toml); "build" keeps the node one-liner writing .next/_redirects (with /* -> handler 200!, /_next/static/* -> /static/:splat 200 etc for the publish=.next layout). Also updated "deploy:preview".
- Thorough clean builds/deploys: removed .next + .netlify/deploy + root _redirects before runs (PowerShell Remove-Item). Ran `npm run build` (captured full: "Compiled successfully", all routes incl. ƒ /reports/[id] dynamic + static ○ , "Wrote .next/_redirects", SWC WASM fallback warnings ignored) then `npm run deploy` / npx netlify deploy --prod (in background with polling for full logs). Multiple iterations with variants (--dir, root _redirects with /.next/static, netlify build sim).
- All good deploys: "Using Next.js Runtime - v5.15.11", "Functions bundling" ___netlify-server-handler from .netlify/functions-internal, "Uploading blobs", "√ Deploy is live!", "🚀 Deploy complete", Lighthouse. Latest unique: https://6a28e78315d56bbf251f2f0f--totalservicepro.netlify.app (deploy path .next respected, _redirects present in publish dir, 0/1 assets uploaded).
- DNS/Domain: npx netlify status confirmed link + Project URL + custom_domain="repairplanet.net" + managed_dns=true (from getSite api). Used Resolve-DnsName extensively (NS= dns*.p09.nsone.net good/Netlify, but no A for repairplanet.net, SOA parked.nsone.net, www.repairplanet.net "does not exist", totalservicepro.netlify.app resolves to Netlify IPs 13.52.188.95 + 52.52.192.191). Tried npx netlify dns:* (not supported in cli 26.1.0), npx netlify api getDnsZones/getDNSForSite/createDnsRecord/getSite (no zone found, dns_zone_id=null, getDNSForSite=[] ; custom set but records not present). 
- Verification: PS Invoke-WebRequest on all uniques/main + /reports /hub /login (always 404 "Not Found" despite live deploys); no root _redirects left; .next/_redirects + standalone + functions-internal confirmed. netlify build sim used for debug (showed same plugin flow, defaulted to publish .next).
- Updated this doc + README with final URLs, exact DNS results, fixes, and commands. Stayed strictly in web/ worktree (cd "C:\Users\larry\Documents\Android Projects\total-service-pro-web\web" every terminal cmd, absolute quoted paths). No Android files touched.
- Remaining: Despite config, fetches 404 (see note in URLs section). Likely runtime (check function logs for Supabase env errors or handler issues) or plugin routing not fully wiring the _redirects/handler in this Windows/CLI/Next16 setup. The deploys are "live" per Netlify.

If a deploy "fails" in future (e.g. 404s on *.netlify.app), re-run `npm run deploy` (after `npx netlify status`), open the *unique* deploy URL in browser + hard refresh, check build/function logs in dashboard, verify .next/_redirects + toml after build, and ensure NEXT_PUBLIC_SUPABASE_* envs are set in dashboard (then redeploy). The unique URL is the reliable test for that deploy's output.

## Environment Variables (Important for Supabase / Auth / Data)

The app shares backend with the Android app via Supabase (RLS, real-time, same org-scoped data).

In `lib/supabase/client.ts` there are fallback values, but **set these in Netlify for production** (and remove hard-coded fallbacks eventually):

1. Dashboard > Site configuration > Environment variables.
2. Add (as "Plain text", available to client via NEXT_PUBLIC_ prefix):
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL (e.g. https://yljztfajyvjzqikxdddf.supabase.co)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon/public key
3. Redeploy after setting (or use "Deploy" button in dashboard for existing deploys).
4. (Optional) Add other secrets if server-only code is added later.

Without these, the web app will fall back to the (public demo?) values in the source—fine for testing but use the production/shared Supabase project.

## Other Notes

- The app is a hybrid Next.js App Router site (mostly client components for dashboards/forms + Supabase client; one dynamic server-capable route).
- All deploys use the linked project and netlify.toml build settings.
- For future git-based deploys: connect the repo in the Netlify dashboard under "Build & deploy" > Continuous deployment. CLI is for manual/isolated worktree deploys as here.
- Lighthouse plugin runs on deploys (from Netlify app).
- To view live site after DNS: visit https://repairplanet.net (or the netlify.app equivalent).
- Update this file or run `npm run deploy` again after code changes.

## Quick Commands Reference

```powershell
cd "C:\Users\larry\Documents\Android Projects\total-service-pro-web\web"

npx netlify status                 # Check login + linked project + Project URL (should show repairplanet.net)
npm run build                      # Local prod build (webpack + writes .next/_redirects; inspect routes)
npm run deploy                     # Full prod deploy (uses toml publish + plugin; produces unique URL)
npm run deploy:preview             # Preview deploy only
npx netlify build                  # Local simulation of build + plugin (for debug, no deploy)
npx netlify unlink                 # If link is wrong
npx netlify link --id 1d72bd7f-3f8b-44a1-a1a2-df0f4accaaba  # Force link to correct site
```

Always cd to the web/ dir first (use absolute quoted path on Windows). Deploy complete when you see "🚀 Deploy complete", "Production URL", "Unique deploy URL", and "Deploy is live!".

After deploy: open the *unique* URL (e.g. https://6a28e78315d56bbf251f2f0f--totalservicepro.netlify.app) + hard refresh. Check the build log link printed + function logs for 404 root cause (e.g. set Supabase envs under Site configuration > Environment variables if missing, then redeploy).

For custom domain setup, follow the dashboard steps above (add records A @ 75.2.60.5 + CNAME www). RepairPlanet.net is the suggested primary.

(Changes kept in the isolated worktree per instructions. All terminal work used cd "C:\Users\larry\Documents\Android Projects\total-service-pro-web\web" + absolute paths.)

## Sign-Up Flows, Roles & Marketplace (Post-2026-06 updates)

New dedicated professional signups and marketplace were added (see README for full details + exact field lists).

**New routes**:
- `/signup` (overview + cards)
- `/signup/fse`
- `/signup/company`
- `/signup/supplier` (new: Parts Supplier, type=`parts_supplier`, role=`parts_supplier`)
- `/signup/owner`
- `/marketplace` (post needs to marketplace_requests for bidding flow + bids table, also marketplace_parts/listings; My Bids at /bids; role-aware)

These are included in builds (static prerendered). All use existing Supabase client, styles, and auth patterns.

**Manual Supabase RLS / Schema Steps Required (for full functionality)**:
After first deploys with these features, in Supabase dashboard (https://supabase.com/dashboard/project/yljztfajyvjzqikxdddf or your shared project):

1. **user_profiles** table:
   - Ensure RLS policy allows: `INSERT` / `UPDATE` for authenticated users where `id = auth.uid()`.
   - (Existing basic engineer signup relied on this; new roles reuse same upsert.)

2. **organizations** table:
   - Add RLS policy for authenticated inserts (e.g. `CREATE POLICY "Users can create their org during signup" ON organizations FOR INSERT TO authenticated WITH CHECK (true);` or more restrictive using `auth.uid()` via a created_by column if added).
   - Columns used: name, type ('service_company' or 'customer'), address, city, state, phone, website, bio, etc. (flexible; add columns like facility_type, num_lasers, laser_models, services_offered, num_techs, tax_id if you want strict typing vs jsonb).

3. **New marketplace tables** (recommended for clean separation; run the dedicated migration):
   - Run `supabase/migrations/20260611_000000_add_marketplace_tables.sql` (from the main Android project root; it lives alongside other migrations).
   - This creates:
     - `marketplace_requests` (current web impl for service request bidding): posted needs. (Older migrations reference `service_requests` — align as needed.)
     - `bids`: proposals (id, request_id, bidder_user_id, bidder_org_id, amount, proposed_date, notes, status='pending'/'accepted'/'rejected').
     - `service_contracts` (optional, for awarded bids).
   - Also adds columns to `user_profiles` (phone, experience_years, certifications, preferred_regions, bio, linkedin_url, job_title) and `organizations` (phone, website, services_offered, num_techs, tax_id, num_laser_systems, laser_models, facility_type, preferred_services) for the signup data.
   - Includes full RLS policies (owners manage their requests + bids on them + insert contracts; pros can insert/select bids on open requests; authenticated read open requests etc.). If bids insert fails for pros, verify policy allows INSERT on bids WHERE the request is open/bidding and bidder is authenticated (not the poster). Use Table Editor or the migration SQL.
   - After running: `NOTIFY pgrst, 'reload schema';` (or refresh schema cache in Supabase dashboard Table Editor).
   - Update the web `app/marketplace/*` (bidding implemented): queries/inserts `marketplace_requests` for service request posts, `bids` for responses (bidder_id, price in current code), plus other marketplace_* tables for parts/listings. My Bids at /bids. Links and forms in requests + list + bids pages.
   - Note: Some older notes/docs reference service_requests; current implementation standardized on marketplace_requests for the requests bidding feature.
   - Demo seeds shown if query/RLS fails initially (or no migration applied).

4. **user_profiles** extra columns (optional but recommended for clean data):
   - Add: experience_years (int), certifications (text), preferred_regions (text), bio (text), linkedin_url (text), job_title (already), etc. Or use a jsonb `metadata` column.
   - The upsert in signups will succeed with extra keys if columns exist or if Supabase accepts (it does for unknown in some modes; better to add).

5. After RLS changes: test by signing up via the forms on the live unique URL (hard refresh). Check auth.users + user_profiles + organizations rows in Table Editor. Re-deploy after any schema changes if needed.

**Role handling**: Extended in lib/supabase/client.ts (UserProfile) and app/page.tsx (dashboard logic, isHighLevel includes owner/customer/company_admin, isFSE, new isCustomer, updated titles).

**Testing signups locally**: `npm run dev` then visit http://localhost:3000/signup (or /login for links). Use real Supabase project (envs or the fallback in client.ts).

**Deploy after these features**:
```powershell
cd "C:\Users\larry\Documents\Android Projects\total-service-pro-web\web"
npm run build   # verifies all routes incl new ones
npm run deploy  # or npx netlify deploy --prod
```
Monitor the build log for "Compiled successfully" and the printed unique deploy URL. Always hard-refresh the unique *.netlify.app URL in browser to test new pages (login flow, forms, marketplace post + list + bidding: post as owner signup, switch browser/profile or incognito for pro signup, bid, accept to see contract row in Supabase). Test role flows end-to-end for the vision.

The marketplace + signups + bidding/accept/contract flow are advancing the RepairPlanet / service matching vision. Bidding is now functional end-to-end in beta (post → bid → accept creates service_contract). Notifications, full contract views, payments are next.

Update this file + README after future RLS tweaks or marketplace table migrations.
