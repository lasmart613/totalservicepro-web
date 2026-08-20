'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import './landing.css';

export function LandingSplash() {
  return (
    <div className="lp-splash">
      <div className="text-center">
        <div className="lp-brand-biz">RepairPlanet</div>
        <div className="lp-brand-name" style={{ fontSize: 28 }}>
          Total Service Pro
        </div>
        <div className="lp-brand-sub">Laser Equipment Service</div>
      </div>
    </div>
  );
}

function DashboardFrame() {
  return (
    <div className="lp-chrome" aria-hidden="true">
      <div className="lp-chrome-bar">
        <div>
          <div className="lp-chrome-mark">Total Service Pro</div>
          <div className="lp-chrome-sub">Laser Equipment Service</div>
        </div>
        <span className="text-xs text-[var(--text3)]">Tech dashboard</span>
      </div>
      <div className="lp-kpi-grid">
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--gold)' }}>
            12
          </div>
          <div className="lp-kpi-l">Open tickets</div>
        </div>
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--blue)' }}>
            4
          </div>
          <div className="lp-kpi-l">Today&apos;s calls</div>
        </div>
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--orange)' }}>
            7
          </div>
          <div className="lp-kpi-l">Repair requests</div>
        </div>
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--green)' }}>
            31
          </div>
          <div className="lp-kpi-l">Completed reports</div>
        </div>
      </div>
    </div>
  );
}

function OwnerFrame() {
  return (
    <div className="lp-chrome" aria-hidden="true">
      <div className="lp-chrome-bar">
        <div>
          <div className="lp-chrome-mark">My Lasers</div>
          <div className="lp-chrome-sub">Clinic · Rental · Reseller</div>
        </div>
      </div>
      <div className="lp-kpi-grid">
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--gold)' }}>
            8
          </div>
          <div className="lp-kpi-l">My lasers</div>
        </div>
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--blue)' }}>
            2
          </div>
          <div className="lp-kpi-l">Open requests</div>
        </div>
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--green)' }}>
            19
          </div>
          <div className="lp-kpi-l">Service history</div>
        </div>
        <div className="lp-kpi">
          <div className="lp-kpi-n" style={{ color: 'var(--purple)' }}>
            5
          </div>
          <div className="lp-kpi-l">Bids received</div>
        </div>
      </div>
    </div>
  );
}

function ReportFrame() {
  return (
    <div className="lp-chrome lp-report" aria-hidden="true">
      <div className="lp-report-top">
        <div>
          <h3>Service Report SR-1042</h3>
          <div className="text-xs text-[var(--text3)] mt-1">
            Email on file: clinic@example.com
          </div>
        </div>
        <div className="flex gap-2">
          <span className="lp-btn lp-btn-ghost" style={{ padding: '8px 12px', fontSize: 10 }}>
            Print / PDF
          </span>
          <span className="lp-btn lp-btn-primary" style={{ padding: '8px 12px', fontSize: 10 }}>
            Email report
          </span>
        </div>
      </div>
      <div className="text-sm text-[var(--text2)]">
        Candela GentleMax Pro · serial GM-88421 · PM complete
      </div>
    </div>
  );
}

