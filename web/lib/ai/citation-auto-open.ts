/**
 * Auto-open a cited manual page beside an AI Assistant answer.
 *
 * The viewer is the same auth-gated deep link as /manuals/view?id=&page=
 * (PR #134). This module decides whether to open, which citation, and how
 * the page is presented. It does not fetch PDF bytes.
 *
 * Native shells: see web/docs/assistant-citation-open.md.
 */

import {
  asPositivePage,
  attachProsePages,
  mergeCitations,
  parseCitationMarkers,
  stripCitationMarkers,
  type ManualCitation,
} from './citations.ts';
import { mayViewAiScopedManual } from '../manuals-access.ts';

export const AUTO_OPEN_CITED_MANUAL_KEY = 'autoOpenCitedManual';
/** Android/assistant settings blob. Voice prefs already live here. */
export const ASSISTANT_SETTINGS_BLOB_KEY = 'tsp_settings';

export const CITATION_OPEN_EVENT = 'assistant:citation-open';
export const CITATION_OPEN_REQUEST_EVENT = 'assistant:open-citation';
export const VOICE_STATE_EVENT = 'assistant:voice-state';
/** Native → web, or web → native after `TSP.setVoiceMode`. Detail `{ on: boolean }`. */
export const VOICE_MODE_EVENT = 'assistant:voice-mode';
/** Web → native once per fresh settled answer, before the auto-open hold is evaluated. */
export const ANSWER_EVENT = 'assistant:answer';

/** Wide web layout. Below this, and always inside the Android shell, use full screen. */
export const CITATION_PANEL_MIN_WIDTH = 1024;

export type CitationOpenDetail = {
  manualId: number;
  page: number;
};

export type AutoOpenDecision =
  | { action: 'open'; manualId: number; page: number }
  | { action: 'wait' }
  | { action: 'skip' };

export type TspCitationApi = {
  openCitation?: (manualId: number, page: number) => void;
  /** Native voice mode sets this while TTS is playing. */
  isVoiceSpeaking?: () => boolean;
  /** Session flag. Default off. Not persisted. While on, chat requests send `voiceMode: true`. */
  setVoiceMode?: (on: boolean) => void;
  getVoiceMode?: () => boolean;
  /**
   * Submit a question through the page's own send path.
   * Returns false when the page is not ready or a send is already in flight.
   */
  askAssistant?: (text: string) => boolean;
};

declare global {
  interface Window {
    TSP?: TspCitationApi;
    Android?: unknown;
  }
}

type SettingStorage = {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
};

