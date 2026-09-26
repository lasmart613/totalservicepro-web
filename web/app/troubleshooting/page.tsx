import type { Metadata } from 'next';
import { ArticleBody } from '@/components/content/ArticleBody';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import {
  TROUBLESHOOTING_GUIDES,
  TROUBLESHOOTING_HUB,
  hubBlocks,
  hubIndexable,
  troubleshootingPath,
} from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;

const page = hubIndexable(TROUBLESHOOTING_HUB, 'Troubleshooting');

export const metadata: Metadata = contentPageMetadata(page);

export default function TroubleshootingHubPage() {
  return (
    <ArticleBody
      page={page}
      blocks={hubBlocks(TROUBLESHOOTING_HUB.path)}
      related={[
        { href: '/service-manuals', label: 'Service manual notes' },
        { href: '/blog', label: 'Field notes' },
        { href: '/calculators', label: 'Calculators' },
      ]}
    >
      <h2>Guides</h2>
      <ul className="content-index">
        {TROUBLESHOOTING_GUIDES.map((guide) => (
          <li key={guide.slug}>
            <a href={troubleshootingPath(guide.slug)}>
              <strong>{guide.title}</strong>
              <span>{guide.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </ArticleBody>
  );
}
