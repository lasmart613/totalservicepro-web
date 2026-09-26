import type { Metadata } from 'next';
import { OG_IMAGE } from '../seo.ts';
import { contentJsonLd } from './contentJsonLd.ts';
import { PUBLIC_CONTENT_AUTHOR, type IndexableContent } from './publicContent.ts';

export function contentPageMetadata(page: IndexableContent): Metadata {
  const display = `${page.title} · RepairPlanet`;
  const article = page.kind === 'Article' || page.kind === 'TechArticle';
  return {
    // Absolute so a nested title template cannot drop " · RepairPlanet".
    title: { absolute: display },
    description: page.description,
    alternates: { canonical: page.path },
    robots: { index: true, follow: true },
    authors: [{ name: PUBLIC_CONTENT_AUTHOR }],
    openGraph: {
      type: article ? 'article' : 'website',
      siteName: 'RepairPlanet',
      title: display,
      description: page.description,
      url: page.path,
      publishedTime: page.updatedAt,
      modifiedTime: page.updatedAt,
      authors: [PUBLIC_CONTENT_AUTHOR],
      images: [{ ...OG_IMAGE }],
    },
    twitter: {
      card: 'summary_large_image',
      title: display,
      description: page.description,
      images: [OG_IMAGE.url],
    },
  };
}

export function contentJsonLdScript(page: IndexableContent): string {
  return JSON.stringify(contentJsonLd(page)).replace(/</g, '\\u003c');
}
