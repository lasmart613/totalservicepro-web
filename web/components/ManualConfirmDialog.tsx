'use client';

import React, { useEffect, useId, useRef } from 'react';
import { useT } from '@/lib/fa/locale';
import { ADD_CONFIRM_ARM_MS, addConfirmArmed } from '@/lib/manual-library-refund';

/**
 * In-app confirm used by /manuals for "Add to company library" and
 * "Remove from company library" (replaces window.confirm).
 *
 * Safety against accidental accepts (double click, Enter key):
 *   - Cancel has focus when the dialog opens.
 *   - Enter never accepts: on the accept button it is swallowed; on Cancel it cancels.
 *   - The accept button ignores clicks for ADD_CONFIRM_ARM_MS after opening.
 *   - Esc and a click on the backdrop cancel (backdrop clicks are ignored for
 *     the first ADD_CONFIRM_ARM_MS too, so a double click cannot flicker it).
 * Accessible: role="dialog", aria-modal, labelled and described, focus trapped
 * between the two buttons, focus restored to the opener on close.
 */
export function ManualConfirmDialog({
  open,
  title,
  body,
  detail,
  acceptLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onAccept,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  detail?: string | null;
  acceptLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const openedAt = useRef(0);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!open) return;
    done.current = false;
    openedAt.current = Date.now();
    restoreFocus.current = (document.activeElement as HTMLElement) || null;
    cancelRef.current?.focus();
    return () => {
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const accept = () => {
    if (done.current) return;
    if (!addConfirmArmed(openedAt.current, Date.now(), ADD_CONFIRM_ARM_MS)) return;
    done.current = true;
    onAccept();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      // Enter never accepts. On Cancel (the default focus) it cancels.
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement === cancelRef.current) cancel();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const next = document.activeElement === cancelRef.current ? acceptRef.current : cancelRef.current;
      next?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4"
      data-testid="manual-confirm-backdrop"
      onMouseDown={(e) => {
        // The second click of a double click lands here: ignore it while unarmed.
        if (e.target !== e.currentTarget) return;
        if (!addConfirmArmed(openedAt.current, Date.now(), ADD_CONFIRM_ARM_MS)) return;
        cancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="manual-confirm-dialog"
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-xl border border-[#374151] bg-[#111827] p-5 text-[#E5E7EB] shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-[var(--gold,#FBBF24)]">
          {title}
        </h2>
        <p id={bodyId} className="mt-3 text-sm leading-relaxed">
          {body}
        </p>
        {detail ? <p className="mt-2 text-xs text-[#9CA3AF]">{detail}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            data-testid="manual-confirm-cancel"
            onClick={cancel}
            className="btn text-sm px-4 py-2 border border-[#4B5563] bg-[#1F2937] focus:outline focus:outline-2 focus:outline-[var(--gold,#FBBF24)]"
          >
            {t(cancelLabel)}
          </button>
          <button
            ref={acceptRef}
            type="button"
            data-testid="manual-confirm-accept"
            onClick={accept}
            className={`btn text-sm px-4 py-2 focus:outline focus:outline-2 focus:outline-white ${
              destructive ? 'bg-red-700 text-white' : 'btn-primary'
            }`}
          >
            {t(acceptLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
