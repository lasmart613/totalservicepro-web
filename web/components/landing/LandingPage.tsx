'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { LandingShell } from './LandingShell';
import { plansHrefForAudience, type PlanAudience } from '@/lib/billing/plan-tiles';
import './landing.css';

const LANDING_PLAN_ROLE: Record<'shop' | 'clinic' | 'parts', PlanAudience> = {
  shop: 'company',
  clinic: 'owner',
  parts: 'supplier',
};

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
    label: 'Repair companies',
    signup: '/signup/company',
    lines: [
      'Schedule and Assign Service Calls',
      'View service history on every job',
      'Keep service manuals in one place',
      'Bid on open service requests',
    ],
    shot: {
      src: '/landing/dashboard.webp',
      alt: 'Total Service Pro dashboard with open tickets and upcoming calls',
      caption: 'Dashboard',
    },
  },
  {
    id: 'clinic',
    label: 'Laser Owner',
    signup: '/signup/owner',
    lines: [
      'Find a Repair Company',
      'Shop around for the best price and the right shop.',
      'View service history and track maintenance costs',
    ],
    shot: {
      src: '/landing/reports.webp',
      alt: 'Service reports list with drafts and completed work',
      caption: 'Service history',
    },
  },
  {
    id: 'parts',
    label: 'Parts sellers',
    signup: '/signup/supplier',
    lines: [
      'Connect with Repair Companies and laser owners',
      'Get found when they need a part',
      'List parts that are on the shelf',
    ],
    shot: {
      src: '/landing/parts.webp',
      alt: 'Parts marketplace listings with guest prices redacted',
      caption: 'Parts for sale',
    },
  },
];

const HERO_SLIDES: {
  audience: string;
  title: string;
  subhead?: string;
  shot: { src: string; alt: string; caption: string };
}[] = [
  {
    audience: 'Repair companies',
    title: 'Schedule and Assign Service Calls',
    shot: {
      src: '/landing/dashboard.webp',
      alt: 'Dashboard with open tickets and upcoming calls',
      caption: 'Dashboard',
    },
  },
  {
    audience: 'Repair companies',
    title: 'Bid on open service requests',
    shot: {
      src: '/landing/marketplace.webp',
      alt: 'Marketplace home for parts, used systems, and service needs',
      caption: 'Marketplace',
    },
  },
  {
    audience: 'Laser Owner',
    title: 'Find a Repair Company',
    shot: {
      src: '/landing/marketplace.webp',
      alt: 'Marketplace home for parts, used systems, and service needs',
      caption: 'Marketplace',
    },
  },
  {
    audience: 'Laser Owner',
    title: 'Laser Owner',
    subhead: 'Shop around for the best price and the right shop.',
    shot: {
      src: '/landing/reports.webp',
      alt: 'Service reports list with drafts and completed work',
      caption: 'Service history',
    },
  },
  {
    audience: 'Laser Owner',
    title: 'View service history and track maintenance costs',
    shot: {
      src: '/landing/reports.webp',
      alt: 'Service history that stays with each laser',
      caption: 'Service history',
    },
  },
  {
    audience: 'Parts sellers',
    title: 'Connect with Repair Companies and laser owners',
    shot: {
      src: '/landing/parts.webp',
      alt: 'Parts marketplace listings with guest prices redacted',
      caption: 'Parts for sale',
    },
  },
];

/** 5–7s; restart after swipe so a manual move is not immediately overwritten. */
export const HERO_AUTO_MS = 6000;

