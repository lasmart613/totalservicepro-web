import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/components/landing/landing.css';
import './content.css';

const NAV = [
  { href: '/service-manuals', label: 'Manuals' },
  { href: '/troubleshooting', label: 'Troubleshooting' },
  { href: '/blog', label: 'Notes' },
  { href: '/calculators', label: 'Calculators' },
  { href: '/directory', label: 'Directory' },
];

export function PublicContentShell({ children }: { children: ReactNode }) {
  return (
    <div className="lp-root">
      <script
        dangerouslySetInnerHTML={{
          __html: "document.documentElement.classList.add('landing-mode')",
        }}
      />
      <header className="lp-nav">
        <Link href="/" className="lp-brand">
          <span className="lp-brand-biz">Medical Repair Network</span>
          <span className="lp-brand-name">RepairPlanet</span>
          <span className="lp-brand-sub">Total Service Pro</span>
        </Link>
        <nav className="lp-nav-links" aria-label="Public">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="lp-nav-cta">
          <Link href="/login" className="lp-btn lp-btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-outline">
            Register
          </Link>
        </div>
      </header>
      <div className="lp-section content-wrap">{children}</div>
      <footer className="lp-footer">
        <div>
          <strong style={{ color: '#FBBF24' }}>RepairPlanet</strong>
          {' · '}
          Medical Repair Network
          {' · '}
          Total Service Pro
        </div>
        <div className="lp-footer-links">
          <Link href="/service-manuals">Service manuals</Link>
          <Link href="/troubleshooting">Troubleshooting</Link>
          <Link href="/blog">Field notes</Link>
          <Link href="/calculators">Calculators</Link>
          <Link href="/plans">Free plan</Link>
          <Link href="/signup">Sign up</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
