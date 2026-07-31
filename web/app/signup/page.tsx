'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Building2, Hospital, Package } from 'lucide-react';

export default function SignupIndex() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-7xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-10">
          <Link href="/" className="inline-block mb-2">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Join the Network</h1>
          <p className="text-[var(--text3)] mt-2 max-w-lg mx-auto">
            Sign up by organization type. FSE is a role inside an RSP org (not top-level).
            Laser clinics, rental companies, and resellers all use the owner product path (My Lasers + Marketplace needs).
          </p>
        </div>

        {/* Centered tile grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {/* Service Organization Card */}
          <Link href="/signup/company" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Building2 size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Repair Service Provider (RSP)</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              The organization that provides service (employs FSEs/techs etc.). Creates the org. First user is admin by default (changeable).
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Company name, address, website</li>
              <li>• Services offered (PM, Repair, Install...)</li>
              <li>• Add team members + roles (FSEs etc) during onboarding or via Team; sole props supported</li>
              <li>• Bid on service needs in Marketplace</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Create Service Organization →</div>
          </Link>

          {/* Laser owner family: clinic, rental, reseller */}
          <Link href="/signup/owner" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Hospital size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Laser Owner</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              Clinics, <strong>rental companies</strong>, and <strong>resellers</strong> who own or hold laser systems. Role: owner.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Clinic / medical practice</li>
              <li>• Laser rental company (fleet owner)</li>
              <li>• Laser reseller (inventory + marketplace listings)</li>
              <li>• My Lasers • Post service needs • Award bids</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as Laser Owner →</div>
          </Link>

          {/* Parts Supplier Card */}
          <Link href="/signup/supplier" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Package size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Parts Supplier</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              OEM or 3rd-party suppliers of laser parts and consumables. Role: parts_supplier.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• List parts, consumables, handpieces, and optics</li>
              <li>• Respond to service needs (beta)</li>
              <li>• Manage your supplier profile</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as Parts Supplier →</div>
          </Link>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-[var(--text3)]">
            Already registered? <Link href="/login" className="text-[var(--gold)] hover:underline">Sign in here</Link>
          </p>
        </div>

        <div className="mt-8 p-4 bg-[var(--surface3)] border border-[var(--border)] rounded-xl text-xs text-[var(--text3)]">
          <strong>Org model:</strong> RSP · Laser Owner (clinic / rental / reseller) · Parts Supplier.
          Rental and reseller are owner-side types (not service companies). FSE is a role inside an RSP.
        </div>
      </div>
    </div>
  );
}