'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LandingShell } from './LandingShell';
import { FindRepControl } from './FindRepControl';
import { FindRepForm } from './FindRepForm';
import { plansHrefForAudience, type PlanAudience } from '@/lib/billing/plan-tiles';
import { shouldAutoOpenFindRep } from '@/lib/clinic-service-lead';
import { LANDING_SHOT_SIZE, landingSizes, landingSrcSet } from '@/lib/landing-images';
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
          RepairPlanet
        </div>
        <div className="lp-brand-sub">Total Service Pro · Medical Equipment Service</div>
      </div>
    </div>
  );
}

function Shot({
  src,
  alt,
  caption,
  frame,
  priority,
  sizesKind = 'hero',
  mount = true,
}: {
  src: string;
  alt: string;
  caption?: string;
  frame?: 'phone';
  priority?: boolean;
  sizesKind?: 'hero' | 'gallery' | 'role' | 'phone';
  mount?: boolean;
}) {
  const phone = frame === 'phone';
  const dim = LANDING_SHOT_SIZE[src] || { width: phone ? 390 : 1400, height: phone ? 844 : 900 };
  const srcSet = landingSrcSet(src);
  return (
    <figure className={`lp-shot${phone ? ' is-phone' : ''}`}>
      {mount ? (
        <img
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? landingSizes(phone ? 'phone' : sizesKind) : undefined}
          alt={alt}
          width={dim.width}
          height={dim.height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'low'}
        />
      ) : (
        <div
          className="lp-shot-ph"
          style={{ aspectRatio: `${dim.width} / ${dim.height}` }}
          aria-hidden
        />
      )}
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
      'Jobs near you when clinics need a technician',
      'Color-coded shop calendar — assign calls by field engineer',
      'View service history on every job',
      'Keep service manuals in one place',
      'Bid on open service requests',
    ],
    shot: {
      src: '/landing/schedule.webp',
      alt: 'Color-coded shop schedule with assigned field engineer legend for Alex Lee, Jordan Hale, Sam Ortiz, and Unassigned',
      caption: 'Shop schedule',
    },
  },
  {
    id: 'clinic',
    label: 'Clinics',
    signup: '/signup/owner',
    lines: [
      'Find a service rep near you — no account required',
      'Lasers, lithotriptors, and C-arms first',
      'View service history and track maintenance costs',
    ],
    shot: {
      src: '/landing/directory.webp',
      alt: 'Directory search to find a repair company among service companies, clinics, resellers, and suppliers',
      caption: 'Directory',
    },
  },
  {
    id: 'parts',
    label: 'Parts sellers',
    signup: '/signup/supplier',
    lines: [
      'Connect with Repair Companies and clinics',
      'Get found when they need a part',
      'List parts that are on the shelf',
    ],
    shot: {
      src: '/landing/parts.webp',
      alt: 'Parts marketplace with live Candela listings and prices',
      caption: 'Parts for sale',
    },
  },
];

