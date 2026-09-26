import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleBody } from '@/components/content/ArticleBody';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import {
  getMake,
  makeBlocks,
  makeIndexable,
  manualPath,
  manualsByMake,
} from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams() {
  return manualsByMake().map((make) => ({ make: make.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ make: string }>;
}): Promise<Metadata> {
  const { make: makeSlug } = await Promise.resolve(params);
  const make = getMake(makeSlug);
  if (!make) return { robots: { index: false, follow: false }, title: 'Service manuals' };
  return contentPageMetadata(makeIndexable(make));
}

export default async function MakePage({ params }: { params: Promise<{ make: string }> }) {
  const { make: makeSlug } = await Promise.resolve(params);
  const make = getMake(makeSlug);
  if (!make) notFound();
  const page = makeIndexable(make);
  return (
    <ArticleBody page={page} blocks={makeBlocks(make)} related={[{ href: '/service-manuals', label: 'All makes' }]}>
      <h2>Models</h2>
      <ul className="content-index">
        {make.manuals.map((manual) => (
          <li key={manual.modelSlug}>
            <a href={manualPath(manual)}>
              <strong>{manual.title}</strong>
              <span>
                {manual.modelName} · {manual.documentType} · {manual.equipmentType}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </ArticleBody>
  );
}
