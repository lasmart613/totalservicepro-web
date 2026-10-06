'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react';
import type { ManualCitation } from '@/lib/ai/citations';
import { catalogManualTitle } from '@/lib/manual-catalog';
import { asManualId } from '@/lib/ai/manual-scope';
import {
  CITATION_OPEN_REQUEST_EVENT,
  VOICE_MODE_EVENT,
  VOICE_STATE_EVENT,
  autoOpenAfterVoice,
  autoOpenTargetFromReply,
  buildAssistantAnswerDetail,
  claimAnswerAnnouncement,
  citationAutoOpenAllowed,
  citationOpenPresentation,
  dispatchAssistantAnswer,
  dispatchCitationOpen,
  dispatchVoiceMode,
  emptyAnswerTurn,
  getVoiceMode,
  markAnswerFresh,
  onViewerTakenOver,
  parseCitationOpenDetail,
  parseVoiceModeDetail,
  parseVoiceSpeakingDetail,
  planCitationAutoOpen,
  readAutoOpenCitedManual,
  readVoiceSpeaking,
  setVoiceMode,
  subscribeAutoOpenCitedManual,
  writeAutoOpenCitedManual,
  type AnswerTurnState,
  type CitationOpenDetail,
} from '@/lib/ai/citation-auto-open';

export type CitedManual = CitationOpenDetail & { title?: string };

type ManualOption = {
  id: number;
  title: string;
  storage_path: string;
  brand?: string | null;
  model?: string | null;
};

type ReplyMessage = {
  role: string;
  content: string;
  citations?: ManualCitation[];
  ts?: number;
};

function currentPresentation(): 'panel' | 'fullscreen' {
  if (typeof window === 'undefined') return 'fullscreen';
  return citationOpenPresentation({
    viewportWidth: window.innerWidth,
    userAgent: navigator.userAgent,
    androidShell: typeof window.Android !== 'undefined',
  });
}

/** Shared with Settings. Default ON until the device store says otherwise. */
export function useAutoOpenCitedManual(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribeAutoOpenCitedManual,
    () => readAutoOpenCitedManual(window.localStorage),
    () => true
  );
  const setEnabled = useCallback((next: boolean) => {
    writeAutoOpenCitedManual(window.localStorage, next);
  }, []);
  return [enabled, setEnabled];
}

/**
 * Opens the secure manual viewer next to a fresh assistant answer.
 * History restores never call `markFresh`, so they cannot auto-open.
 * Inbound `assistant:open-citation` / `TSP.openCitation` do not re-dispatch
 * `assistant:citation-open`.
 */
