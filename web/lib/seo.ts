import type { Metadata } from 'next';

/** Canonical production origin for crawlers. Preview hosts still canonicalize here. */
export const SEO_ORIGIN = 'https://repairplanet.net';

export const DEFAULT_TITLE = 'RepairPlanet · Total Service Pro';

export const DEFAULT_DESCRIPTION =
  'RepairPlanet is a biomedical equipment service network for clinics — lasers, lithotriptors, and C-arms first. Total Service Pro from Medical Repair Network is the operating system behind the network.';

export const TITLE_TEMPLATE = '%s · RepairPlanet';

/**
 * Indexable marketing / directory / catalog paths only.
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
  '/signup',
  '/signup/company',
  '/signup/owner',
  '/signup/supplier',
  '/login',
  '/find-a-rep',
  '/unsubscribe',
  '/forgot-password',
  '/calculators',
] as const;

/**
 * Signed-in / private prefixes. Do not list public marketing paths here
 * (/marketplace, /directory, /plans, /signup, /login, /parts, /find-a-rep, /unsubscribe).
 * /parts is the shop catalog (RequireAuth); crawlers may still hit it — it is not Disallow'd
 * because the public parts catalog lives under /marketplace/parts.
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
  '/pdf-viewer-demo',
] as const;

export const ROBOTS_ALLOW = [
  '/',
  '/plans',
  '/marketplace',
  '/directory',
  '/signup',
  '/login',
  '/parts',
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
      'Register for Total Service Pro. Repair companies, clinics, and parts sellers each get their own door. Technicians are invited by their repair company.',
  },
  signupCompany: {
    path: '/signup/company',
    title: 'Register a repair company',
    description:
      'Register a repair company on Total Service Pro. Dispatch, estimates, invoices, and bids on clinic repair work — lasers, lithotriptors, and C-arms first.',
  },
  signupOwner: {
    path: '/signup/owner',
    title: 'Register a clinic',
    description:
      'Register a clinic, rental company, or reseller on Total Service Pro. Track systems and find biomedical service — lasers, lithotriptors, and C-arms first.',
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
      'Sign in to Total Service Pro on RepairPlanet — shop schedule, directory, and marketplace for biomedical equipment service.',
  },
  findARep: {
    path: '/find-a-rep',
    title: 'Find a service rep',
    description:
      'Find a service or repair company near you. No Total Service Pro account required — RepairPlanet posts a request for a nearby biomedical shop. Lasers, lithotriptors, and C-arms first.',
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
  if (path === '/') return `${SEO_ORIGIN}/`;
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

export function sitemapXml(): string {
  const urls = PUBLIC_SITEMAP_PATHS.map((path) => {
    const loc = canonicalUrl(path);
    return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`;
  });
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
        url: `${SEO_ORIGIN}/`,
        description: DEFAULT_DESCRIPTION,
      },
      {
        '@type': 'WebSite',
        '@id': siteId,
        name: 'RepairPlanet',
        alternateName: 'Total Service Pro',
        url: `${SEO_ORIGIN}/`,
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
        url: `${SEO_ORIGIN}/`,
        description:
          'Shop, clinic, and parts operating system behind the RepairPlanet biomedical service network.',
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

function openGraphFor(page: PageSeo): NonNullable<Metadata['openGraph']> {
  const title = page.absoluteTitle ? page.title : undefined;
  return {
    type: 'website',
    siteName: 'RepairPlanet',
    title: title || page.title,
    description: page.description,
    url: page.path,
  };
}

export function publicPageMetadata(key: PublicPageKey): Metadata {
  const page = PUBLIC_PAGE_SEO[key];
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: openGraphFor(page),
    twitter: {
      card: 'summary',
      title: page.absoluteTitle ? page.title : page.title,
      description: page.description,
    },
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
  },
  twitter: {
    card: 'summary',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export const privateAppMetadata: Metadata = {
  robots: { index: false, follow: false },
};
