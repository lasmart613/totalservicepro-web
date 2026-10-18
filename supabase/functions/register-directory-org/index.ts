/**
 * register-directory-org
 *
 * Public "register your company free" endpoint for the standalone
 * Medical Repair Network site (https://medicalrepairnetwork.com).
 * Two steps; both write through service-role-only RPCs from migration 000926.
 * Never lists an org: new rows are pending (is_active = false,
 * list_in_directory = false) until someone reviews them.
 *
 * Secrets (supabase secrets set ...):
 *   DIRECTORY_FORM_SECRET        required, 32+ random chars (HMAC for form tickets, step-2 tokens, IP hashes)
 *   DIRECTORY_ALLOWED_ORIGINS    comma list, e.g. https://medicalrepairnetwork.com,https://www.medicalrepairnetwork.com,https://<preview>.netlify.app
 *   DIRECTORY_TURNSTILE_ENABLED  '1' to require Cloudflare Turnstile (off by default)
 *   TURNSTILE_SECRET_KEY         only when Turnstile is enabled
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 *
 * The site has no Supabase session, so deploy with JWT verification off:
 *   supabase functions deploy register-directory-org --project-ref yljztfajyvjzqikxdddf --no-verify-jwt
 * Apply migration 000926 first.
 */
import { handle } from './handler.ts'

Deno.serve((req) => handle(req, (k) => Deno.env.get(k)))
