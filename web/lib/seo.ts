import type { Metadata } from 'next';

/** Canonical production origin for crawlers. Preview hosts still canonicalize here. */
export const SEO_ORIGIN = 'https://repairplanet.net';

/** ~65 characters: brand, field-service keywords, and RepairPlanet. */
export const DEFAULT_TITLE = 'Total Service Pro — Biomed & Laser Field Service | RepairPlanet';

export const DEFAULT_DESCRIPTION =
  'RepairPlanet is a medical-device service network for BMETs, laser service engineers, and the clinics that own the equipment — lasers, lithotriptors, C-arms, and more. Total Service Pro from Medical Repair Network is the operating system behind the network.';

export const TITLE_TEMPLATE = '%s · RepairPlanet';

/**
 * Indexable marketing URLs only. Auth shells (/login, /forgot-password) and
 * /unsubscribe are noindex and stay out of the sitemap.
 * No god/admin/hub/reports/private org pages or authenticated ticket URLs.
 */
export const PUBLIC_SITEMAP_PATHS = [
  '/',
  '/plans',
  '/marketplace',
  '/marketplace/parts',
  '/marketplace/used-systems',
  '/marketplace/consumables',
  '/directory',
  '/find-a-rep',
  '/calculators',
  '/signup',
  '/signup/company',
  '/signup/owner',
  '/signup/supplier',
] as const;

/** Reachable but not indexable. Must not appear in the sitemap. */
export const SITEMAP_EXCLUDED_PATHS = ['/login', '/forgot-password', '/unsubscribe'] as const;

/**
 * Future public manual pages live at /service-manuals/[make]/[model].
 * /manuals stays a private, robots-disallowed prefix — do not list it here.
 * Return [] until those pages exist.
 */
export function serviceManualSitemapPaths(): string[] {
  return [];
}

/**
 * Future posts live at /blog/[slug]. Return [] until those pages exist.
 */
export function blogSitemapPaths(): string[] {
  return [];
}

export function collectSitemapPaths(): string[] {
  const manuals = serviceManualSitemapPaths();
  const posts = blogSitemapPaths();
  for (const path of manuals) {
    if (!path.startsWith('/service-manuals/')) {
      throw new Error(`service manual sitemap path must start with /service-manuals/: ${path}`);
    }
  }
  for (const path of posts) {
    if (!path.startsWith('/blog/')) {
      throw new Error(`blog sitemap path must start with /blog/: ${path}`);
    }
  }
  return [...PUBLIC_SITEMAP_PATHS, ...manuals, ...posts];
}

/**
 * Signed-in / private prefixes. Do not list public marketing paths here
 * (/marketplace, /directory, /plans, /signup, /login, /find-a-rep).
 * /parts and /manuals are auth-gated and noindex. Do not add Allow: /parts.
 * Disallow: /manuals stays so it does not open a public /manuals tree;
 * future public manuals use /service-manuals.
 */
export const ROBOTS_DISALLOW = [
  '/admin',
  '/admin/god',
  '/god',
  '/hub',
  '/reports',
  '/bids',
  '/accepted-bids',
  '/company',
  '/customers',
  '/profile',
  '/settings',
  '/notifications',
  '/onboarding',
  '/my-lasers',
  '/test-equipment',
  '/service-schedule',
  '/service-tickets',
  '/service-requests',
  '/estimates',
  '/invoices',
  '/invoice-paid',
  '/purchase-orders',
  '/manuals',
  '/ai-assistant',
  '/auth',
  '/checkout',
  '/e/',
  '/api',
  '/marketplace/list',
  '/marketplace/my-listings',
  '/marketplace/storefront',
  '/pdf-viewer-demo',
  '/dev',
] as const;

export const ROBOTS_ALLOW = [
  '/',
  '/plans',
  '/marketplace',
  '/directory',
  '/signup',
  '/login',
  '/find-a-rep',
  '/unsubscribe',
] as const;

export type PublicPageKey =
  | 'home'
  | 'plans'
  | 'marketplace'
  | 'marketplaceParts'
  | 'marketplaceUsedSystems'
  | 'marketplaceConsumables'
  | 'directory'
  | 'signup'
  | 'signupCompany'
  | 'signupOwner'
  | 'signupSupplier'
  | 'login'
  | 'findARep'
  | 'forgotPassword'
  | 'calculators';

