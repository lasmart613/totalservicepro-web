import { canonicalUrl, SEO_ORIGIN } from '../seo.ts';
import { PUBLIC_CONTENT_AUTHOR, type IndexableContent } from './publicContent.ts';

/** Article or TechArticle plus BreadcrumbList. No ratings. */
export function contentJsonLd(page: IndexableContent): Record<string, unknown> {
  const pageUrl = canonicalUrl(page.path);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': page.kind,
        headline: page.title,
        description: page.description,
        author: {
          '@type': 'Organization',
          name: PUBLIC_CONTENT_AUTHOR,
          url: `${SEO_ORIGIN}/`,
        },
        publisher: {
          '@type': 'Organization',
          name: PUBLIC_CONTENT_AUTHOR,
          url: `${SEO_ORIGIN}/`,
        },
        datePublished: page.updatedAt,
        dateModified: page.updatedAt,
        mainEntityOfPage: pageUrl,
        url: pageUrl,
        inLanguage: 'en-US',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: page.breadcrumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: canonicalUrl(crumb.path),
        })),
      },
    ],
  };
}
