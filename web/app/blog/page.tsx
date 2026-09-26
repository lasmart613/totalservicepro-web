import type { Metadata } from 'next';
import { ArticleBody } from '@/components/content/ArticleBody';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import { BLOG_HUB, BLOG_POSTS, blogPath, hubBlocks, hubIndexable } from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;

const page = hubIndexable(BLOG_HUB, 'Field notes');

export const metadata: Metadata = contentPageMetadata(page);

export default function BlogHubPage() {
  return (
    <ArticleBody
      page={page}
      blocks={hubBlocks(BLOG_HUB.path)}
      related={[
        { href: '/service-manuals', label: 'Service manual notes' },
        { href: '/troubleshooting', label: 'Troubleshooting' },
        { href: '/calculators', label: 'Calculators' },
      ]}
    >
      <h2>Notes</h2>
      <ul className="content-index">
        {BLOG_POSTS.map((post) => (
          <li key={post.slug}>
            <a href={blogPath(post.slug)}>
              <strong>{post.title}</strong>
              <span>{post.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </ArticleBody>
  );
}
