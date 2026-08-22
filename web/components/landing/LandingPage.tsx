'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import './landing.css';

export function LandingSplash() {
  return (
    <div className="lp-splash">
      <div className="text-center">
        <div className="lp-brand-biz">Medical Repair Network</div>
        <div className="lp-brand-name" style={{ fontSize: 28 }}>
          Total Service Pro
        </div>
        <div className="lp-brand-sub">Laser Equipment Service</div>
      </div>
    </div>
  );
}

function Shot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="lp-shot">
      <img src={src} alt={alt} width={1400} height={900} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('landing-mode');
    const onScroll = () => setScrolled(window.scrollY > 12);
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
          <span className="lp-brand-biz">Medical Repair Network</span>
          <span className="lp-brand-name">Total Service Pro</span>
          <span className="lp-brand-sub">Laser Equipment Service</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Public">
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/marketplace/parts">Parts</Link>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Register for Total Service Pro
          </Link>
        </div>
      </header>

      <section className="lp-hero" aria-label="Hero">
        <div className="lp-hero-copy">
          <p className="lp-kicker">Medical Repair Network</p>
          <h1 className="lp-title">Total Service Pro</h1>
          <p className="lp-lede">
            Software for shops and clinics that keep aesthetic and medical
            lasers running.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign in
            </Link>
          </div>
        </div>
        <Shot
          src="/landing/dashboard.webp"
          alt="Total Service Pro shop dashboard with open tickets and upcoming calls"
          caption="Shop dashboard"
        />
      </section>

      <section className="lp-gallery" aria-label="Product screens">
        <Shot
          src="/landing/parts.webp"
          alt="Parts marketplace with live Candela listings and prices"
          caption="Parts for sale"
        />
        <Shot
          src="/landing/reports.webp"
          alt="Service reports list with drafts and completed work"
          caption="Service reports"
        />
        <Shot
          src="/landing/signup.webp"
          alt="Register chooser for repair company, clinic, and parts seller"
          caption="Register"
        />
        <Shot
          src="/landing/marketplace.webp"
          alt="Marketplace home for parts, used systems, and consumables"
          caption="Marketplace"
        />
      </section>

      <section className="lp-section" id="features">
        <h2 className="lp-h2">What you get</h2>
        <ul className="lp-features">
          <li>Schedule and tickets</li>
          <li>Estimates and invoices</li>
          <li>Service reports you can email</li>
          <li>Parts listed for sale</li>
          <li>Manuals and photometry tools</li>
          <li>Directory of shops and clinics</li>
        </ul>

        <div className="lp-expanders">
          <details>
            <summary>Repair companies</summary>
            <p>
              Dispatch the next call. Write the estimate on the same job. Email
              the report. Invite technicians from Team.
            </p>
          </details>
          <details>
            <summary>Clinics and rental fleets</summary>
            <p>
              Every laser and serial in one list. Post a repair or preventive
              visit and take bids. History stays with the machine.
            </p>
          </details>
          <details>
            <summary>Parts sellers</summary>
            <p>
              List parts, handpieces, optics, and consumables. Public product
              pages with checkout. See open demand and respond.
            </p>
          </details>
        </div>
      </section>

      <section className="lp-section lp-phones" id="app">
        <div>
          <h2 className="lp-h2">On the phone too</h2>
          <p className="lp-lede">
            Same Total Service Pro account on Android. Schedule, parts, manuals,
            and reports in the van.
          </p>
        </div>
        <div className="lp-phone-wrap">
          <div className="lp-phone">
            <img src="/landing/app-hub.webp" alt="Android Service Hub" width={390} height={844} />
          </div>
          <div className="lp-phone">
            <img src="/landing/app-calcs.webp" alt="Photometry tools on Android" width={390} height={844} />
          </div>
        </div>
      </section>

      <section className="lp-section" id="join">
        <h2 className="lp-h2">Register for Total Service Pro</h2>
        <p className="lp-lede">
          Repair company, clinic, or parts seller. Technicians are invited by
          their shop.
        </p>
        <div className="lp-paths">
          <Link href="/signup/company" className="lp-path">
            <h3>Repair company</h3>
            <ul>
              <li>Schedule and tickets</li>
              <li>Estimates and invoices</li>
              <li>Reports and manuals</li>
            </ul>
            <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
          </Link>
          <Link href="/signup/owner" className="lp-path">
            <h3>Clinic / laser owner</h3>
            <ul>
              <li>Lasers by serial</li>
              <li>Post a repair and take bids</li>
              <li>Service history on the machine</li>
            </ul>
            <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
          </Link>
          <Link href="/signup/supplier" className="lp-path">
            <h3>Parts seller</h3>
            <ul>
              <li>List parts and consumables</li>
              <li>Public pages with checkout</li>
              <li>Respond to open demand</li>
            </ul>
            <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
          </Link>
        </div>
        <div className="lp-actions" style={{ marginTop: 28 }}>
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Already registered? Sign in
          </Link>
          <Link href="/directory" className="lp-btn lp-btn-ghost">
            Directory
          </Link>
        </div>
      </section>

      <footer className="lp-footer">
        <div>
          <strong style={{ color: '#FBBF24' }}>Medical Repair Network</strong>
          {' · '}
          Total Service Pro
        </div>
        <div className="lp-footer-links">
          <Link href="/">Home</Link>
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/marketplace/parts">Parts</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Register for Total Service Pro</Link>
          <Link href="/forgot-password">Forgot password</Link>
        </div>
      </footer>
    </div>
  );
}
