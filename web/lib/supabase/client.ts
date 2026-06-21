/**
 * Supabase client for browser (Total Service Pro web only).
 * MUST be configured via NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.
 * Never hardcode keys in source.
 *
 * Session persistence via localStorage using 'tsp-auth-token' for compatibility.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables. ' +
      'These are required for the web app. Configure them in your deployment (e.g. Netlify) or .env.local file.'
    );
  }

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
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
  return process.env.NEXT_PUBLIC_SUPABASE_URL || '';
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

// Marketplace types for the web app (marketplace_requests + bids used for service request bidding)
export type ServiceRequest = {
  id: string;
  organization_id?: string | number | null;
  created_by?: string;
  posted_by?: string; // legacy
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
  marketplace_requests?: {
    title?: string | null;
    description?: string | null;
    urgency?: string | null;
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
