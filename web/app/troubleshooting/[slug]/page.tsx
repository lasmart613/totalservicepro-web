import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleFromEntry } from '@/components/content/ArticleBody';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import {
  TROUBLESHOOTING_GUIDES,
  getTroubleshootingGuide,
  troubleshootingIndexable,
} from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams() {
  return TROUBLESHOOTING_GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await Promise.resolve(params);
  const guide = getTroubleshootingGuide(slug);
  if (!guide) return { robots: { index: false, follow: false }, title: 'Troubleshooting' };
  return contentPageMetadata(troubleshootingIndexable(guide));
}

export default async function TroubleshootingGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await Promise.resolve(params);
  const guide = getTroubleshootingGuide(slug);
  if (!guide) notFound();
  return <ArticleFromEntry page={troubleshootingIndexable(guide)} entry={guide} />;
}
