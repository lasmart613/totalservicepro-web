/**
 * Supabase client for browser (Total Service Pro web only).
 * Prefers NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Falls back to the public anon pair already shipped on repairplanet.net so
 * Git/Netlify preview builds can prerender when those env vars are
 * Production-scoped only. Anon key is a public client credential (RLS still applies).
 *
 * Session persistence via localStorage using 'tsp-auth-token' for compatibility.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://yljztfajyvjzqikxdddf.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsanp0ZmFqeXZqenFpa3hkZGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MjMzMDYsImV4cCI6MjA4NTE5OTMwNn0.O3qRONKT4XdEoSZTPg0Lg_tLyThMxRAMWjGwHy5W5JM';

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
}

function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  supabaseInstance = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: {
      persistSession: true,
      storageKey: 'tsp-auth-token',
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return supabaseInstance;
}

// Helper to get the configured Supabase URL (useful for constructing function URLs etc.)
export function getSupabaseUrl(): string {
  // Always read directly so it works even if the lazy client hasn't been initialized yet
  return supabaseUrl();
}

// Types for common rows (expand as needed; or use Supabase generated types later)
export type UserProfile = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  role?: 'engineer' | 'fse' | 'dispatcher' | 'service_manager' | 'company_admin' | 'parts_supplier' | 'billing_manager' | 'crm' | 'admin' | 'owner' | 'customer' | string;
  additional_roles?: string[] | null;  // jsonb for multi-role support (sole prop etc); primary always in role field
  organization_id?: string | number | null;
  avatar_url?: string | null;
  notification_prefs?: any;
  onboarding_completed?: boolean;
  created_at?: string;
  organizations?: {
    id: string | number;
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    phone?: string;
    logo_url?: string;
    type?: string;
    ticket_prefix?: string;
  } | null;
};

export type ServiceReport = {
  id: string;
  report_number?: string | null;
  organization_id?: string | number | null;
  created_by?: string;
  model_type?: string;
  equipment_name?: string;
  serial_number?: string;
  customer_name?: string;
  customer_address?: string;
  customer_city?: string;
  customer_state?: string;
  customer_phone?: string;
  customer_email?: string;
  service_type?: string;
  status?: 'draft' | 'complete';
  date_out?: string;
  next_pm_due?: string;
  service_engineer?: string;
  ticket_number?: string;
  comments?: string;
  ground_resistance?: number | null;
  leakage_current?: number | null;
  ground_resistance_pass?: boolean;
  leakage_current_pass?: boolean;
  checklist_electrical?: Record<string, string>;
  checklist_mechanical?: Record<string, string>;
  checklist_aesthetic?: Record<string, string>;
  power_measurements?: any[];
  model_parameters?: Record<string, any>;
  test_equipment?: any[];
  tech_name?: string;
  tech_phone?: string;
  tech_email?: string;
  tech_company_name?: string;
  tech_company_address?: string;
  tech_company_city?: string;
  tech_company_state?: string;
  tech_company_phone?: string;
  tech_company_logo_url?: string;
  updated_at?: string;
  created_at?: string;
  // plus any other snapshot or relation fields
};

// Laser repair needs: service_requests (+ bids). Marketplace no longer stores repair posts.
export type ServiceRequest = {
  id: string;
  organization_id?: string | number | null;
  created_by?: string;
  posted_by?: string;
  title?: string | null;
  description?: string | null;
  urgency?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  location_id?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  preferred_date?: string | null;
  error_codes?: string | null;
  images?: string[] | null;
  service_type?: string | null;
  model_type?: string | null;
  equipment_id?: number | null;
  category?: string | null;
  budget_max?: number | null;
  budget_min?: number | null;
  status?: 'open' | 'bidding' | 'awarded' | 'closed' | string;
  created_at?: string;
  // joined
  bids?: { count: number }[] | null;
  organizations?: { name?: string } | null;
};

export type Bid = {
  id?: string;
  request_id: string;
  bidder_id: string; // used in current inserts/queries
  bidder_user_id?: string; // legacy
  bidder_org_id?: string | number | null;
  price?: number | null; // amount used as price in current UI
  amount?: number | null;
  proposed_date?: string | null;
  notes?: string | null;
  status?: 'pending' | 'accepted' | 'rejected' | string;
  created_at?: string;
  // joined for display
  service_requests?: {
    title?: string | null;
    description?: string | null;
    urgency?: string | null;
    manufacturer?: string | null;
    model?: string | null;
  } | null;
};

export type ServiceContract = {
  id?: string;
  request_id: string;
  bid_id: string;
  owner_user_id?: string;
  provider_user_id?: string;
  amount?: number | null;
  status?: string;
  created_at?: string;
};

/**
 * Claims any pending engineer_invitations for this email (by exact email match).
 * If found and not accepted, applies organization_id + role to the profile,
 * marks invitation accepted. Called after signups / onboarding to auto-assign
 * FSEs invited during RSP org setup. (Auto-apply recommended UX.)
 */
