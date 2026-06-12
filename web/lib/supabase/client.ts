/**
 * Supabase client for browser (Total Service Pro web)
 * Uses the same project/anon key as the Android WebView assets for shared data/auth/RLS.
 * Session persistence via localStorage (key 'tsp-auth-token' for cross-compat if needed, but Supabase default also works).
 *
 * For web strengths: no more _s= URL param passing or Android injection hacks.
 * onAuthStateChange and getSession work normally.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://yljztfajyvjzqikxdddf.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsanp0ZmFqeXZqenFpa3hkZGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MjMzMDYsImV4cCI6MjA4NTE5OTMwNn0.O3qRONKT4XdEoSZTPg0Lg_tLyThMxRAMWjGwHy5W5JM';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        storageKey: 'tsp-auth-token', // match Android/webview for potential future cross
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        autoRefreshToken: true,
        detectSessionInUrl: true, // web can use magic links etc in URL
      },
    });
  }
  return supabaseInstance;
}

// Convenience export for direct import
export const supabase = getSupabaseClient();

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

// Marketplace types (from 20260611 migration: service_requests, bids, service_contracts)
export type ServiceRequest = {
  id: string;
  organization_id?: string | number | null;
  posted_by?: string;
  title?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  service_type?: string | null;
  model_type?: string | null;
  urgency?: string | null;
  description?: string | null;
  budget_max?: number | null;
  budget_min?: number | null;
  status?: 'open' | 'bidding' | 'awarded' | 'closed' | string;
  created_at?: string;
  organizations?: {
    name?: string;
  } | null;
};

export type Bid = {
  id?: string;
  request_id: string;
  bidder_user_id: string;
  bidder_org_id?: string | number | null;
  amount?: number | null;
  proposed_date?: string | null;
  notes?: string | null;
  status?: 'pending' | 'accepted' | 'rejected' | string;
  created_at?: string;
  // joined for display (if RLS/select allows)
  bidder_profile?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
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
