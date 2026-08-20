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

function Shot({ src, alt = '' }: { src: string; alt?: string }) {
  return (
    <div className="lp-device">
      <img src={src} alt={alt} width={1400} height={1100} />
    </div>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const navRef = React.useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('landing-mode');

    const applyNavOffset = () => {
      const h = navRef.current?.getBoundingClientRect().height ?? 0;
      const navH = Math.max(Math.ceil(h), 76);
      const offset = navH + 48;
      document.documentElement.style.setProperty('--lp-nav-height', `${navH}px`);
      document.documentElement.style.setProperty('--lp-nav-offset', `${offset}px`);
    };

    const hideTitlesUnderNav = () => {
      const navBottom = navRef.current?.getBoundingClientRect().bottom ?? 0;
      document.querySelectorAll<HTMLElement>('.lp-heading').forEach((el) => {
        const top = el.getBoundingClientRect().top;
        el.style.visibility = top + 1 < navBottom ? 'hidden' : 'visible';
      });
    };

    applyNavOffset();
    hideTitlesUnderNav();
    const ro = navRef.current ? new ResizeObserver(applyNavOffset) : null;
    if (navRef.current && ro) ro.observe(navRef.current);

    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      hideTitlesUnderNav();
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', applyNavOffset);
    return () => {
      document.documentElement.classList.remove('landing-mode');
      document.documentElement.style.removeProperty('--lp-nav-height');
      document.documentElement.style.removeProperty('--lp-nav-offset');
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', applyNavOffset);
    };
  }, []);

  return (
    <div className="lp-root -mx-4 sm:-mx-6 lg:-mx-8 -my-6">
      <header ref={navRef} className={`lp-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <Link href="/" className="lp-brand">
          <span className="lp-brand-biz">RepairPlanet</span>
          <span className="lp-brand-name">Total Service Pro</span>
          <span className="lp-brand-sub">Laser Equipment Service</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Public">
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign In
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Sign Up
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
          <Shot src="/landing/signup.webp" alt="" />
        </div>
        <div className="lp-copy">
          <div className="lp-heading">
            <p className="lp-kicker">RepairPlanet</p>
            <h1 className="lp-title">
              Total
              <br />
              Service Pro
            </h1>
          </div>
          <p className="lp-lede">
            Laser Equipment Service. The professional platform for laser
            equipment service, parts, and marketplace — on the web and in the
            technician field app.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Sign Up
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign In
            </Link>
          </div>
        </div>
        <div className="lp-scroll-hint">Scroll</div>
      </section>

      <section className="lp-chapter" id="signup">
        <div className="lp-stage" aria-hidden="true">
          <Shot src="/landing/signup.webp" alt="" />
        </div>
        <div className="lp-copy">
          <div className="lp-heading">
            <p className="lp-kicker">Join the network</p>
            <h2 className="lp-title lp-title-sm">
              One portal.
              <br />
              Three doors.
            </h2>
          </div>
          <p className="lp-lede">
            Sign up as a Repair Service Provider, laser owner (clinic, rental
            company, or reseller), or parts supplier. FSEs are invited by their
            RSP — there is no separate technician signup.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Sign Up
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter" id="service">
        <div className="lp-stage" aria-hidden="true">
          <Shot src="/landing/login.webp" alt="" />
        </div>
        <div className="lp-copy">
          <div className="lp-heading">
            <p className="lp-kicker">Website + field app</p>
            <h2 className="lp-title lp-title-sm">
              Service the
              <br />
              installed base.
            </h2>
          </div>
          <p className="lp-lede">
            RSPs run schedule and tickets, customers, estimates, invoices, test
            equipment, manuals, and service reports — including Email report.
            Owners post RFQs from My Lasers. Same account on the Android
            technician app: Service Hub plus Photometry Tools (fluence,
            irradiance, duty cycle, VBeam wavelength, average power).
          </p>
          <div className="lp-actions">
            <Link href="/login" className="lp-btn lp-btn-primary">
              Sign In
            </Link>
            <Link href="/signup" className="lp-btn lp-btn-ghost">
              Sign Up
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
          <div className="lp-heading">
            <p className="lp-kicker">Marketplace</p>
            <h2 className="lp-title lp-title-sm">
              Parts. Systems.
              <br />
              Consumables. Jobs.
            </h2>
          </div>
          <p className="lp-lede">
            Buy and sell parts, used laser systems, and consumables. Owners post
            repair and PM requests; RSPs bid. Only actively listed inventory
            appears. The full parts catalog lives in the Tech Hub after Sign In.
          </p>
          <div className="lp-actions">
            <Link href="/marketplace" className="lp-btn lp-btn-primary">
              Marketplace
            </Link>
            <Link href="/signup" className="lp-btn lp-btn-ghost">
              Sign Up
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
          <div className="lp-heading">
            <p className="lp-kicker">TSP Directory</p>
            <h2 className="lp-title lp-title-sm">
              Find the
              <br />
              network.
            </h2>
          </div>
          <p className="lp-lede">
            Free opt-in listings for service companies, clinics, resellers,
            rental companies, and parts suppliers. Search by name, city, or
            state.
          </p>
          <div className="lp-actions">
            <Link href="/directory" className="lp-btn lp-btn-primary">
              Directory
            </Link>
          </div>
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
          <div className="lp-heading">
            <p className="lp-kicker">Android field app</p>
            <h2 className="lp-title lp-title-sm">
              Same portal.
              <br />
              In the field.
            </h2>
          </div>
          <p className="lp-lede">
            The technician app shares the TSP account: Service Hub, schedule,
            customers, parts catalog, manuals, AI assistant, service reports,
            and Photometry Tools.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Sign Up
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign In
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-chapter lp-join" id="join">
        <div className="lp-media" aria-hidden="true">
          <img src="/landing/signup.webp" alt="" />
          <div className="lp-media-dim lp-media-dim-center" />
        </div>
        <div className="lp-copy">
          <div className="lp-heading">
            <p className="lp-kicker">Total Service Pro</p>
            <h2 className="lp-title lp-title-sm">Sign Up or Sign In.</h2>
          </div>
          <p className="lp-lede">
            Same Total Service Pro routes already on repairplanet.net. No new
            auth path.
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
              <span className="lp-btn lp-btn-primary">Sign Up</span>
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
              <span className="lp-btn lp-btn-primary">Sign Up</span>
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
              <span className="lp-btn lp-btn-primary">Sign Up</span>
            </Link>
          </div>
          <div className="lp-actions" style={{ marginTop: 28 }}>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Already registered? Sign In
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <strong style={{ color: '#FBBF24' }}>RepairPlanet</strong>
          {' · '}
          Total Service Pro
          {' · '}
          Laser Equipment Service
        </div>
        <div className="lp-footer-links">
          <Link href="/">Home</Link>
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/login">Sign In</Link>
          <Link href="/signup">Sign Up</Link>
          <Link href="/forgot-password">Forgot password</Link>
        </div>
      </footer>
    </div>
  );
}
