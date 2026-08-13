'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Horizontal bookshelf scroller: carets at ends, no visible scrollbar.
 * Wraps children (typically .books-row content) inside a scrollable row.
 */
export function ShelfScroller({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const sl = el.scrollLeft;
    // 2px slack for subpixel rounding
    setCanLeft(sl > 2);
    setCanRight(max > 2 && sl < max - 2);
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    // Re-check after images/fonts settle
    const t1 = setTimeout(update, 80);
    const t2 = setTimeout(update, 400);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', update);
    };
  }, [update, children]);

  const scrollByDir = (dir: -1 | 1) => {
    const el = rowRef.current;
    if (!el) return;
    const amount = Math.max(160, Math.floor(el.clientWidth * 0.7));
    el.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };

  return (
    <div className={`shelf-scroller ${className}`.trim()}>
      <button
        type="button"
        className={`shelf-caret shelf-caret-left ${canLeft ? 'is-visible' : ''}`}
        aria-label="Scroll shelf left"
        tabIndex={canLeft ? 0 : -1}
        disabled={!canLeft}
        onClick={() => scrollByDir(-1)}
      >
        <ChevronLeft size={22} strokeWidth={2.5} />
      </button>
      <div ref={rowRef} className="books-row shelf-scroll-row">
        {children}
      </div>
      <button
        type="button"
        className={`shelf-caret shelf-caret-right ${canRight ? 'is-visible' : ''}`}
        aria-label="Scroll shelf right"
        tabIndex={canRight ? 0 : -1}
        disabled={!canRight}
        onClick={() => scrollByDir(1)}
      >
        <ChevronRight size={22} strokeWidth={2.5} />
      </button>
    </div>
  );
}
