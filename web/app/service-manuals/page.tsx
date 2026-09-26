import type { Metadata } from 'next';
import { ArticleBody } from '@/components/content/ArticleBody';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import {
  SERVICE_MANUALS_HUB,
  hubBlocks,
  hubIndexable,
  makePath,
  manualsByMake,
} from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;

const page = hubIndexable(SERVICE_MANUALS_HUB, 'Service manuals');

export const metadata: Metadata = contentPageMetadata(page);

export default function ServiceManualsHubPage() {
  const makes = manualsByMake();
  return (
    <ArticleBody
      page={page}
      blocks={hubBlocks(SERVICE_MANUALS_HUB.path)}
      related={[
        { href: '/blog', label: 'Field service notes' },
        { href: '/troubleshooting', label: 'Troubleshooting notes' },
        { href: '/calculators', label: 'Photometry calculators' },
      ]}
    >
      <h2>Makes</h2>
      <ul className="content-index">
        {makes.map((make) => {
          const types = [...new Set(make.manuals.map((manual) => manual.equipmentType))].join(', ');
          return (
            <li key={make.slug}>
              <a href={makePath(make.slug)}>
                <strong>{make.name}</strong>
                <span>
                  {make.manuals.length} {make.manuals.length === 1 ? 'document' : 'documents'} · {types}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </ArticleBody>
  );
}
