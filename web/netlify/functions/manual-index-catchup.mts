/**
 * Netlify scheduled function: index published manuals that have a PDF but no
 * manual_search_index row. See web/lib/manual-index-catchup.ts.
 *
 * Schedule: every 15 minutes (UTC cron). Netlify does not expose scheduled
 * functions at a URL in production, so this cannot be called publicly; it
 * only runs on schedule for the published deploy, or from "Run now" in the
 * Netlify UI. It runs no work in Deploy Previews unless someone presses
 * Run now there.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY with the Functions scope, and migration 000918
 * applied. Without them it logs an error and writes nothing.
 * Set MANUAL_INDEX_CATCHUP_DISABLED=1 to turn it off without a deploy.
 *
 * Bundled by Netlify's default bundler for .mts (nft), which ships
 * pdfjs-dist as a real node module. No [functions] block in netlify.toml.
 */

import { createClient } from '@supabase/supabase-js';
import { runManualIndexCatchup, type CatchupClient } from '../../lib/manual-index-catchup.ts';

const manualIndexCatchup = async (): Promise<void> => {
  if (process.env.MANUAL_INDEX_CATCHUP_DISABLED === '1') {
    console.log(JSON.stringify({ event: 'manual-index-catchup', ok: true, disabled: true }));
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error(JSON.stringify({ event: 'manual-index-catchup', ok: false, error: 'missing Supabase URL or service role key' }));
    return;
  }
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const summary = await runManualIndexCatchup(admin as unknown as CatchupClient);
  if (!summary.ok) console.error(JSON.stringify({ event: 'manual-index-catchup-failed', error: summary.error }));
};

export default manualIndexCatchup;

export const config = {
  schedule: '*/15 * * * *',
};