const HERO_SLIDES: {
  audience: string;
  title: string;
  sub: string;
  shot: { src: string; alt: string; caption: string; frame?: 'phone' };
}[] = [
  {
    audience: 'Repair companies',
    title: 'See Open Tickets and Upcoming Calls',
    sub: 'Color-coded jobs for the whole shop.',
    shot: {
      src: '/landing/dashboard.webp',
      alt: 'Shop dashboard for Alex Lee with 7 open tickets, 3 today’s calls, upcoming service calls, and Quick Access to Photometry, Tech Hub, Schedule, and Reports',
      caption: 'Shop dashboard',
    },
  },
  {
    audience: 'Clinics',
    title: 'Find a Repair Company',
    sub: 'Match lasers, lithotriptors, and C-arms with shops that can work on them.',
    shot: {
      src: '/landing/directory.webp',
      alt: 'Directory search to find a repair company among service companies, clinics, resellers, and suppliers',
      caption: 'Directory',
    },
  },
  {
    audience: 'Parts sellers',
    title: 'Connect with Repair Companies and Clinics',
    sub: 'Get found when a shop needs a part that’s on your shelf.',
    shot: {
      src: '/landing/parts.webp',
      alt: 'Parts marketplace with live listings and prices',
      caption: 'Parts for sale',
    },
  },
  {
    audience: 'Repair companies',
    title: 'Schedule and Assign Service Calls',
    sub: 'Assign each call to a field engineer.',
    shot: {
      src: '/landing/schedule.webp',
      alt: 'Color-coded August shop schedule with assigned field engineer legend',
      caption: 'Color-coded shop schedule',
    },
  },
  {
    audience: 'Clinics',
    title: 'View Service History',
    sub: 'Track work and maintenance costs on every system.',
    shot: {
      src: '/landing/reports.webp',
      alt: 'Service reports list with drafts and completed work',
      caption: 'Service history',
    },
  },
  {
    audience: 'Repair companies',
    title: 'Assign a Field Engineer and Email Them the Ticket',
    sub: 'They get the job details when you assign it.',
    shot: {
      src: '/landing/ticket-assign.webp',
      alt: 'Edit Ticket form assigning Jordan Hale as field engineer',
      caption: 'Assign to field engineer',
    },
  },
  {
    audience: 'Repair companies',
    title: 'Assign Shop Test Equipment to a Field Engineer',
    sub: 'Keep meters and tools with the tech who needs them.',
    shot: {
      src: '/landing/team-equipment.webp',
      alt: 'Team Management test equipment table with assign-to-field-engineer selects',
      caption: 'Test equipment',
    },
  },
  {
    audience: 'Repair companies',
    title: 'Photometry Tools on the Job',
    sub: 'Fluence, irradiance, and power in the field.',
    shot: {
      src: '/landing/app-calcs.webp',
      alt: 'Android Photometry Tools grid with Fluence, Irradiance, Duty Cycle, Wavelength, and Avg Power',
      caption: 'Photometry tools',
      frame: 'phone',
    },
  },
  {
    audience: 'Repair companies',
    title: 'Marketplace — Parts, Used Systems, and Service Needs',
    sub: 'Bid jobs and find parts from one shop account.',
    shot: {
      src: '/landing/marketplace.webp',
      alt: 'Marketplace home for parts, used systems, and service needs',
      caption: 'Marketplace',
    },
  },
];

const HERO_AUTO_MS = 7000;

const HERO_COVER: Record<string, string> = {
  'Repair companies': '/landing/hero-bg-shop.webp',
  Clinics: '/landing/hero-bg-clinic.webp',
  'Parts sellers': '/landing/hero-bg-parts.webp',
};

const HERO_COVER_SM: Record<string, string> = {
  'Repair companies': '/landing/hero-bg-shop-640.webp',
  Clinics: '/landing/hero-bg-clinic-640.webp',
  'Parts sellers': '/landing/hero-bg-parts-640.webp',
};

const HERO_COVER_ID: Record<string, string> = {
  'Repair companies': 'shop',
  Clinics: 'clinic',
  'Parts sellers': 'parts',
};

