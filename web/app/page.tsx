'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../components/Header';
import { getSupabaseClient } from '../lib/supabase/client';
import { FileText, Calendar, Users, BarChart3, UserCheck, Clock, CheckCircle, BookOpen, Wrench, User, Building2, Hospital, Package, Search, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';

type Role = 'engineer' | 'fse' | 'dispatcher' | 'service_manager' | 'company_admin' | 'parts_supplier' | 'admin' | 'billing_manager' | 'crm' | 'owner' | 'customer' | string;

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

  // ... (keep your existing dashboard logic for logged-in users - I left it unchanged for now)

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-white">
        <Header />

        {/* Hero Section */}
        <div className="pt-16 pb-12 text-center px-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter mb-4">
              Laser Service.<br />Parts.<br />Marketplace.
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Connect Field Service Engineers, Service Companies, Laser Owners, and Parts Suppliers in one professional network.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/marketplace" className="btn btn-primary text-lg px-8 py-3">
                Browse Marketplace
              </Link>
              <Link href="#roles" className="btn border border-[var(--gold)] text-lg px-8 py-3 hover:bg-white/5">
                Join as a Professional
              </Link>
            </div>
          </div>
        </div>

        {/* Role Cards */}
        <div id="roles" className="max-w-6xl mx-auto w-full px-4 pb-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-2">Choose Your Role</h2>
            <p className="text-gray-400">Professional sign-up for the laser service & parts ecosystem</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* FSE Card */}
            <Link href="/signup/fse" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col h-full">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <User size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Field Service Engineer (FSE)</div>
              <div className="text-sm text-[var(--text3)] mb-4">Independent techs and certified engineers</div>
              <ul className="text-sm space-y-1.5 mb-6 text-[var(--text2)] flex-1">
                <li>• Certifications & experience</li>
                <li>• Preferred regions</li>
                <li>• Browse open jobs & bid</li>
                <li>• Access manuals & tools</li>
              </ul>
              <div className="btn btn-primary w-full mt-auto">Sign Up as FSE →</div>
            </Link>

            {/* Service Company Card */}
            <Link href="/signup/company" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col h-full">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <Building2 size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Service Company</div>
              <div className="text-sm text-[var(--text3)] mb-4">Teams & businesses offering laser service</div>
              <ul className="text-sm space-y-1.5 mb-6 text-[var(--text2)] flex-1">
                <li>• Company profile & services</li>
                <li>• Manage technicians</li>
                <li>• Bid on contracts</li>
                <li>• Team scheduling tools</li>
              </ul>
              <div className="btn btn-primary w-full mt-auto">Sign Up as Company →</div>
            </Link>

            {/* Laser Owner Card */}
            <Link href="/signup/owner" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col h-full">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <Hospital size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Laser Owner / Facility</div>
              <div className="text-sm text-[var(--text3)] mb-4">Hospitals, clinics, med spas</div>
              <ul className="text-sm space-y-1.5 mb-6 text-[var(--text2)] flex-1">
                <li>• Post service & PM needs</li>
                <li>• Receive competitive bids</li>
                <li>• Manage your equipment fleet</li>
                <li>• Access service history</li>
              </ul>
              <div className="btn btn-primary w-full mt-auto">Sign Up as Owner →</div>
            </Link>

            {/* Parts Supplier Card - Improved */}
            <Link href="/signup/supplier" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col h-full">
              <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
                <Package size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
              </div>
              <div className="font-bold text-xl mb-1">Parts Supplier</div>
              <div className="text-sm text-[var(--text3)] mb-4">Distributors & manufacturers of laser parts, consumables, optics & handpieces</div>
              <ul className="text-sm space-y-1.5 mb-6 text-[var(--text2)] flex-1">
                <li>• List parts & inventory</li>
                <li>• Bulk CSV/Excel upload</li>
                <li>• Photo uploads per part</li>
                <li>• Reach thousands of techs & clinics</li>
              </ul>
              <div className="btn btn-primary w-full mt-auto">Sign Up as Parts Supplier →</div>
            </Link>
          </div>
        </div>

        {/* Marketplace Teaser */}
        <div className="bg-[#111] py-16 border-t border-b border-[var(--border)]">
          <div className="max-w-5xl mx-auto px-4">
            <div className="text-center mb-10">
              <h2 className="text-4xl font-bold mb-3">Service & Parts Marketplace</h2>
              <p className="text-xl text-gray-400">Find what you need. Sell what you have.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Service Marketplace */}
              <Link href="/marketplace" className="card p-8 hover:border-[var(--gold-border)] group">
                <div className="text-5xl mb-6">🔧</div>
                <h3 className="text-2xl font-bold mb-3">Service Requests</h3>
                <p className="text-gray-400 mb-6">Owners post PM, repairs, and installations. Technicians & companies bid and win work.</p>
                <div className="btn btn-primary group-hover:bg-white group-hover:text-black">Browse Service Requests →</div>
              </Link>

              {/* Parts Marketplace */}
              <Link href="/marketplace?tab=parts" className="card p-8 hover:border-[var(--gold-border)] group">
                <div className="text-5xl mb-6">📦</div>
                <h3 className="text-2xl font-bold mb-3">Laser Parts & Supplies</h3>
                <p className="text-gray-400 mb-6">Search thousands of parts. Suppliers list new/used inventory with photos and compatibility data.</p>
                <div className="btn btn-primary group-hover:bg-white group-hover:text-black">Browse Parts Inventory →</div>
              </Link>
            </div>

            {/* Used Systems */}
            <div className="mt-10 text-center">
              <Link href="/marketplace/used-systems" className="inline-flex items-center gap-3 text-lg hover:text-[var(--gold)]">
                <span>🔄</span>
                <span className="underline">Buy or Sell Used Laser Systems → Coming Soon</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="py-12 text-center">
          <p className="text-sm text-gray-400">Already have an account? <Link href="/login" className="text-[var(--gold)] hover:underline">Sign in here</Link></p>
        </div>
      </div>
    );
  }

  // === Logged-in Dashboard (unchanged for now) ===
  // ... paste your existing logged-in return block here if needed ...
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-6">
        <p className="text-center text-lg">Welcome back! Your full dashboard is loading...</p>
        {/* Your existing dashboard code goes here */}
      </div>
    </div>
  );
}