'use client';

import React, { useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  DEFAULT_PLAN_AUDIENCE,
  PLAN_AUDIENCE_OPTIONS,
  nextPlanAudience,
  parsePlanAudience,
  type PlanAudience,
} from '@/lib/billing/plan-tiles';

const SWIPE_PX = 48;

export function usePlanAudienceFromUrl(): [PlanAudience, (next: PlanAudience) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const role = parsePlanAudience(searchParams.get('role'));

  const setRole = useCallback(
    (next: PlanAudience) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_PLAN_AUDIENCE) params.delete('role');
      else params.set('role', next);
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return [role, setRole];
}

function useHorizontalSwipe(value: PlanAudience, onChange: (next: PlanAudience) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      onChange(nextPlanAudience(value, dx < 0 ? 1 : -1));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(nextPlanAudience(value, -1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(nextPlanAudience(value, 1));
    }
  };

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel: () => {
      start.current = null;
    },
    onKeyDown,
  };
}

export function PlanAudienceSelector({
  value,
  onChange,
  variant = 'app',
  children,
}: {
  value: PlanAudience;
  onChange: (next: PlanAudience) => void;
  variant?: 'landing' | 'app';
  children?: React.ReactNode;
}) {
  const swipe = useHorizontalSwipe(value, onChange);
  const landing = variant === 'landing';

  return (
    <div
      className={landing ? 'lp-audience' : 'mt-6'}
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    >
      <div
        className={landing ? 'lp-audience-pills' : 'flex flex-wrap gap-2'}
        role="radiogroup"
        aria-label="Who these plans are for"
        tabIndex={0}
        onKeyDown={swipe.onKeyDown}
      >
        {PLAN_AUDIENCE_OPTIONS.map((opt) => {
          const on = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={
                landing
                  ? `lp-audience-pill${on ? ' is-on' : ''}`
                  : `px-3.5 py-2 rounded-full text-sm font-semibold border transition-colors ${
                      on
                        ? 'bg-[var(--gold)] text-[#111827] border-[var(--gold)]'
                        : 'bg-transparent text-[var(--text2)] border-[var(--border)] hover:border-[var(--gold)]'
                    }`
              }
              onClick={() => onChange(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className={landing ? 'lp-sr' : 'sr-only'} aria-live="polite">
        Showing plans for {PLAN_AUDIENCE_OPTIONS.find((a) => a.id === value)?.label}.
      </p>
      {children}
    </div>
  );
}
