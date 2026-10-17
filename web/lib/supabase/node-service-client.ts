/**
 * Service-role Supabase client for plain Node: Netlify functions (nodejs20.x)
 * and local scripts. Not for Next.js routes (use lib/supabase/admin.ts).
 *
 * supabase-js 2.108+ builds a RealtimeClient inside createClient, and on
 * Node < 22 (no global WebSocket) that throws before any query. That stalled
 * the manual-index catch-up on 2026-10-17. Passing ws as the realtime
 * transport satisfies the constructor; nothing here subscribes to realtime.
 */
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

export const NODE_REALTIME_TRANSPORT = ws as unknown as typeof WebSocket;

export function createNodeServiceClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: NODE_REALTIME_TRANSPORT },
  });
}
