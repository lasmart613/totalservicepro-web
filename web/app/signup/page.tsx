'use client';

import React from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { User, Building2, Hospital, Package } from 'lucide-react';

export default function SignupIndex() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-4xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-10">
          <Link href="/" className="inline-block mb-2">
            <span className="font-extrabold text-3xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Join the Network</h1>
          <p className="text-[var(--text3)] mt-2 max-w-md mx-auto">Professional sign-up for the laser service marketplace. Owners post needs. FSEs and companies fulfill them.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* FSE Card */}
          <Link href="/signup/fse" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <User size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Field Service Engineer (FSE)</div>
            <div className="text-sm text-[var(--text3)] mb-4">Independent techs and certified engineers. Role: fse / engineer</div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Certifications &amp; experience</li>
              <li>• Preferred regions</li>
              <li>• Bio &amp; LinkedIn / resume</li>
              <li>• Browse open needs &amp; submit bids (live in beta)</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as FSE →</div>
          </Link>

          {/* Company Card */}
          <Link href="/signup/company" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Building2 size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Service Company</div>
            <div className="text-sm text-[var(--text3)] mb-4">Teams &amp; businesses offering laser service. Creates organization. Role: company_admin (or service_manager)</div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Company name, address, website</li>
              <li>• Services offered (PM, Repair, Install...)</li>
              <li>• # of techs / business details</li>
              <li>• Manage team, bid on needs, accept contracts</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as Company →</div>
          </Link>

          {/* Owner Card */}
          <Link href="/signup/owner" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Hospital size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Laser Owner / Facility</div>
            <div className="text-sm text-[var(--text3)] mb-4">Hospitals, Med Spas, Clinics, Private Practices. Role: owner / customer. Creates customer org.</div>
            <ul className="text-sm space-y-1.5 mb-5 text-[var(--text2)]">
              <li>• Facility details &amp; contact</li>
              <li>• Laser systems &amp; models owned</li>
              <li>• Post service needs (PM / repair)</li>
              <li>• Marketplace access for bids</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as Owner →</div>
          </Link>

          {/* Parts Supplier Card */}
          <Link href="/signup/supplier" className="card p-6 hover:border-[var(--gold-border)] group flex flex-col min-w-0">
            <div className="w-12 h-12 rounded-xl bg-[var(--gold-glow)] flex items-center justify-center mb-4 group-hover:bg-[var(--gold)] transition-colors">
              <Package size={26} className="text-[var(--gold)] group-hover:text-[#111827]" />
            </div>
            <div className="font-bold text-xl mb-1">Parts Supplier</div>
            <div className="text-[13px] text-[var(--text3)] mb-4 break-words hyphens-auto break-all leading-tight">Suppliers of consumables, handpieces, optics. Creates organization. Role: parts_supplier</div>
            <ul className="text-[13px] space-y-1.5 mb-5 text-[var(--text2)] break-words break-all leading-tight">
              <li>• Consumables, handpieces, optics</li>
              <li>• Staff &amp; business details</li>
              <li>• List parts &amp; respond (beta)</li>
            </ul>
            <div className="btn btn-primary w-full text-center">Sign Up as Parts Supplier →</div>
          </Link>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm text-[var(--text3)]">Already registered? <Link href="/login" className="text-[var(--gold)] hover:underline">Sign in here</Link></p>
          <p className="text-xs mt-4 text-[var(--text3)]">All signups use Supabase auth + user_profiles. Organizations created for companies &amp; owners. Email confirmation may be required.</p>
        </div>

        <div className="mt-8 p-4 bg-[var(--surface3)] border border-[var(--border)] rounded-xl text-xs text-[var(--text3)]">
          <strong>Marketplace Vision - Bidding Live:</strong> Owners post contracts, emergency repairs, PM plans (to service_requests). FSEs/companies bid/respond (to bids table). Owners accept to award + auto-create service_contract. Full payments/notifications next. Try end-to-end with different role signups.
        </div>
      </div>
    </div>
  );
}