export function useAssistantCitationOpen(opts: {
  messages: ReplyMessage[];
  sending: boolean;
  ready: boolean;
  manuals: ManualOption[];
  caller: { role: string | null; orgType: string | null };
  listRef: RefObject<HTMLDivElement | null>;
  /** Page send path. Returns false when a send cannot start. */
  askAssistant: (text: string) => boolean;
}) {
  const { messages, sending, ready, manuals, caller, listRef } = opts;
  const [autoOpen, setAutoOpen] = useAutoOpenCitedManual();
  const [open, setOpen] = useState(false);
  const [cited, setCited] = useState<CitedManual | null>(null);
  const [presentation, setPresentation] = useState<'panel' | 'fullscreen'>('panel');
  const [speaking, setSpeaking] = useState(false);
  const [voiceEpoch, setVoiceEpoch] = useState(0);

  const turnRef = useRef<AnswerTurnState>(emptyAnswerTurn());
  const speakingRef = useRef(false);
  const askRef = useRef(opts.askAssistant);
  const scrollSnapshotRef = useRef(0);
  const presentationRef = useRef(presentation);
  const manualsRef = useRef(manuals);
  const callerRef = useRef(caller);

  useEffect(() => {
    presentationRef.current = presentation;
    manualsRef.current = manuals;
    callerRef.current = caller;
    askRef.current = opts.askAssistant;
  });

  const lookup = useCallback((manualId: number) => {
    return manualsRef.current.find((row) => asManualId(row.id) === manualId) || null;
  }, []);

  const allowed = useCallback(
    (manualId: number) => {
      const row = lookup(manualId);
      return citationAutoOpenAllowed({
        role: callerRef.current.role,
        orgType: callerRef.current.orgType,
        storagePath: row?.storage_path,
        catalogKnown: !!row,
      });
    },
    [lookup]
  );

  const openCited = useCallback(
    (detail: CitedManual, announce: boolean) => {
      turnRef.current = onViewerTakenOver(turnRef.current);
      const nextPresentation = currentPresentation();
      if (nextPresentation === 'fullscreen') {
        scrollSnapshotRef.current = listRef.current?.scrollTop ?? 0;
      }
      setPresentation(nextPresentation);
      setCited(detail);
      setOpen(true);
      if (announce) {
        dispatchCitationOpen(window, { manualId: detail.manualId, page: detail.page });
      }
    },
    [listRef]
  );
  const openCitedRef = useRef(openCited);
  useEffect(() => {
    openCitedRef.current = openCited;
  });

  const consumePendingAutoOpen = useCallback(() => {
    turnRef.current = onViewerTakenOver(turnRef.current);
  }, []);

  const close = useCallback(() => {
    consumePendingAutoOpen();
    const top = scrollSnapshotRef.current;
    const wasFullscreen = presentationRef.current === 'fullscreen';
    setOpen(false);
    if (!wasFullscreen) return;
    window.requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = top;
    });
  }, [consumePendingAutoOpen, listRef]);

  const toggleAutoOpen = useCallback(() => {
    setAutoOpen(!autoOpen);
  }, [autoOpen, setAutoOpen]);

  const markFresh = useCallback((answerKey: string) => {
    turnRef.current = markAnswerFresh(turnRef.current, answerKey);
  }, []);

  const cancelPending = useCallback(() => {
    consumePendingAutoOpen();
  }, [consumePendingAutoOpen]);

  useEffect(() => {
    if (!ready || sending) return;
    const key = turnRef.current.pendingKey;
    if (!key) return;
    const msg = [...messages].reverse().find((row) => row.role === 'assistant' && String(row.ts ?? '') === key);
    if (!msg) return;

    const announced = onAnswerSettled(turnRef.current, key, true);
    turnRef.current = announced.state;
    if (announced.announce && claimAnswerAnnouncement(key)) {
      const detail = buildAssistantAnswerDetail({
        ts: typeof msg.ts === 'number' ? msg.ts : Number(key),
        content: msg.content,
        citations: msg.citations,
        voiceMode: getVoiceMode(),
      });
      if (detail) dispatchAssistantAnswer(window, detail);
    }

    const speakingNow = speakingRef.current || speaking || readVoiceSpeaking(window);
    const citation = autoOpenTargetFromReply(msg);
    const row = citation ? lookup(citation.manualId) : null;
    const decision = planCitationAutoOpen({
      enabled: autoOpen,
      fresh: true,
      alreadyOpened: turnRef.current.openedKeys.includes(key),
      settled: true,
      speaking: speakingNow,
      citation,
      canView: citation ? allowed(citation.manualId) : false,
    });
    if (decision.action === 'wait') return;
    if (decision.action === 'skip') {
      turnRef.current = autoOpenAfterVoice(turnRef.current, false, false).state;
      return;
    }
    const title = row ? catalogManualTitle(row) : undefined;
    let inner = 0;
    let cancelled = false;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (turnRef.current.pendingKey !== key) return;
        const finished = autoOpenAfterVoice(turnRef.current, false, true);
        turnRef.current = finished.state;
        if (!finished.open) return;
        openCitedRef.current({ manualId: decision.manualId, page: decision.page, title }, true);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outer);
      if (inner) window.cancelAnimationFrame(inner);
    };
  }, [allowed, autoOpen, lookup, messages, ready, sending, speaking, voiceEpoch]);

  useEffect(() => {
    function tryOpen(manualId: unknown, page: unknown) {
      const target = parseCitationOpenDetail({ manualId, page });
      if (!target || !allowed(target.manualId)) return;
      turnRef.current = onViewerTakenOver(turnRef.current);
      const row = lookup(target.manualId);
      openCitedRef.current(
        { ...target, title: row ? catalogManualTitle(row) : undefined },
        false
      );
    }

    const previousOpen = window.TSP?.openCitation;
    const previousSetVoice = window.TSP?.setVoiceMode;
    const previousGetVoice = window.TSP?.getVoiceMode;
    const previousAsk = window.TSP?.askAssistant;
    if (!window.TSP) window.TSP = {};
    window.TSP.openCitation = (manualId: number, page: number) => tryOpen(manualId, page);
    window.TSP.setVoiceMode = (on: boolean) => {
      dispatchVoiceMode(window, setVoiceMode(on));
    };
    window.TSP.getVoiceMode = () => getVoiceMode();
    window.TSP.askAssistant = (text: string) => {
      try {
        return askRef.current(text) === true;
      } catch {
        return false;
      }
    };

    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      const row = detail as { manualId?: unknown; page?: unknown };
      tryOpen(row.manualId, row.page);
    };
    const onVoice = (event: Event) => {
      const next = parseVoiceSpeakingDetail((event as CustomEvent).detail);
      if (next == null) {
        setVoiceEpoch((n) => n + 1);
        return;
      }
      speakingRef.current = next;
      setSpeaking(next);
    };
    const onVoiceMode = (event: Event) => {
      const next = parseVoiceModeDetail((event as CustomEvent).detail);
      if (next == null || next === getVoiceMode()) return;
      setVoiceMode(next);
    };
    window.addEventListener(CITATION_OPEN_REQUEST_EVENT, onRequest);
    window.addEventListener(VOICE_STATE_EVENT, onVoice);
    window.addEventListener(VOICE_MODE_EVENT, onVoiceMode);
    const synth = window.speechSynthesis;
    const bump = () => setVoiceEpoch((n) => n + 1);
    synth?.addEventListener?.('end', bump);
    synth?.addEventListener?.('cancel', bump);

    return () => {
      window.removeEventListener(CITATION_OPEN_REQUEST_EVENT, onRequest);
      window.removeEventListener(VOICE_STATE_EVENT, onVoice);
      window.removeEventListener(VOICE_MODE_EVENT, onVoiceMode);
      synth?.removeEventListener?.('end', bump);
      synth?.removeEventListener?.('cancel', bump);
      if (!window.TSP) return;
      if (previousOpen) window.TSP.openCitation = previousOpen;
      else delete window.TSP.openCitation;
      if (previousSetVoice) window.TSP.setVoiceMode = previousSetVoice;
      else delete window.TSP.setVoiceMode;
      if (previousGetVoice) window.TSP.getVoiceMode = previousGetVoice;
      else delete window.TSP.getVoiceMode;
      if (previousAsk) window.TSP.askAssistant = previousAsk;
      else delete window.TSP.askAssistant;
    };
  }, [allowed, lookup]);

  useEffect(() => {
    if (!open) return;
    const apply = () => setPresentation(currentPresentation());
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [open]);

  const onThreadClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!autoOpen) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.('a.ai-cite-link');
      if (!anchor) return;
      const target = parseCitationOpenDetail({
        manualId: anchor.getAttribute('data-cite-manual'),
        page: anchor.getAttribute('data-cite-page'),
      });
      if (!target || !allowed(target.manualId)) return;
      event.preventDefault();
      const row = lookup(target.manualId);
      openCited({ ...target, title: row ? catalogManualTitle(row) : undefined }, false);
    },
    [allowed, autoOpen, lookup, openCited]
  );

  return {
    autoOpen,
    toggleAutoOpen,
    open: open && !!cited,
    cited,
    presentation,
    close,
    markFresh,
    cancelPending,
    onThreadClick,
  };
}