function HeroCarousel() {
  const n = HERO_SLIDES.length;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const pausedRef = React.useRef(false);
  const holdRef = React.useRef(false);

  const go = (dir: number) => setI((x) => (x + dir + n) % n);
  const goTo = (idx: number) => setI(((idx % n) + n) % n);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      if (document.hidden || pausedRef.current || holdRef.current) return;
      setI((x) => (x + 1) % n);
    }, HERO_AUTO_MS);
    return () => window.clearInterval(id);
  }, [i, n]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    }
  };

  const onPointerMove = () => {
    // Arm pause only after the pointer actually moves. A page-load
    // mouseenter (cursor already over the hero) used to freeze autoplay.
    if (!holdRef.current) setHold(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  };

  const slide = HERO_SLIDES[i];

  return (
    <section
      className="lp-hero-carousel"
      aria-roledescription="carousel"
      aria-label="Who Total Service Pro is for"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHold(false);
        }
      }}
    >
      <div
        className="lp-hero-viewport"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        <div
          className="lp-hero-track"
          style={{ transform: `translateX(-${i * 100}%)` }}
        >
          {HERO_SLIDES.map((s, idx) => (
            <div
              key={`${s.audience}-${s.title}`}
              className="lp-hero-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={`${idx + 1} of ${n}: ${s.audience}. ${s.title}${s.subhead ? `. ${s.subhead}` : ''}`}
              aria-hidden={idx !== i}
              inert={idx !== i ? true : undefined}
            >
              <div className="lp-hero-copy">
                {s.audience !== s.title ? <p className="lp-kicker">{s.audience}</p> : null}
                {idx === i ? (
                  <h1 className="lp-title">{s.title}</h1>
                ) : (
                  <p className="lp-title">{s.title}</p>
                )}
                {s.subhead ? <p className="lp-subhead">{s.subhead}</p> : null}
              </div>
              <Shot src={s.shot.src} alt={s.shot.alt} caption={s.shot.caption} />
            </div>
          ))}
        </div>
      </div>

      <p className="lp-sr" aria-live="polite">
        {slide.audience}. {slide.title}
        {slide.subhead ? `. ${slide.subhead}` : ''}.
      </p>

      <div className="lp-hero-bar">
        <div className="lp-hero-controls">
          <button
            type="button"
            className="lp-hero-arrow"
            aria-label="Previous slide"
            onClick={() => go(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <div className="lp-hero-dots" role="group" aria-label="Slides">
            {HERO_SLIDES.map((s, idx) => (
              <button
                key={`${s.audience}-${s.title}-dot`}
                type="button"
                className={`lp-hero-dot${idx === i ? ' is-on' : ''}`}
                aria-label={`${s.audience}: ${s.title}`}
                aria-current={idx === i ? 'true' : undefined}
                onClick={() => goTo(idx)}
              />
            ))}
          </div>
          <button
            type="button"
            className="lp-hero-arrow"
            aria-label="Next slide"
            onClick={() => go(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="lp-hero-pause"
            aria-pressed={paused}
            aria-label={paused ? 'Play slides' : 'Pause slides'}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Play' : 'Pause'}
          </button>
        </div>
        <div className="lp-actions">
          <Link href="/signup" className="lp-btn lp-btn-primary">
            Register for Total Service Pro
          </Link>
          <Link href="/plans" className="lp-btn lp-btn-ghost">
            Register for a Free Plan
          </Link>
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <LandingShell>
      <HeroCarousel />

      <section className="lp-gallery" aria-label="Product screens">
        <Shot
          src="/landing/parts.webp"
          alt="Parts marketplace listings with guest prices redacted"
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
        <p className="lp-lede">Repair company, clinic, or parts seller.</p>
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
                <Link
                  href={plansHrefForAudience(LANDING_PLAN_ROLE[r.id])}
                  className="lp-btn lp-btn-ghost"
                >
                  Free Plan
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
        <p className="lp-lede">Repair company, clinic, or parts seller.</p>
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
            <h3>Laser Owner</h3>
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
          <Link href="/plans" className="lp-btn lp-btn-primary">
            Register for a Free Plan
          </Link>
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Already registered? Sign in
          </Link>
          <Link href="/directory" className="lp-btn lp-btn-ghost">
            Directory
          </Link>
        </div>
      </section>
    </LandingShell>
  );
}
