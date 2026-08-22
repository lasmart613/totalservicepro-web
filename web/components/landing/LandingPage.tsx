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

const AUDIENCES: {
  id: 'shop' | 'clinic' | 'parts';
  label: string;
  signup: string;
  lines: string[];
  shot: { src: string; alt: string; caption: string };
}[] = [
  {
    id: 'shop',
    label: 'Laser repair companies',
    signup: '/signup/company',
    lines: [
      'Run the schedule',
      'Dispatch the engineer',
      'History on every job',
      'Manuals in one place',
      'Bid on open requests',
    ],
    shot: {
      src: '/landing/dashboard.webp',
      alt: 'Total Service Pro shop dashboard with open tickets and upcoming calls',
      caption: 'Shop dashboard',
    },
  },
  {
    id: 'clinic',
    label: 'Medical / aesthetic clinics',
    signup: '/signup/owner',
    lines: [
      'Find the best shop',
      'Take competing bids',
      'History and cost on every serial',
    ],
    shot: {
      src: '/landing/reports.webp',
      alt: 'Service reports list with drafts and completed work',
      caption: 'Service history',
    },
  },
  {
    id: 'parts',
    label: 'Parts suppliers',
    signup: '/signup/supplier',
    lines: [
      'Reach shops and owners',
      'Get found when they need a part',
      'List what is on the shelf',
    ],
    shot: {
      src: '/landing/parts.webp',
      alt: 'Parts marketplace with live Candela listings and prices',
      caption: 'Parts for sale',
    },
  },
];

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
          <p className="lp-kicker">Medical Repair Network · Total Service Pro</p>
          <h1 className="lp-title">Reduce laser downtime</h1>
          <p className="lp-lede">Maximize your equipment’s uptime.</p>
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
        <p className="lp-lede">Repair shop, clinic, or parts seller.</p>
        <div className="lp-role-cols">
          {AUDIENCES.map((r) => (
            <article key={r.id} className="lp-role-col">
              <h3>{r.label}</h3>
              <ul className="lp-features">
                {r.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Shot
                src={r.shot.src}
                alt={r.shot.alt}
                caption={r.shot.caption}
              />
              <div className="lp-actions">
                <Link href={r.signup} className="lp-btn lp-btn-primary">
                  Register for Total Service Pro
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-phones" id="app">
        <div>
          <h2 className="lp-h2">Same account in the van</h2>
          <p className="lp-lede">Schedule, parts, manuals, and reports on Android.</p>
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
        <p className="lp-lede">Repair company, clinic, rental fleet, or parts seller.</p>
        <div className="lp-paths">
          <Link href="/signup/company" className="lp-path">
            <h3>Repair company</h3>
            <ul>
              <li>Cut the next call’s downtime</li>
              <li>Estimate and invoice the same job</li>
              <li>Email the report from the van</li>
            </ul>
            <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
          </Link>
          <Link href="/signup/owner" className="lp-path">
            <h3>Clinic / owner</h3>
            <ul>
              <li>Maximize uptime on every box</li>
              <li>Post a repair and take bids</li>
              <li>History stays with the serial</li>
            </ul>
            <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
          </Link>
          <Link href="/signup/supplier" className="lp-path">
            <h3>Parts seller</h3>
            <ul>
              <li>List what is on the shelf</li>
              <li>Public pages with checkout</li>
              <li>Answer demand while it is open</li>
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