function HeroCarousel() {
  const router = useRouter();
  const n = HERO_SLIDES.length;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);
  const [visited, setVisited] = useState(() => new Set([0]));
  const start = React.useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  }, [i]);

  const go = (dir: number) => setI((x) => (x + dir + n) % n);
  const goTo = (idx: number) => setI(((idx % n) + n) % n);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!shouldAutoOpenFindRep(window.location.search, window.location.hash)) return;
    const el = document.getElementById('find-a-rep');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (new URLSearchParams(window.location.search).has('find')) {
      router.replace('/#find-a-rep', { scroll: false });
    }
  }, [router]);

  useEffect(() => {
    if (paused || hold) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setI((x) => (x + 1) % n);
    }, HERO_AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, hold, i, n]);

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
      aria-label="Who RepairPlanet and Total Service Pro are for"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHold(false);
        }
      }}
    >
      <p className="lp-hero-mission">
        RepairPlanet is a biomedical equipment service network — lasers, lithotriptors,
        and C-arms first. Total Service Pro is the operating system behind it.
      </p>
      <aside className="lp-hero-find" id="find-a-rep" aria-label="Find a service or repair company">
        <FindRepForm variant="hero" />
      </aside>
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
              aria-label={`${idx + 1} of ${n}: ${s.audience}. ${s.title}`}
              aria-hidden={idx !== i}
              inert={idx !== i ? true : undefined}
            >
              <div
                className={`lp-hero-copy${visited.has(idx) ? ' is-cover-on' : ''}`}
                data-cover={HERO_COVER_ID[s.audience]}
                style={
                  visited.has(idx)
                    ? ({
                        '--lp-hero-cover': `url("${HERO_COVER[s.audience]}")`,
                        '--lp-hero-cover-sm': `url("${HERO_COVER_SM[s.audience]}")`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <p className="lp-kicker">{s.audience}</p>
                {idx === i ? (
                  <h1 className="lp-title">{s.title}</h1>
                ) : (
                  <p className="lp-title">{s.title}</p>
                )}
                <p className="lp-hero-subhead">{s.sub}</p>
              </div>
              <Shot
                src={s.shot.src}
                alt={s.shot.alt}
                caption={s.shot.caption}
                frame={s.shot.frame}
                sizesKind="hero"
                priority={idx === 0}
                mount={visited.has(idx)}
              />
            </div>
          ))}
        </div>
      </div>

      <p className="lp-sr" aria-live="polite">
        {slide.audience}. {slide.title}. {slide.sub}
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
        <div className="lp-hero-cta">
          <div className="lp-actions">
            <Link href="/plans" className="lp-btn lp-btn-outline">
              Start on the free plan
            </Link>
            <Link href="/login" className="lp-btn lp-btn-ghost">
              Sign in
            </Link>
          </div>
          <p className="lp-hero-note">
            A free plan is included. Upgrade when you need more.
          </p>
          <p className="lp-hero-note">
            Service company?{' '}
            <Link href="/signup/company">Jobs near you — register your shop</Link>
            . Field engineers join through their shop.{' '}
            <Link href="/signup">Register for Total Service Pro</Link>
          </p>
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
          src="/landing/dashboard.webp"
          alt="Shop dashboard for Alex Lee with open tickets, today’s calls, and upcoming service calls"
          caption="Shop dashboard"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/schedule.webp"
          alt="Color-coded shop schedule with assigned field engineer legend"
          caption="Shop schedule"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/ticket-assign.webp"
          alt="Edit Ticket assigning a field engineer"
          caption="Assign to field engineer"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/team-equipment.webp"
          alt="Team Management test equipment assigned to a field engineer"
          caption="Test equipment"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/directory.webp"
          alt="Directory search to find a repair company among service companies, clinics, resellers, and suppliers"
          caption="Directory"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/reports.webp"
          alt="Service reports list with drafts and completed work"
          caption="Service history"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/parts.webp"
          alt="Parts marketplace with live Candela listings and prices"
          caption="Parts for sale"
          sizesKind="gallery"
        />
        <Shot
          src="/landing/marketplace.webp"
          alt="Marketplace home for parts, used systems, and service needs"
          caption="Marketplace"
          sizesKind="gallery"
        />
      </section>

      <section className="lp-section" id="features">
        <h2 className="lp-h2">What you get</h2>
        <p className="lp-lede">
          RepairPlanet is the biomedical service network. Total Service Pro is the
          shop, clinic, and parts operating system behind it.
        </p>
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
                sizesKind="role"
              />
              <div className="lp-actions">
                {r.id === 'clinic' ? (
                  <FindRepControl variant="column" label="Find a service rep near me" />
                ) : null}
                {r.id === 'shop' ? (
                  <Link href={r.signup} className="lp-btn lp-btn-primary">
                    Get jobs near you
                  </Link>
                ) : null}
                <Link
                  href={r.signup}
                  className={r.id === 'parts' ? 'lp-btn lp-btn-primary' : 'lp-btn lp-btn-ghost'}
                >
                  Register for Total Service Pro
                </Link>
                <Link
                  href={plansHrefForAudience(LANDING_PLAN_ROLE[r.id])}
                  className="lp-btn lp-btn-outline"
                >
                  Free Plan
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-phones" id="app">
        <div className="lp-phones-copy">
          <h2 className="lp-h2">Same account in the field</h2>
          <p className="lp-lede">View or edit Schedule, find parts, search service manuals, and create service reports on Android or iOS.</p>
          <p className="lp-kicker">Coming soon</p>
          <div className="lp-store-badges" role="group" aria-label="Mobile apps coming soon">
            <span className="lp-store-badge lp-store-badge-play">
              <img
                src="/landing/badge-google-play.png"
                alt="Google Play — coming soon"
                width={646}
                height={250}
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="lp-store-badge lp-store-badge-apple">
              <img
                src="/landing/badge-app-store.svg"
                alt="App Store — coming soon"
                width={120}
                height={40}
                loading="lazy"
                decoding="async"
              />
            </span>
          </div>
          <p className="lp-store-platforms">Android and iOS</p>
        </div>
        <div className="lp-phone-wrap">
          <div className="lp-phone">
            <img
              src="/landing/app-hub.webp"
              alt="Android Service Hub"
              width={390}
              height={844}
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="lp-phone">
            <img
              src="/landing/app-calcs.webp"
              alt="Photometry tools on Android"
              width={390}
              height={844}
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>
    </LandingShell>
  );
}
