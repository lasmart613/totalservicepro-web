'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function AdminReports() {
  const [stats, setStats] = useState({
    totalTeam: 0,
    totalCustomers: 0,
    openTickets: 0,
    completedReports: 0,
  });
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const fetchStats = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) {
        setLoading(false);
        return;
      }

      const orgId = profile.organization_id;

      // Get team count
      const { count: teamCount } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId);

      // Get customer count (organizations of type 'customer')
      const { count: customerCount } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'customer');

      // Get service reports stats
      const { data: reports } = await supabase
        .from('service_reports')
        .select('status')
        .eq('organization_id', orgId);

      const open = reports?.filter(r => r.status === 'draft' || r.status === 'open').length || 0;
      const completed = reports?.filter(r => r.status === 'complete').length || 0;

      setStats({
        totalTeam: teamCount || 0,
        totalCustomers: customerCount || 0,
        openTickets: open,
        completedReports: completed,
      });

      setLoading(false);
    };

    fetchStats();
  }, []);

  if (loading) {
    return <div className="p-8">Loading reports...</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-8">Reports & Analytics</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-6">
          <div className="text-sm text-[var(--text3)]">Total Team Members</div>
          <div className="text-4xl font-extrabold mt-2">{stats.totalTeam}</div>
        </div>

        <div className="card p-6">
          <div className="text-sm text-[var(--text3)]">Total Customers</div>
          <div className="text-4xl font-extrabold mt-2">{stats.totalCustomers}</div>
        </div>

        <div className="card p-6">
          <div className="text-sm text-[var(--text3)]">Open Tickets</div>
          <div className="text-4xl font-extrabold mt-2 text-[var(--gold)]">{stats.openTickets}</div>
        </div>

        <div className="card p-6">
          <div className="text-sm text-[var(--text3)]">Completed Reports</div>
          <div className="text-4xl font-extrabold mt-2 text-green-400">{stats.completedReports}</div>
        </div>
      </div>

      <div className="mt-10 card p-6">
        <h3 className="font-bold mb-4">Coming Soon</h3>
        <p className="text-[var(--text3)]">
          More detailed analytics, revenue reports, FSE performance tracking, and export options will be added here.
        </p>
      </div>
    </div>
  );
}