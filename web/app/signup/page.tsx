'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Building2, Hospital, Package } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { prepareFreshSignup } from '@/lib/auth-session';

export default function SignupIndex() {
  useEffect(() => {
    prepareFreshSignup(getSupabaseClient());
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-10">
          <Link href="/" className="inline-block mb-2">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Register for Total Service Pro</h1>
          <p className="text-[var(--text3)] mt-2 max-w-lg mx-auto">
            Pick how you work. Repair companies, clinics and laser owners (including
            rental fleets), and parts sellers each get their own door. Technicians
            are invited by their shop — they do not register alone.
          </p>
        </div>

        {/* Centered tile grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {/* Service Organization Card */}
          <Link href="/signup/company" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Building2 size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Service company / repair company</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              Independent techs and shops that service aesthetic and medical lasers.
              First user is admin. Invite technicians from Team.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Dispatch and schedule without a whiteboard</li>
              <li>• Estimates and invoices on the same customer</li>
              <li>• Bid on clinic repair work when it is posted</li>
              <li>• Manuals, reports, and photometry tools for the tech</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Register for Total Service Pro →</div>
          </Link>

          {/* Laser owner family: clinic, rental, reseller */}
          <Link href="/signup/owner" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Hospital size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Clinic / laser owner</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              Med spas, practices, and rental fleets that own or hold the machines.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Every laser and serial in one list</li>
              <li>• Post a repair or preventive visit and take bids</li>
              <li>• Service history that stays with the machine</li>
              <li>• Rental fleets: which box is out, and its last service</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Register for Total Service Pro →</div>
          </Link>

          {/* Parts Supplier Card */}
          <Link href="/signup/supplier" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Package size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Parts seller</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              OEM or third-party parts and consumables for the installed base.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• List parts, handpieces, optics, and consumables</li>
              <li>• Public product pages with checkout</li>
              <li>• See open demand and respond</li>
              <li>• A supplier profile techs can actually find</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Register for Total Service Pro →</div>
          </Link>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-[var(--text3)]">
            Already registered? <Link href="/login" className="text-[var(--gold)] hover:underline">Sign in here</Link>
          </p>
        </div>

        <div className="mt-8 p-4 bg-[var(--surface3)] border border-[var(--border)] rounded-xl text-xs text-[var(--text3)]">
          Repair company · Clinic / laser owner (including rental fleets) · Parts seller.
          Technicians join through their shop.
        </div>
      </div>
    </div>
  );
}