export async function claimPendingInvitations(supabase: SupabaseClient, userId: string, email: string) {
  if (!email || !userId) return;
  try {
    const clean = email.toLowerCase().trim();
    // Founders who just created an org must not be pulled into a pending FSE invite.
    const { data: existingProf } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', userId)
      .maybeSingle();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const invited = !!(authUser?.user_metadata as any)?.invited_member;
    const founderRoles = new Set(['company_admin', 'admin', 'owner', 'parts_supplier']);
    const metaRole = String((authUser?.user_metadata as any)?.role || '').toLowerCase();
    const signupKind = String((authUser?.user_metadata as any)?.signup_kind || '').toLowerCase();
    const isFounderSignup =
      !invited &&
      (founderRoles.has(String(existingProf?.role || '').toLowerCase()) ||
        founderRoles.has(metaRole) ||
        ['company', 'owner', 'supplier'].includes(signupKind));
    if (isFounderSignup && (existingProf?.organization_id || signupKind || founderRoles.has(metaRole))) {
      return;
    }
    // Prefer server claim (bypasses RLS) when we have a session
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token && typeof fetch !== 'undefined') {
        const res = await fetch('/api/team/claim', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        });
        if (res.ok) {
          console.log('[TSP] Claimed invitation via API for', clean);
          return;
        }
      }
    } catch (apiErr) {
      console.warn('claim API fallback to client', apiErr);
    }

    const { data: invites, error: selErr } = await supabase
      .from('engineer_invitations')
      .select('*')
      .ilike('email', clean)
      .eq('accepted', false)
      .order('created_at', { ascending: false })
      .limit(1);
    if (selErr) console.warn('claimPendingInvitations select', selErr);

    let inv = invites?.[0];
    // Also try metadata from auth user
    const { data: { user } } = await supabase.auth.getUser();
    const meta = user?.user_metadata || {};
    const orgId = inv?.organization_id ?? meta.organization_id ?? null;
    if (!orgId) {
      console.warn('[TSP] No invitation/org to claim for', clean);
      return;
    }

    const update: any = {
      organization_id: orgId,
      role: inv?.role || meta.role || 'fse',
      onboarding_completed: true,
    };
    if (inv?.first_name || meta.first_name) update.first_name = inv?.first_name || meta.first_name;
    if (inv?.last_name || meta.last_name) update.last_name = inv?.last_name || meta.last_name;

    const { error: upErr } = await supabase.from('user_profiles').update(update).eq('id', userId);
    if (upErr) {
      // Profile may not exist yet
      await supabase.from('user_profiles').upsert({
        id: userId,
        email: clean,
        ...update,
      }, { onConflict: 'id' });
    }
    if (inv?.id) {
      await supabase.from('engineer_invitations').update({
        accepted: true,
        accepted_at: new Date().toISOString()
      }).eq('id', inv.id);
    }
    console.log('[TSP] Claimed pending invitation for', clean, 'org', orgId);
  } catch (e) {
    console.warn('claimPendingInvitations non-fatal:', e);
  }
}
