import type { ContentBlock, RelatedLink } from '@/lib/seo/publicContent';
import { RichText } from './RichText';

export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'h2') {
          return <h2 key={index}>{block.text}</h2>;
        }
        if (block.type === 'ul') {
          return (
            <ul key={index}>
              {block.items.map((item) => (
                <li key={item}>
                  <RichText text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <RichText text={block.text} />
          </p>
        );
      })}
    </>
  );
}

export function RelatedLinks({ links }: { links: RelatedLink[] }) {
  if (!links.length) return null;
  return (
    <nav className="content-related" aria-label="Related">
      <h2>Related</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Breadcrumbs({ crumbs }: { crumbs: { name: string; path: string }[] }) {
  return (
    <nav className="content-crumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={crumb.path}>
            {index > 0 ? ' / ' : null}
            {last ? crumb.name : <a href={crumb.path}>{crumb.name}</a>}
          </span>
        );
      })}
    </nav>
  );
}

export function Byline({ updatedAt }: { updatedAt: string }) {
  const formatted = new Date(`${updatedAt}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <p className="content-byline">
      By Medical Repair Network · Updated {formatted}
    </p>
  );
}
