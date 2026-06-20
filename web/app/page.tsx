'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Calendar, Wrench, Package, FileText } from 'lucide-react';
import AdBanner from '@/components/AdBanner';

export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    openTickets: 0,
    completedReports: 0,
    totalReports: 0,
  });
  const [fseStats, setFseStats] = useState<any[]>([]);

  const supabase = getSupabaseClient();

  useEffect(() => {
    const loadData = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u);

      if (!u) {
        setLoading(false);
        return;
      }

      // Get user profile + organization
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('first_name, role, organization_id')
        .eq('id', u.id)
        .single();

      setProfile(prof);

      if (!prof?.organization_id) {
        setLoading(false);
        return;
      }

      const orgId = prof.organization_id;

      // === Organization-level KPIs (real data only) ===
      const { data: reports } = await supabase
        .from('service_reports')
        .select('status, assigned_to')
        .eq('organization_id', orgId);   // ← Filtered by organization

      if (reports) {
        setStats({
          openTickets: reports.filter(r => r.status === 'draft' || r.status === 'open').length,
          completedReports: reports.filter(r => r.status === 'complete').length,
          totalReports: reports.length,
        });

        // === Per-FSE breakdown (for Admins) ===
        if (prof.role === 'admin' || prof.role === 'company_admin') {
          const fseMap: { [key: string]: { name: string; open: number; completed: number } } = {};

          // Get FSE names
          const fseIds = [...new Set(reports.map(r => r.assigned_to).filter(Boolean))];
          if (fseIds.length > 0) {
            const { data: fseUsers } = await supabase
              .from('user_profiles')
              .select('id, first_name, last_name')
              .in('id', fseIds);

            fseUsers?.forEach(fse => {
              fseMap[fse.id] = {
                name: `${fse.first_name || ''} ${fse.last_name || ''}`.trim(),
                open: 0,
                completed: 0,
              };
            });
          }

          // Count per FSE
          reports.forEach(report => {
            if (report.assigned_to && fseMap[report.assigned_to]) {
              if (report.status === 'complete') {
                fseMap[report.assigned_to].completed++;
              } else {
                fseMap[report.assigned_to].open++;
              }
            }
          });

          setFseStats(Object.values(fseMap));
        }
      }

      setLoading(false);
    };

    loadData();
  }, [supabase]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading dashboard...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-4xl mx-auto w-full px-4 py-10 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">Welcome to Total Service Pro</h1>
          <p className="text-xl text-[var(--text3)] mb-8">The professional platform for laser equipment service, parts, and marketplace.</p>
          <div className="flex justify-center gap-4">
            <Link href="/login" className="btn btn-primary px-8">Sign In</Link>
            <Link href="/signup" className="btn btn-secondary px-8">Sign Up</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Welcome back, {profile?.first_name || 'Tech'}!
        </h1>
        <p className="text-[var(--text3)]">Role: <span className="capitalize">{profile?.role}</span></p>

        <AdBanner />

        {/* Organization-specific KPIs (no hardcoded data) */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-8">
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--gold)]">{stats.openTickets}</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">OPEN TICKETS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-green-400">{stats.completedReports}</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">COMPLETED REPORTS</div>
          </div>
          <div className="card p-5 text-center">
            <div className="text-4xl font-extrabold text-[var(--blue)]">{stats.totalReports}</div>
            <div className="text-xs tracking-widest mt-1 text-[var(--text3)]">TOTAL REPORTS</div>
          </div>
        </div>

        {/* Admin: Per-FSE Breakdown */}
        {(profile?.role === 'admin' || profile?.role === 'company_admin') && fseStats.length > 0 && (
          <div className="mt-10">
            <h3 className="font-bold text-lg mb-4">FSE Performance (Organization)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {fseStats.map((fse, index) => (
                <div key={index} className="card p-5">
                  <div className="font-semibold mb-2">{fse.name || 'Unassigned FSE'}</div>
                  <div className="flex justify-between text-sm">
                    <span>Open:</span>
                    <span className="font-bold text-[var(--gold)]">{fse.open}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Completed:</span>
                    <span className="font-bold text-green-400">{fse.completed}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Service Calls */}
        <div className="mt-10">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Calendar size={20} /> Upcoming Service Calls
          </h3>
          <div className="card p-6">
            <p className="text-[var(--text3)]">Check the Service Schedule for upcoming calls.</p>
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

        {/* Marketplace Section */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">Marketplace</h3>
            <Link href="/marketplace" className="text-sm text-[var(--gold)] hover:underline">Browse all →</Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link href="/marketplace/parts" className="card p-6 hover:border-[var(--gold)] group">
              <div className="text-3xl mb-3">🔩</div>
              <div className="font-bold text-lg mb-1">Parts</div>
              <div className="text-sm text-[var(--text3)]">Parts listed for sale by suppliers</div>
            </Link>
            <Link href="/marketplace/used-systems" className="card p-6 hover:border-[var(--gold)] group">
              <div className="text-3xl mb-3">🖥️</div>
              <div className="font-bold text-lg mb-1">Used Laser Systems</div>
              <div className="text-sm text-[var(--text3)]">Buy or sell pre-owned equipment</div>
            </Link>
            <Link href="/marketplace/consumables" className="card p-6 hover:border-[var(--gold)] group">
              <div className="text-3xl mb-3">🧴</div>
              <div className="font-bold text-lg mb-1">Consumables</div>
              <div className="text-sm text-[var(--text3)]">Handpieces, fibers, tips & more</div>
            </Link>
            <Link href="/marketplace/requests" className="card p-6 hover:border-[var(--gold)] group">
              <div className="text-3xl mb-3">🛠️</div>
              <div className="font-bold text-lg mb-1">Service Requests / Needs</div>
              <div className="text-sm text-[var(--text3)]">Post or browse service needs</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}