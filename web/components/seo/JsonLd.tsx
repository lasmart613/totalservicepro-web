import { siteJsonLd } from '@/lib/seo';

/** Organization + WebSite + SoftwareApplication JSON-LD for crawlers. */
export function JsonLd() {
  const json = JSON.stringify(siteJsonLd());
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
