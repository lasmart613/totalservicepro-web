import Link from 'next/link';
import type { ReactNode } from 'react';

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Renders [label](/path) links. Only site-relative paths are linked. */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const label = match[1];
    const href = match[2];
    if (href.startsWith('/') && !href.startsWith('//')) {
      parts.push(
        <Link key={`${index}-${href}`} href={href}>
          {label}
        </Link>,
      );
    } else {
      parts.push(match[0]);
    }
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
