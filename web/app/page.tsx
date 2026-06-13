'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../components/Header';
import { getSupabaseClient } from '../lib/supabase/client';
import { FileText, Calendar, Users, BarChart3, UserCheck, Clock, BookOpen, Wrench, User, Building2, Hospital, Package } from 'lucide-react';

export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseClient();

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      setUser(u);
      if (u) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('first_name, last_name, role, organization_id')
          .eq('id', u.id)
          .maybeSingle();
        setProfile(prof);
      }
      setLoading(false);
    })();
  }, [supabase]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-[var(--text3)]">Loading dashboard...</div>
      </div>
    );
  }

  // Public homepage (not logged in)
  if (!user) {
    // Keep your nice 4-card onboarding here (or the improved version I gave earlier)
    // ... paste your current public return block if you prefer ...
    return <div>Your public homepage with 4 cards...</div>;
  }

  // Logged-in Dashboard
  const role = profile?.role || '';
  const isPartsSupplier = role === 'parts_supplier';

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">
          Welcome back, {profile?.first_name || 'Tech'}!
        </h1>
        <p className="text-[var(--text3)]">Role: <span className="capitalize">{role}</span></p>

        {isPartsSupplier && (
          <div className="mt-8 card p-6 bg-[var(--gold-glow)]/10 border border-[var(--gold-border)]">
            <h2 className="font-bold text-xl mb-3">Parts Supplier Dashboard</h2>
            <Link href="/marketplace?tab=parts" className="btn btn-primary inline-flex items-center gap-2">
              <Package size={20} /> List New Parts / Manage Inventory
            </Link>
          </div>
        )}

        {/* Quick Access Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
          <Link href="/reports" className="card p-6 text-center hover:border-[var(--gold)]">
            <FileText size={32} className="mx-auto mb-3 text-[var(--gold)]" />
            <div className="font-bold">Service Reports</div>
          </Link>
          <Link href="/marketplace" className="card p-6 text-center hover:border-[var(--gold)]">
            <Package size={32} className="mx-auto mb-3 text-[var(--gold)]" />
            <div className="font-bold">Marketplace</div>
          </Link>
          <Link href="/hub" className="card p-6 text-center hover:border-[var(--gold)]">
            <Wrench size={32} className="mx-auto mb-3 text-[var(--gold)]" />
            <div className="font-bold">Tech Hub</div>
          </Link>
          <Link href="/service-schedule" className="card p-6 text-center hover:border-[var(--gold)]">
            <Calendar size={32} className="mx-auto mb-3 text-[var(--gold)]" />
            <div className="font-bold">Schedule</div>
          </Link>
        </div>
      </div>
    </div>
  );
}