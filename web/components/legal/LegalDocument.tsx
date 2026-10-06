'use client';

import { PublicLink, useT } from '@/lib/fa/locale';
import { LandingShell } from '@/components/landing/LandingShell';
import { parseInline, parseLegalMarkdown, type InlinePiece } from '@/lib/legal/markdown';
import '@/components/content/content.css';
import './legal.css';

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((piece, index) => (
        <InlinePieceView key={index} piece={piece} />
      ))}
    </>
  );
}

function InlinePieceView({ piece }: { piece: InlinePiece }) {
  if (piece.type === 'strong') return <strong>{piece.text}</strong>;
  if (piece.type === 'link') {
    if (piece.href.startsWith('/')) {
      return (
        <PublicLink href={piece.href} className="hover:underline">
          {piece.text}
        </PublicLink>
      );
    }
    return (
      <a href={piece.href} className="hover:underline">
        {piece.text}
      </a>
    );
  }
  return <>{piece.text}</>;
}

/**
 * Public legal page. The heading and draft banner use the site language.
 * The body stays English and is isolated as LTR so RTL locales do not reorder it.
 */
export function LegalDocument({ heading, markdown }: { heading: string; markdown: string }) {
  const t = useT();
  const blocks = parseLegalMarkdown(markdown);
  return (
    <LandingShell>
      <article className="lp-section legal-page">
        <div className="legal-wrap">
          <p className="legal-draft" role="status">
            {t('Draft, pending owner review')}
          </p>
          <h1 className="lp-h2">{t(heading)}</h1>
          <div className="legal-body content-prose" dir="ltr" lang="en">
            {blocks.map((block, index) => {
              if (block.type === 'h2') {
                return (
                  <h2 key={index}>
                    <Inline text={block.text} />
                  </h2>
                );
              }
              if (block.type === 'ul') {
                return (
                  <ul key={index}>
                    {block.items.map((item) => (
                      <li key={item}>
                        <Inline text={item} />
                      </li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={index}>
                  <Inline text={block.text} />
                </p>
              );
            })}
          </div>
        </div>
      </article>
    </LandingShell>
  );
}
