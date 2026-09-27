import type { ReactNode } from 'react';
import { JsonLdScript } from '@/components/content/JsonLdScript';
import { Breadcrumbs, Byline, ContentBlocks, RelatedLinks } from '@/components/content/ContentBlocks';
import { contentJsonLdScript } from '@/lib/seo/contentPage';
import type { ArticleEntry, ContentBlock, IndexableContent, RelatedLink } from '@/lib/seo/publicContent';

export function ArticleBody({
  page,
  blocks,
  related = [],
  children,
}: {
  page: IndexableContent;
  blocks: ContentBlock[];
  related?: RelatedLink[];
  children?: ReactNode;
}) {
  return (
    <article className="content-prose">
      <JsonLdScript json={contentJsonLdScript(page)} />
      <Breadcrumbs crumbs={page.breadcrumbs} />
      <h1>{page.title}</h1>
      <Byline updatedAt={page.updatedAt} />
      <ContentBlocks blocks={blocks} />
      {children}
      <RelatedLinks links={related} />
    </article>
  );
}

export function ArticleFromEntry({
  page,
  entry,
}: {
  page: IndexableContent;
  entry: ArticleEntry;
}) {
  return <ArticleBody page={page} blocks={entry.blocks} related={entry.related} />;
}