function blobFlag(storage: SettingStorage): boolean | null {
  try {
    const raw = storage.getItem(ASSISTANT_SETTINGS_BLOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { autoOpenCitedManual?: unknown };
    const value = parsed?.autoOpenCitedManual;
    if (value === false || value === 'false') return false;
    if (value === true || value === 'true') return true;
    return null;
  } catch {
    return null;
  }
}

/**
 * Default ON. An explicit localStorage flag wins; otherwise the assistant
 * settings blob (`tsp_settings.autoOpenCitedManual`) is honored.
 */
export function readAutoOpenCitedManual(storage: SettingStorage | null | undefined): boolean {
  if (!storage) return true;
  try {
    const direct = storage.getItem(AUTO_OPEN_CITED_MANUAL_KEY);
    if (direct === 'false') return false;
    if (direct === 'true') return true;
    const fromBlob = blobFlag(storage);
    if (fromBlob != null) return fromBlob;
    return true;
  } catch {
    return true;
  }
}

const autoOpenListeners = new Set<() => void>();

/** Same-tab subscribers. `storage` events cover other tabs. */
export function subscribeAutoOpenCitedManual(onChange: () => void): () => void {
  autoOpenListeners.add(onChange);
  if (typeof window === 'undefined') {
    return () => {
      autoOpenListeners.delete(onChange);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (
      event.key == null ||
      event.key === AUTO_OPEN_CITED_MANUAL_KEY ||
      event.key === ASSISTANT_SETTINGS_BLOB_KEY
    ) {
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    autoOpenListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function notifyAutoOpenCitedManual(): void {
  autoOpenListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* listener */
    }
  });
}

export function writeAutoOpenCitedManual(storage: SettingStorage, enabled: boolean): void {
  try {
    storage.setItem?.(AUTO_OPEN_CITED_MANUAL_KEY, enabled ? 'true' : 'false');
  } catch {
    /* private mode / quota */
  }
  try {
    const raw = storage.getItem(ASSISTANT_SETTINGS_BLOB_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    parsed.autoOpenCitedManual = enabled;
    storage.setItem?.(ASSISTANT_SETTINGS_BLOB_KEY, JSON.stringify(parsed));
  } catch {
    /* keep the dedicated key even if the blob is unreadable */
  }
  notifyAutoOpenCitedManual();
}

export function normalizeCitationTarget(manualId: unknown, page: unknown): CitationOpenDetail | null {
  const id = typeof manualId === 'number' ? manualId : Number(String(manualId ?? '').trim());
  const p = asPositivePage(page);
  if (!Number.isSafeInteger(id) || id < 1 || !p) return null;
  return { manualId: id, page: p };
}

export function parseCitationOpenDetail(detail: unknown): CitationOpenDetail | null {
  if (!detail || typeof detail !== 'object') return null;
  const row = detail as { manualId?: unknown; page?: unknown };
  return normalizeCitationTarget(row.manualId, row.page);
}

/**
 * Only the first displayed citation may auto-open, and only when that
 * citation already has a real manual id and physical page. A later chip
 * is not promoted when the first one is section-only or page-less.
 */
export function autoOpenTarget(citations: ManualCitation[] | null | undefined): CitationOpenDetail | null {
  const first = (citations || [])[0];
  if (!first) return null;
  return normalizeCitationTarget(first.manualId, first.page);
}

/** Same citation list the assistant chips render. */
export function autoOpenTargetFromReply(reply: {
  content?: string;
  citations?: ManualCitation[] | null;
}): CitationOpenDetail | null {
  const citations = attachProsePages(
    mergeCitations(reply.citations, parseCitationMarkers(reply.content || '')),
    stripCitationMarkers(reply.content || '')
  );
  return autoOpenTarget(citations);
}

/**
 * Once per fresh, settled answer.
 * - history / re-render: fresh false, or alreadyOpened
 * - streaming partial: settled false → wait, do not consume the answer
 * - voice still speaking: wait
 * - setting off, no page, or access denied: skip (do not open later for this answer)
 */
export function planCitationAutoOpen(input: {
  enabled: boolean;
  fresh: boolean;
  alreadyOpened: boolean;
  settled: boolean;
  speaking: boolean;
  citation: CitationOpenDetail | null;
  canView: boolean;
}): AutoOpenDecision {
  if (!input.fresh || input.alreadyOpened) return { action: 'skip' };
  if (!input.enabled) return { action: 'skip' };
  if (!input.citation || !input.canView) return { action: 'skip' };
  if (!input.settled || input.speaking) return { action: 'wait' };
  return { action: 'open', manualId: input.citation.manualId, page: input.citation.page };
}

/**
 * Client-side gate before the viewer is mounted. Unknown manuals and
 * non-catalog paths the user does not already have in their library are
 * refused so auto-open never requests restricted bytes. The chip link
 * stays as it is today; the viewer page enforces the same rule server-side.
 */
export function citationAutoOpenAllowed(opts: {
  role?: string | null;
  orgType?: string | null;
  storagePath?: string | null;
  inLibrary?: boolean;
  catalogKnown: boolean;
}): boolean {
  if (!opts.catalogKnown) return false;
  const storagePath = String(opts.storagePath || '').trim();
  if (!storagePath) return false;
  return mayViewAiScopedManual({
    role: opts.role,
    orgType: opts.orgType,
    storagePath,
    inLibrary: opts.inLibrary === true,
  });
}

export type VoiceSpeakingSource = {
  TSP?: { isVoiceSpeaking?: () => boolean };
  speechSynthesis?: { speaking?: boolean };
  document?: { documentElement?: { dataset?: { assistantVoice?: string } } };
};

export function readVoiceSpeaking(src: VoiceSpeakingSource | null | undefined): boolean {
  if (!src) return false;
  try {
    if (typeof src.TSP?.isVoiceSpeaking === 'function' && src.TSP.isVoiceSpeaking()) return true;
  } catch {
    /* native bridge threw */
  }
  if (src.speechSynthesis?.speaking) return true;
  if (src.document?.documentElement?.dataset?.assistantVoice === 'speaking') return true;
  return false;
}

export function parseVoiceSpeakingDetail(detail: unknown): boolean | null {
  if (!detail || typeof detail !== 'object') return null;
  const speaking = (detail as { speaking?: unknown }).speaking;
  return typeof speaking === 'boolean' ? speaking : null;
}

export function citationOpenPresentation(opts: {
  viewportWidth: number;
  userAgent?: string | null;
  androidShell?: boolean;
}): 'panel' | 'fullscreen' {
  if (opts.androidShell) return 'fullscreen';
  if (opts.userAgent && /TSPAndroid/i.test(opts.userAgent)) return 'fullscreen';
  if (!Number.isFinite(opts.viewportWidth) || opts.viewportWidth < CITATION_PANEL_MIN_WIDTH) {
    return 'fullscreen';
  }
  return 'panel';
}

export function dispatchCitationOpen(target: EventTarget, detail: CitationOpenDetail): void {
  const safe = normalizeCitationTarget(detail.manualId, detail.page);
  if (!safe) return;
  target.dispatchEvent(new CustomEvent(CITATION_OPEN_EVENT, { detail: { ...safe } }));
}

/** In-memory only. A reload starts off. Native calls `setVoiceMode(false)` when leaving voice. */
let voiceModeOn = false;

export function getVoiceMode(): boolean {
  return voiceModeOn;
}

export function setVoiceMode(on: boolean): boolean {
  voiceModeOn = on === true;
  return voiceModeOn;
}

export function parseVoiceModeDetail(detail: unknown): boolean | null {
  if (!detail || typeof detail !== 'object') return null;
  const on = (detail as { on?: unknown }).on;
  return typeof on === 'boolean' ? on : null;
}

export function dispatchVoiceMode(target: EventTarget, on: boolean): void {
  target.dispatchEvent(new CustomEvent(VOICE_MODE_EVENT, { detail: { on: on === true } }));
}

export function canAskAssistant(opts: {
  ready: boolean;
  sending: boolean;
  hasToken: boolean;
  text: unknown;
}): boolean {
  return (
    opts.ready === true &&
    opts.sending !== true &&
    opts.hasToken === true &&
    String(opts.text ?? '').trim().length > 0
  );
}

/** Plain text for native TTS: citation tokens and light markdown removed. */
export function spokenAnswerText(content: string): string {
  let text = stripCitationMarkers(content);
  text = text.replace(/\[\[pdfpage:\d+\]\]/gi, '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return text;
}

/** Every cited physical page on the answer, in chip order. */
export function assistantCitationPairs(reply: {
  content?: string;
  citations?: ManualCitation[] | null;
}): CitationOpenDetail[] {
  const citations = attachProsePages(
    mergeCitations(reply.citations, parseCitationMarkers(reply.content || '')),
    stripCitationMarkers(reply.content || '')
  );
  const pairs: CitationOpenDetail[] = [];
  for (const cite of citations) {
    const target = normalizeCitationTarget(cite.manualId, cite.page);
    if (target) pairs.push(target);
  }
  return pairs;
}

export type AssistantAnswerDetail = {
  ts: number;
  text: string;
  citations: CitationOpenDetail[];
  top: CitationOpenDetail | null;
  voiceMode: boolean;
};

export function buildAssistantAnswerDetail(input: {
  ts: number;
  content: string;
  citations?: ManualCitation[] | null;
  voiceMode: boolean;
}): AssistantAnswerDetail | null {
  if (!Number.isFinite(input.ts)) return null;
  const reply = { content: input.content, citations: input.citations };
  return {
    ts: input.ts,
    text: spokenAnswerText(input.content),
    citations: assistantCitationPairs(reply),
    top: autoOpenTargetFromReply(reply),
    voiceMode: input.voiceMode === true,
  };
}

export function dispatchAssistantAnswer(target: EventTarget, detail: AssistantAnswerDetail): void {
  target.dispatchEvent(
    new CustomEvent(ANSWER_EVENT, {
      detail: {
        ts: detail.ts,
        text: detail.text,
        citations: detail.citations.map((cite) => ({ manualId: cite.manualId, page: cite.page })),
        top: detail.top ? { manualId: detail.top.manualId, page: detail.top.page } : null,
        voiceMode: detail.voiceMode === true,
      },
    })
  );
}

export type AnswerTurnState = {
  pendingKey: string | null;
  announcedKeys: string[];
  openedKeys: string[];
};

export function emptyAnswerTurn(): AnswerTurnState {
  return { pendingKey: null, announcedKeys: [], openedKeys: [] };
}

export function markAnswerFresh(state: AnswerTurnState, key: string): AnswerTurnState {
  if (!key) return state;
  return { ...state, pendingKey: key };
}

/**
 * Announce once, only for the fresh key, and only after the reply has settled.
 * History never calls `markAnswerFresh`, so a reload cannot announce.
 */
export function onAnswerSettled(
  state: AnswerTurnState,
  key: string,
  settled: boolean
): { state: AnswerTurnState; announce: boolean } {
  if (!settled || !key || state.pendingKey !== key || state.announcedKeys.includes(key)) {
    return { state, announce: false };
  }
  return {
    state: { ...state, announcedKeys: [...state.announcedKeys, key] },
    announce: true,
  };
}

/**
 * Inbound `openCitation` / Back / Close consumes the pending auto-open.
 * A later voice-idle must not open the viewer again for this answer.
 */
export function onViewerTakenOver(state: AnswerTurnState): AnswerTurnState {
  const key = state.pendingKey;
  if (!key) return state;
  if (state.openedKeys.includes(key)) return { ...state, pendingKey: null };
  return { ...state, pendingKey: null, openedKeys: [...state.openedKeys, key] };
}

/**
 * After the answer event. `speaking` keeps the pending key (voice hold).
 * `canOpen` false consumes it (setting off, no page, or no access).
 */
export function autoOpenAfterVoice(
  state: AnswerTurnState,
  speaking: boolean,
  canOpen: boolean
): { state: AnswerTurnState; open: boolean } {
  const key = state.pendingKey;
  if (!key) return { state, open: false };
  if (state.openedKeys.includes(key)) return { state: { ...state, pendingKey: null }, open: false };
  if (speaking) return { state, open: false };
  const openedKeys = [...state.openedKeys, key];
  return {
    state: { ...state, pendingKey: null, openedKeys },
    open: canOpen,
  };
}

const announcedAnswerKeys = new Set<string>();

/** Survives a strict-mode remount so one fresh answer dispatches `assistant:answer` once. */
export function claimAnswerAnnouncement(key: string): boolean {
  if (!key || announcedAnswerKeys.has(key)) return false;
  announcedAnswerKeys.add(key);
  return true;
}
