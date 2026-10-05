'use client';

import React, { useEffect, useRef } from 'react';
import { ManualPdfViewer } from '@/components/ManualPdfViewer';
import type { CitedManual } from '@/components/useAssistantCitationOpen';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Secure manual viewer beside (or over) an assistant answer.
 * Same ManualPdfViewer as /manuals/view?page=, without leaving the thread.
 */
export function AssistantCitedManual({
  cited,
  presentation,
  onClose,
}: {
  cited: CitedManual;
  presentation: 'panel' | 'fullscreen';
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const fullscreen = presentation === 'fullscreen';

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const id = window.requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [presentation]);

  useEffect(() => {
    if (fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, onClose]);

  function trapTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!fullscreen || event.key !== 'Tab') return;
    const root = panelRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={panelRef}
      className={`ai-cite-panel ${fullscreen ? 'is-fullscreen' : 'is-docked'}`}
      role="dialog"
      aria-modal={fullscreen ? true : undefined}
      aria-label={fullscreen ? 'Cited manual, full screen' : 'Cited manual'}
      tabIndex={-1}
      data-testid="cited-manual-panel"
      onKeyDown={trapTab}
    >
      <div className="ai-cite-panel-bar">
        <button
          ref={closeBtnRef}
          type="button"
          className="ai-cite-panel-back"
          onClick={onClose}
          data-testid={fullscreen ? 'back-to-answer' : 'close-cited-manual'}
        >
          {fullscreen ? '← Back to answer' : 'Close'}
        </button>
        <div className="ai-cite-panel-title">
          <span className="truncate">{cited.title || 'Service manual'}</span>
          <span className="ai-cite-panel-page">p.{cited.page}</span>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Opened {cited.title || 'service manual'}, page {cited.page}.
      </p>
      <div className="ai-cite-panel-viewer">
        <ManualPdfViewer
          key={cited.manualId}
          embedded
          manualId={String(cited.manualId)}
          title={cited.title}
          initialPage={cited.page}
        />
      </div>
    </div>
  );
}