type PageSeo = {
  path: string;
  /** Short title; root template appends " · RepairPlanet". Home uses the default title. */
  title: string;
  description: string;
  absoluteTitle?: boolean;
};

export const PUBLIC_PAGE_SEO: Record<PublicPageKey, PageSeo> = {
  home: {
    path: '/',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    absoluteTitle: true,
  },
  plans: {
    path: '/plans',
    title: 'Plans',
    description:
      'Register for a Free Plan. Compare Free, Premium, and Team for repair companies, clinics, and parts sellers on Total Service Pro — the operating system behind RepairPlanet.',
  },
  marketplace: {
    path: '/marketplace',
    title: 'Marketplace',
    description:
      'Parts, used systems, and consumables for biomedical service — lasers, lithotriptors, and C-arms first. Buy, sell, and connect on RepairPlanet.',
  },
  marketplaceParts: {
    path: '/marketplace/parts',
    title: 'Parts for sale',
    description:
      'Parts listed for sale by suppliers and repair companies on the RepairPlanet marketplace. Biomedical service parts — lasers, lithotriptors, and C-arms first.',
  },
  marketplaceUsedSystems: {
    path: '/marketplace/used-systems',
    title: 'Used systems',
    description:
      'Buy or sell pre-owned biomedical systems on RepairPlanet. Lasers, lithotriptors, and C-arms first.',
  },
  marketplaceConsumables: {
    path: '/marketplace/consumables',
    title: 'Consumables',
    description:
      'Handpieces, fibers, tips, gels, and common consumables listed on the RepairPlanet marketplace.',
  },
  directory: {
    path: '/directory',
    title: 'Directory',
    description:
      'Find a repair company in the RepairPlanet directory. Service companies, clinics, resellers, and parts suppliers — lasers, lithotriptors, and C-arms first.',
  },
  signup: {
    path: '/signup',
    title: 'Register',
    description:
      'Register for Total Service Pro. Repair companies for BMETs and laser service engineers, clinics and medical-device owners, and parts sellers each get their own door. Technicians are invited by their repair company.',
  },
  signupCompany: {
    path: '/signup/company',
    title: 'Register a repair company',
    description:
      'Register a repair company on Total Service Pro. Built for BMETs and laser service engineers — dispatch, estimates, invoices, and bids on clinic repair work. Lasers, lithotriptors, C-arms, and more.',
  },
  signupOwner: {
    path: '/signup/owner',
    title: 'Register a clinic',
    description:
      'Register a clinic, hospital, rental company, or reseller on Total Service Pro. Track medical devices and find biomedical service — lasers, lithotriptors, C-arms, and more.',
  },
  signupSupplier: {
    path: '/signup/supplier',
    title: 'Register as a parts seller',
    description:
      'Register as a parts seller on Total Service Pro. Get found when repair companies and clinics need a part that is on your shelf.',
  },
  login: {
    path: '/login',
    title: 'Sign in',
    description:
      'Sign in to Total Service Pro on RepairPlanet — shop schedule, directory, and marketplace for BMETs, laser service engineers, and medical-device owners.',
  },
  findARep: {
    path: '/find-a-rep',
    title: 'Find a service rep',
    description:
      'Find a service or repair company near you. No Total Service Pro account required — RepairPlanet posts a request for a nearby biomedical shop. Medical devices — lasers, lithotriptors, and C-arms first.',
  },
  forgotPassword: {
    path: '/forgot-password',
    title: 'Reset password',
    description: 'Reset your Total Service Pro password for RepairPlanet.',
  },
  calculators: {
    path: '/calculators',
    title: 'Photometry tools',
    description:
      'Fluence, irradiance, and power tools for biomedical field service. Photometry calculators on RepairPlanet / Total Service Pro.',
  },
};

export function canonicalUrl(path: string): string {
  if (path === '/') return SEO_ORIGIN;
  return `${SEO_ORIGIN}${path}`;
}

