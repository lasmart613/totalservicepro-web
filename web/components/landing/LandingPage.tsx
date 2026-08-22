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
            Sign In
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Register for Total Service Pro
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
            <p className="lp-kicker">Medical Repair Network</p>
            <h1 className="lp-title">
              Total
              <br />
              Service Pro
            </h1>
          </div>
          <p className="lp-lede">
            When a medical or aesthetic laser goes down, the clinic loses
            days and the tech is hunting a handpiece from a text thread.
            Total Service Pro is the app Medical Repair Network sells so
            repair companies, laser owners, and parts sellers run that work
            in one place.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
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
            <p className="lp-kicker">Who it is for</p>
            <h2 className="lp-title lp-title-sm">
              Three desks.
              <br />
              One mess.
            </h2>
          </div>
          <p className="lp-lede">
            Repair companies chase paper tickets. Clinics wait on a laser that
            prints money. Parts sellers get “do you have this?” after hours.
            Register for Total Service Pro if that is your week. Technicians
            are invited by their shop — they do not sign up alone.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
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
            <p className="lp-kicker">The daily work</p>
            <h2 className="lp-title lp-title-sm">
              Keep the laser
              <br />
              on the floor.
            </h2>
          </div>
          <p className="lp-lede">
            Total Service Pro is the product you register for. Medical Repair
            Network is the company that sells it. Same login on the website and
            on the phone in the van.
          </p>
          <ul className="lp-benefits">
            <li>Dispatch the next call and write the estimate on the same job</li>
            <li>Email the service report instead of photographing a paper form</li>
            <li>Manuals and photometry tools in the van — fluence, irradiance, duty cycle</li>
            <li>History stays with the serial number, not a pile of PDFs</li>
          </ul>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign In
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
              Parts that are
              <br />
              actually for sale.
            </h2>
          </div>
          <p className="lp-lede">
            Need a fiber before Friday? A used system? A handpiece? Clinics post
            the need. Repair companies bid the job. Suppliers list what is on
            the shelf — not a wish-book catalog.
          </p>
          <ul className="lp-benefits">
            <li>Live parts pages you can buy</li>
            <li>Used aesthetic and medical laser systems</li>
            <li>Consumables: tips, fibers, gels, handpieces</li>
            <li>Open repair jobs, not ghost listings</li>
          </ul>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
            </Link>
            <Link href="/marketplace/parts" className="lp-btn lp-btn-ghost">
              Browse Parts
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
            <p className="lp-kicker">Directory</p>
            <h2 className="lp-title lp-title-sm">
              Find who works
              <br />
              on these machines.
            </h2>
          </div>
          <p className="lp-lede">
            Free listings for repair companies, clinics, rental fleets, and
            parts suppliers. Search by name, city, or state — then call someone
            who actually services the brand on the floor.
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
            <p className="lp-kicker">Phone in the van</p>
            <h2 className="lp-title lp-title-sm">
              The van is
              <br />
              the office.
            </h2>
          </div>
          <p className="lp-lede">
            The Android app uses the same Total Service Pro account. No second
            login, no leftover paperwork in the cup holder.
          </p>
          <ul className="lp-benefits">
            <li>Today’s schedule and the customer on the call</li>
            <li>Parts, manuals, and the last service report</li>
            <li>Photometry tools you already use on a preventive visit</li>
          </ul>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Register for Total Service Pro
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
            <p className="lp-kicker">Register</p>
            <h2 className="lp-title lp-title-sm">Register for Total Service Pro.</h2>
          </div>
          <p className="lp-lede">
            Pick the desk you sit at. Same app. Different mess.
          </p>
          <div className="lp-paths">
            <Link href="/signup/company" className="lp-path">
              <p className="lp-kicker">Repair company</p>
              <h3>Service companies and independent techs</h3>
              <p>
                You book calls from a group text, write reports at midnight, and
                hear about jobs after someone else already quoted them.
              </p>
              <ul>
                <li>Dispatch and schedule without a whiteboard</li>
                <li>Estimates and invoices on the same customer</li>
                <li>Bid on clinic repair work when it is posted</li>
                <li>Manuals, reports, and photometry tools for the tech</li>
                <li>Invite your technicians from Team</li>
              </ul>
              <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
            </Link>
            <Link href="/signup/owner" className="lp-path">
              <p className="lp-kicker">Clinic</p>
              <h3>Laser owners, med spas, and rental fleets</h3>
              <p>
                The laser is down, the calendar is full, and you cannot tell who
                last touched it or what they charged.
              </p>
              <ul>
                <li>Every laser and serial in one list</li>
                <li>Post a repair or preventive visit and take bids</li>
                <li>Service history that stays with the machine</li>
                <li>Rental fleets: which box is out, and its last service</li>
              </ul>
              <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
            </Link>
            <Link href="/signup/supplier" className="lp-path">
              <p className="lp-kicker">Parts</p>
              <h3>Parts and consumables sellers</h3>
              <p>
                Techs call asking if you still have a part you listed months
                ago. Clinics buy from whoever answers first.
              </p>
              <ul>
                <li>List parts, handpieces, optics, and consumables</li>
                <li>Public product pages with checkout</li>
                <li>See open demand and respond</li>
                <li>A supplier profile techs can actually find</li>
              </ul>
              <span className="lp-btn lp-btn-primary">Register for Total Service Pro</span>
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
          <strong style={{ color: '#FBBF24' }}>Medical Repair Network</strong>
          {' · '}
          Total Service Pro
          {' · '}
          the service you register for
        </div>
        <div className="lp-footer-links">
          <Link href="/">Home</Link>
          <Link href="/directory">Directory</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/marketplace/parts">Parts</Link>
          <Link href="/login">Sign In</Link>
          <Link href="/signup">Register for Total Service Pro</Link>
          <Link href="/forgot-password">Forgot password</Link>
        </div>
      </footer>
    </div>
  );
}
