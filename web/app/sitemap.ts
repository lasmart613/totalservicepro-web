import type { MetadataRoute } from 'next';
import { sitemapEntries } from '@/lib/seo';

/** Generated /sitemap.xml. Static public/sitemap.xml must not exist beside this. */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries().map((entry) => ({
    url: entry.loc,
    lastModified: entry.lastmod,
    changeFrequency: entry.changefreq,
  }));
}
