import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ManualArticle } from '@/components/content/ManualArticle';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import { SERVICE_MANUALS, getManual, manualIndexable } from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams() {
  return SERVICE_MANUALS.map((manual) => ({
    make: manual.makeSlug,
    model: manual.modelSlug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ make: string; model: string }>;
}): Promise<Metadata> {
  const { make, model } = await Promise.resolve(params);
  const manual = getManual(make, model);
  if (!manual) return { robots: { index: false, follow: false }, title: 'Service manual' };
  return contentPageMetadata(manualIndexable(manual));
}

export default async function ManualPage({
  params,
}: {
  params: Promise<{ make: string; model: string }>;
}) {
  const { make, model } = await Promise.resolve(params);
  const manual = getManual(make, model);
  if (!manual) notFound();
  return <ManualArticle manual={manual} />;
}