export function robotsTxt(): string {
  const lines = [
    '# RepairPlanet · Total Service Pro · Medical Repair Network',
    'User-agent: *',
    ...ROBOTS_ALLOW.map((path) => `Allow: ${path}`),
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${SEO_ORIGIN}/sitemap.xml`,
    '',
  ];
  return lines.join('\n');
}

export type SitemapEntry = {
  loc: string;
  lastmod: string;
  changefreq: 'weekly';
};

/** YYYY-MM-DD so lastmod stays a date. Defaults to the build/request day. */
export function sitemapLastMod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function sitemapEntries(now: Date = new Date()): SitemapEntry[] {
  const lastmod = sitemapLastMod(now);
  return collectSitemapPaths().map((path) => ({
    loc: canonicalUrl(path),
    lastmod,
    changefreq: 'weekly' as const,
  }));
}

export function sitemapXml(now: Date = new Date()): string {
  const urls = sitemapEntries(now).map(
    (entry) =>
      `  <url>\n    <loc>${entry.loc}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n  </url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function siteJsonLd(): Record<string, unknown> {
  const orgId = `${SEO_ORIGIN}/#organization`;
  const siteId = `${SEO_ORIGIN}/#website`;
  const appId = `${SEO_ORIGIN}/#software`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: 'Medical Repair Network',
        alternateName: ['RepairPlanet', 'Total Service Pro'],
        url: canonicalUrl('/'),
        logo: {
          '@type': 'ImageObject',
          url: `${SEO_ORIGIN}/apple-icon.png`,
          width: 180,
          height: 180,
        },
        description: DEFAULT_DESCRIPTION,
      },
      {
        '@type': 'WebSite',
        '@id': siteId,
        name: 'RepairPlanet',
        alternateName: 'Total Service Pro',
        url: canonicalUrl('/'),
        description: DEFAULT_DESCRIPTION,
        publisher: { '@id': orgId },
        inLanguage: 'en-US',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: 'Total Service Pro',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: canonicalUrl('/'),
        description:
          'Shop, clinic, and parts operating system behind the RepairPlanet medical-device service network — for BMETs, laser service engineers, and equipment owners.',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        publisher: { '@id': orgId },
      },
    ],
  };
}

function displayTitle(page: PageSeo): string {
  return page.absoluteTitle ? page.title : `${page.title} · RepairPlanet`;
}

const NOINDEX_FOLLOW_PAGES = new Set<PublicPageKey>(['login', 'forgotPassword']);

/** Stable share image. File conventions also emit this route; nested layouts must set it explicitly or they drop the inherited tag. */
export const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'RepairPlanet — Total Service Pro, field service software for biomedical and laser repair',
} as const;

function openGraphFor(page: PageSeo): NonNullable<Metadata['openGraph']> {
  return {
    type: 'website',
    siteName: 'RepairPlanet',
    title: displayTitle(page),
    description: page.description,
    url: page.path,
    images: [{ ...OG_IMAGE }],
  };
}

function twitterFor(page: PageSeo): NonNullable<Metadata['twitter']> {
  return {
    card: 'summary_large_image',
    title: displayTitle(page),
    description: page.description,
    images: [OG_IMAGE.url],
  };
}

export function publicPageMetadata(key: PublicPageKey): Metadata {
  const page = PUBLIC_PAGE_SEO[key];
  return {
    // Absolute so the document title always includes " · RepairPlanet"
    // even if a nested layout replaces the root title template.
    title: { absolute: displayTitle(page) },
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: openGraphFor(page),
    twitter: twitterFor(page),
    ...(NOINDEX_FOLLOW_PAGES.has(key) ? { robots: { index: false, follow: true } } : {}),
  };
}

export const rootMetadata: Metadata = {
  metadataBase: new URL(SEO_ORIGIN),
  title: {
    default: DEFAULT_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'RepairPlanet',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: '/',
    images: [{ ...OG_IMAGE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  icons: {
    // Stable public URLs (also shipped as app/ file conventions). Google wants 48×48+.
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-48.png', type: 'image/png', sizes: '48x48' },
      { url: '/favicon.ico', sizes: '48x48' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const privateAppMetadata: Metadata = {
  robots: { index: false, follow: false },
  // Root metadata canonicalizes to /. noindex pages must not inherit that.
  alternates: { canonical: null },
};