function ManualsFrame() {
  return (
    <div className="lp-shelf" aria-hidden="true">
      <div className="lp-books">
        <div className="lp-book">Lumenis UltraPulse</div>
        <div className="lp-book">Candela Vbeam</div>
        <div className="lp-book">Sciton Joule</div>
        <div className="lp-book">Cynosure Picosure</div>
        <div className="lp-book">Rohrer Spectrum</div>
        <div className="lp-book">Iridex OcuLight</div>
        <div className="lp-book">Coherent VersaPulse</div>
      </div>
      <div className="lp-ledge" />
    </div>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('landing-mode');
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.documentElement.classList.remove('landing-mode');
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="lp-root -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      <header className={`lp-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <Link href="/" className="lp-brand">
          <span className="lp-brand-biz">RepairPlanet</span>
          <span className="lp-brand-name">Total Service Pro</span>
          <span className="lp-brand-sub">Laser Equipment Service</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Landing">
          <a href="#service">Service</a>
          <a href="#owners">Owners</a>
          <Link href="/marketplace">Marketplace</Link>
          <a href="#app">App</a>
          <Link href="/directory">Directory</Link>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign In
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Get Started
          </Link>
        </div>
      </header>

      <section className="lp-hero" aria-label="Hero">
        <div className="lp-field" aria-hidden="true">
          <div className="lp-grid" />
          <div className="lp-beam lp-beam-a" />
          <div className="lp-beam lp-beam-b" />
          <div className="lp-beam lp-beam-c" />
          <div className="lp-pulse" />
        </div>
        <div className="lp-stage" aria-hidden="true">
          <div className="lp-device">
            <img src="/landing/signup.webp" alt="" width={960} height={600} />
          </div>
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">RepairPlanet</p>
          <h1 className="lp-title">
            Total
            <br />
            Service Pro
          </h1>
          <p className="lp-lede">
            Laser Equipment Service. The professional platform for laser
            equipment service, parts, and marketplace — on the web and in the
            technician field app.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Enter the portal
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign In
            </Link>
          </div>
        </div>
        <div className="lp-scroll-hint">Scroll</div>
      </section>

      <section className="lp-chapter" id="service">
        <div className="lp-stage" aria-hidden="true">
          <DashboardFrame />
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Repair service providers</p>
          <h2 className="lp-title lp-title-sm">
            Keep every
            <br />
            laser on the road.
          </h2>
          <p className="lp-lede">
            RSPs run the shop from one portal: service schedule and tickets,
            today&apos;s calls, FSE performance, customers, estimates, invoices,
            test equipment, and the Tech Hub — photometry tools, AI assistant,
            and a parts catalog.
          </p>
          <div className="lp-actions">
            <Link href="/signup/company" className="lp-btn lp-btn-primary">
              Create a service organization
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter" id="owners">
        <div className="lp-stage" aria-hidden="true">
          <OwnerFrame />
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Clinics · rental · resellers</p>
          <h2 className="lp-title lp-title-sm">
            Own the fleet.
            <br />
            Post the need.
          </h2>
          <p className="lp-lede">
            Laser clinics, rental companies, and resellers share the owner path:
            My Lasers, service requests and RFQs, award bids, and a service
            history on every system. FSE is a role inside an RSP — not a
            separate signup.
          </p>
          <div className="lp-actions">
            <Link href="/signup/owner" className="lp-btn lp-btn-primary">
              Sign up as laser owner
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter" id="marketplace">
        <div className="lp-media" aria-hidden="true">
          <video
            autoPlay
            muted
            loop
            playsInline
            poster="/landing/marketplace.webp"
          >
            <source src="/landing/marketplace-loop.mp4" type="video/mp4" />
          </video>
          <div className="lp-media-dim" />
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Marketplace</p>
          <h2 className="lp-title lp-title-sm">
            Parts. Systems.
            <br />
            Consumables. Jobs.
          </h2>
          <p className="lp-lede">
            Buy and sell parts, used laser systems, and consumables — handpieces,
            fibers, tips. Owners post repair and PM requests; RSPs bid. Suppliers
            list catalog items. Only actively listed inventory appears.
          </p>
          <div className="lp-actions">
            <Link href="/marketplace" className="lp-btn lp-btn-primary">
              Open marketplace
            </Link>
            <Link href="/signup/supplier" className="lp-btn lp-btn-ghost">
              Sign up as supplier
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter" id="reports">
        <div className="lp-stage" aria-hidden="true">
          <div className="space-y-4">
            <ReportFrame />
            <div className="lp-device">
              <img src="/landing/app-reports.webp" alt="" width={390} height={844} />
            </div>
          </div>
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Service reports</p>
          <h2 className="lp-title lp-title-sm">
            Write it.
            <br />
            Email it.
          </h2>
          <p className="lp-lede">
            Performance and safety documentation with Print / PDF and Email
            report — sent to the CRM org email, primary contact, or the email on
            the job. Owners see completed history on their systems.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Get Started
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter" id="manuals">
        <div className="lp-stage lp-stage-flat" aria-hidden="true">
          <ManualsFrame />
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Manuals library</p>
          <h2 className="lp-title lp-title-sm">
            The bookshelf
            <br />
            in the truck.
          </h2>
          <p className="lp-lede">
            A digital service-manual library with wavelength filters — 532 KTP,
            755 Alexandrite, 1064 Nd:YAG, 10,600 CO₂, pulsed dye, multi-WL —
            for Candela, Lumenis, Sciton, Cynosure, and the rest of the bench.
          </p>
        </div>
      </section>

      <section className="lp-chapter" id="app">
        <div className="lp-stage lp-stage-flat" aria-hidden="true">
          <div className="lp-phone-wrap">
            <div className="lp-phone">
              <img src="/landing/app-hub.webp" alt="" width={390} height={844} />
            </div>
            <div className="lp-phone">
              <img src="/landing/app-calcs.webp" alt="" width={390} height={844} />
            </div>
          </div>
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Android field app</p>
          <h2 className="lp-title lp-title-sm">
            Same portal.
            <br />
            In the field.
          </h2>
          <p className="lp-lede">
            The technician app shares the TSP account: Service Hub, schedule,
            customers, parts catalog, manuals, AI assistant, service reports,
            and Photometry Tools — fluence, irradiance, duty cycle, VBeam
            wavelength, and average power.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Enter the portal
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter" id="directory">
        <div className="lp-media" aria-hidden="true">
          <img src="/landing/directory.webp" alt="" />
          <div className="lp-media-dim" />
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">TSP Directory</p>
          <h2 className="lp-title lp-title-sm">
            Find the
            <br />
            network.
          </h2>
          <p className="lp-lede">
            Free opt-in listings for service companies, clinics, resellers,
            rental companies, and parts suppliers. Search by name, city, or
            state. Enable it from Company Profile.
          </p>
          <div className="lp-actions">
            <Link href="/directory" className="lp-btn lp-btn-primary">
              Browse directory
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter lp-join" id="join">
        <div className="lp-media" aria-hidden="true">
          <video autoPlay muted loop playsInline poster="/landing/signup.webp">
            <source src="/landing/signup-loop.mp4" type="video/mp4" />
          </video>
          <div className="lp-media-dim lp-media-dim-center" />
        </div>
        <div className="lp-copy">
          <p className="lp-kicker">Join the network</p>
          <h2 className="lp-title lp-title-sm">Choose your path.</h2>
          <p className="lp-lede">
            Sign up by organization type. Same Total Service Pro portal you
            already enter from Sign In.
          </p>
          <div className="lp-paths">
            <Link href="/signup/company" className="lp-path">
              <p className="lp-kicker">RSP</p>
              <h3>Repair Service Provider</h3>
              <p>
                The organization that provides service. First user is admin.
                Invite FSEs and techs from Team.
              </p>
              <ul>
                <li>Schedule, tickets, estimates, invoices</li>
                <li>Bid on marketplace repair jobs</li>
                <li>Manuals, reports, photometry tools</li>
              </ul>
              <span className="lp-btn lp-btn-primary">Create service organization</span>
            </Link>
            <Link href="/signup/owner" className="lp-path">
              <p className="lp-kicker">Owner</p>
              <h3>Clinic, rental, reseller</h3>
              <p>
                Facilities and fleet holders. Role: owner. My Lasers plus
                marketplace needs.
              </p>
              <ul>
                <li>Clinic / medical practice</li>
                <li>Laser rental company</li>
                <li>Reseller inventory + listings</li>
              </ul>
              <span className="lp-btn lp-btn-primary">Sign up as laser owner</span>
            </Link>
            <Link href="/signup/supplier" className="lp-path">
              <p className="lp-kicker">Supplier</p>
              <h3>Parts supplier</h3>
              <p>
                OEM or third-party parts and consumables. Role: parts_supplier.
              </p>
              <ul>
                <li>List parts, handpieces, optics</li>
                <li>Respond to open demand</li>
                <li>Manage supplier profile</li>
              </ul>
              <span className="lp-btn lp-btn-primary">Sign up as parts supplier</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <strong style={{ color: 'var(--gold)' }}>RepairPlanet</strong>
          {' · '}
          Total Service Pro
          {' · '}
          Laser Equipment Service
        </div>
        <div className="lp-footer-links">
          <Link href="/login">Sign In</Link>
          <Link href="/signup">Sign Up</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/directory">Directory</Link>
          <Link href="/forgot-password">Forgot password</Link>
        </div>
      </footer>
    </div>
  );
}
