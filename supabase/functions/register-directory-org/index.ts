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
 *   DIRECTORY_ALLOWED_ORIGINS    comma list, e.g. https://medicalrepairnetwork.com,https://www.medicalrepairnetwork.com,https://medicalrepairnetwork.netlify.app
 *   DIRECTORY_TURNSTILE_ENABLED  'true' (or '1') to require Cloudflare Turnstile. REQUIRED for public launch. Fails closed.
 *   TURNSTILE_SECRET_KEY         set by CEO; with the flag on and no secret, step 1 is refused
 *   DIRECTORY_MIN_RESPONSE_MS    optional, default 450 (step-1 answers are padded to this + up to 150 ms jitter)
 *   RESEND_API_KEY               review notice (same key the app uses)
 *   DIRECTORY_REVIEW_INBOX       review notice recipient (no default; unset = no notice)
 *   DIRECTORY_NOTICE_FROM        optional sender, default Medical Repair Network <contact@medicalrepairnetwork.com>
 *   DIRECTORY_REVIEW_URL         optional, default https://repairplanet.net/admin/god/directory
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 *
 * The site has no Supabase session, so deploy with JWT verification off:
 *   supabase functions deploy register-directory-org --project-ref yljztfajyvjzqikxdddf --no-verify-jwt
 * Apply migration 000926 first.
 */
import { handle } from './handler.ts'

Deno.serve((req) => handle(req, (k) => Deno.env.get(k)))
