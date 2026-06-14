'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../components/Header';
import { getSupabaseClient } from '../lib/supabase/client';
import { FileText, Calendar, Users, BarChart3, UserCheck, Clock, BookOpen, Wrench, User, Building2, Hospital, Package } from 'lucide-react';
import { toast } from 'sonner';

type Role = string;

interface Profile {
  role?: Role;
  first_name?: string;
  last_name?: string;
  organization_id?: string | number | null;
}

export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ drafts: 0, complete: 0, openTickets: 0, myAssigned: 0, teamReports: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  const supabase = getSupabaseClient();

  useEffect(() => {
    (async () => {
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        setUser(u);
        if (!u) {
          setLoading(false);
          return;
        }

        const { data: prof } = await supabase
          .from('user_profiles')
          .select('first_name, last_name, role, organization_id')
          .eq('id', u.id)
          .maybeSingle();
        setProfile(prof);

        // Load reports (demo / real data)
        const { data: reps } = await supabase
          .from('service_reports')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(20);

        if (reps) {
          setStats({
            drafts: reps.filter(r => r.status === 'draft').length,
            complete: reps.filter(r => r.status === 'complete').length,
            openTickets: reps.filter(r => r.status === 'draft' || r.status === 'open').length,
            myAssigned: 5, // placeholder
            teamReports: reps.length,
          });
          setRecent(reps.slice(0, 8));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  const role = profile?.role || '';
  const isPartsSupplier = role === 'parts_supplier';
  const isHighLevel = ['service_manager', 'company_admin', 'admin', 'owner'].includes(role);
  const isFSE = ['fse', 'engineer'].includes(role);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-lg text-[var(--text3)]">Loading your dashboard...</div>
      </div>
    );
  }

  // Public homepage
  if (!user) {
    // Public / unauthenticated home. (Prominent 4-tile grid was previously here and on /signup; removed FSE tile per org-type-first model. 3 org-type tiles kept on /signup: Service Company, Laser Owner/Facility, Parts Supplier.)
    // FSE is only a role inside a Service Company org (added by company_admin/service_manager via /company Team; individuals use /signup/fse first).
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        {/* unauthenticated entry tiles / cards now consolidated on /signup to match "org type first, then roles inside" (no top-level FSE tile on entry points) */}
      </div>
    );
  }

  // Logged-in Dashboard
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Welcome back, {profile?.first_name || 'Tech'}!
        </h1>
        <p className="text-[var(--text3)]">Role: <span className="capitalize">{role}</span></p>

        {isPartsSupplier && (
          <div className="mt-6 p-6 border border-[var(--gold-border)] bg-[var(--gold-glow)]/10 rounded-xl">
            <h2 className="font-bold text-xl mb-3">Parts Supplier Tools</h2>
            <Link href="/marketplace?tab=parts" className="btn btn-primary">
              List New Parts / Manage Inventory →
            </Link>
          </div>
        )}

        {/* KPIs - Organizational + Per FSE (FSE role within service_company org) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--gold)]">{stats.openTickets}</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">OPEN TICKETS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-green-400">{stats.complete}</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">COMPLETED</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--blue)]">{stats.teamReports}</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">TOTAL REPORTS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-purple-400">87%</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">ON-TIME RATE</div>
          </div>
        </div>

        {/* Upcoming Service Calls */}
        <div className="mt-10">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Calendar size={20} /> Upcoming Service Calls (Next 3-4 Days)
          </h3>
          <div className="card p-6">
            {/* Demo upcoming calls - replace with real query later */}
            <p className="text-[var(--text3)]">3 upcoming calls this week. Full schedule view in Service Schedule.</p>
            <Link href="/service-schedule" className="text-[var(--gold)] mt-4 inline-block hover:underline">View Full Schedule →</Link>
          </div>
        </div>

        {/* Quick Access */}
        <div className="mt-12">
          <h3 className="font-bold text-lg mb-4">Quick Access</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/hub" className="card p-6 text-center hover:border-[var(--gold)]">
              <Wrench size={32} className="mx-auto mb-3 text-[var(--gold)]" />
              <div className="font-bold">Tech Hub</div>
            </Link>
            <Link href="/service-schedule" className="card p-6 text-center hover:border-[var(--gold)]">
              <Calendar size={32} className="mx-auto mb-3 text-[var(--gold)]" />
              <div className="font-bold">Service Schedule</div>
            </Link>
            <Link href="/marketplace" className="card p-6 text-center hover:border-[var(--gold)]">
              <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
              <div className="font-bold">Marketplace</div>
            </Link>
            <Link href="/reports" className="card p-6 text-center hover:border-[var(--gold)]">
              <FileText size={32} className="mx-auto mb-3 text-[var(--gold)]" />
              <div className="font-bold">Reports</div>
            </Link>
          </div>
        </div>

        <div className="mt-16 text-center text-xs text-[var(--text3)]">
          Total Service Pro • Connected to Supabase • Role-aware dashboard
        </div>
      </div>
    </div>
  );
}