'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Building2, Hospital, Package } from 'lucide-react';

export default function SignupIndex() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-5xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-10">
          <Link href="/" className="inline-block mb-2">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Join the Network</h1>
          <p className="text-[var(--text3)] mt-2 max-w-md mx-auto">
            Sign up by organization type. FSEs (Field Service Engineers) cannot sign up directly. 
            They must be added by a Service Organization through the Team section after the organization is created.
          </p>
        </div>

        {/* Centered 3-tile grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* Service Organization Card */}
          <Link href="/company" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Building2 size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Service Organization</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              Employs Service Engineers. Creates the organization. First user becomes admin.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Company name, address, website</li>
              <li>• Services offered (PM, Repair, Install...)</li>
              <li>• Add FSEs and team members later via Team page</li>
              <li>• Bid on service needs in Marketplace</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Create Service Organization →</div>
          </Link>

          {/* Laser Clinic / Owner Card */}
          <Link href="/signup/owner" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Hospital size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Laser Clinic / Medical Practice</div>
            <div className="text-sm text-[var(--text3)] mb-4">
              Hospitals, Med Spas, Clinics &amp; Private Practices. Role: owner.
            </div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Facility details &amp; contact info</li>
              <li>• Add your laser systems (with serial numbers)</li>
              <li>• Post service needs in Marketplace</li>
              <li>• Receive and award bids from Service Organizations</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as Owner →</div>
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
          <strong>Important:</strong> FSEs (Field Service Engineers) are added by Service Organizations 
          through the <strong>Team</strong> section after the organization is created. 
          There is no individual FSE self-signup.
        </div>
      </div>
    </div>
  );
}