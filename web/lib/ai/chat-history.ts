/**
 * Shared AI chat persistence for /ai-assistant and the manual viewer rail.
 * Same user+org key as the existing web assistant — do not invent a second store.
 */

import type { ManualCitation } from './citations';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: ManualCitation[];
  ts?: number;
};

export type ManualThread = {
  msgs: ChatMessage[];
  ts: number;
};

export type StoredAiState = {
  msgs: ChatMessage[];
  manual?: string;
  manualId?: number | null;
  mfr?: string;
  userId?: string;
  orgId?: string | null;
  ts?: number;
  byManual?: Record<string, ManualThread>;
};

/** Legacy unscoped key — do not restore across accounts/orgs */
export const LEGACY_STORAGE_KEY = 'tsp_ai_web_v1';

export function storageKeyFor(userId: string, orgId: string | number | null | undefined): string {
  return `tsp_ai_web_v1:u:${userId}:o:${orgId != null && orgId !== '' ? String(orgId) : 'none'}`;
}

function asThreadMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
    .map((m) => {
      const row = m as ChatMessage;
      const next: ChatMessage = { role: row.role, content: String(row.content ?? '') };
      if (Array.isArray(row.citations) && row.citations.length) next.citations = row.citations;
      if (typeof row.ts === 'number') next.ts = row.ts;
      return next;
    });
}

export function emptyAiState(): StoredAiState {
  return { msgs: [], byManual: {} };
}

export function readAiState(userId: string, orgId: string | number | null | undefined): StoredAiState {
  if (typeof localStorage === 'undefined' || !userId) return emptyAiState();
  const key = storageKeyFor(userId, orgId);
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyAiState();
    const s = JSON.parse(raw) as StoredAiState;
    const blobUser = s.userId != null ? String(s.userId) : null;
    const blobOrg = s.orgId != null ? String(s.orgId) : null;
    const wantUser = String(userId);
    const wantOrg = orgId != null && orgId !== '' ? String(orgId) : null;
    const okUser = !blobUser || blobUser === wantUser;
    const okOrg = !blobOrg || blobOrg === wantOrg;
    if (!okUser || !okOrg) return emptyAiState();
    const byManual: Record<string, ManualThread> = {};
    if (s.byManual && typeof s.byManual === 'object') {
      for (const [id, thread] of Object.entries(s.byManual)) {
        if (!thread || typeof thread !== 'object') continue;
        byManual[id] = { msgs: asThreadMessages(thread.msgs).slice(-40), ts: Number(thread.ts) || Date.now() };
      }
    }
    return {
      msgs: asThreadMessages(s.msgs).slice(-40),
      manual: s.manual ? String(s.manual) : '',
      manualId: s.manualId ?? null,
      mfr: s.mfr ? String(s.mfr) : '',
      userId,
      orgId: orgId != null ? String(orgId) : null,
      ts: s.ts,
      byManual,
    };
  } catch {
    return emptyAiState();
  }
}

export function writeAiState(
  userId: string,
  orgId: string | number | null | undefined,
  next: StoredAiState
): void {
  if (typeof localStorage === 'undefined' || !userId) return;
  const key = storageKeyFor(userId, orgId);
  try {
    const payload: StoredAiState = {
      msgs: (next.msgs || []).slice(-40),
      manual: next.manual || '',
      manualId: next.manualId ?? null,
      mfr: next.mfr || '',
      userId,
      orgId: orgId != null ? String(orgId) : null,
      ts: Date.now(),
      byManual: next.byManual || {},
    };
    localStorage.setItem(key, JSON.stringify(payload));
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    /* quota */
  }
}

export function messagesForManual(state: StoredAiState, manualId: number | null | undefined): ChatMessage[] {
  if (manualId == null) return [];
  const thread = state.byManual?.[String(manualId)];
  if (thread?.msgs?.length) return thread.msgs;
  if (state.manualId === manualId && state.msgs?.length) return state.msgs;
  return [];
}

/** Persist a per-manual thread and, when it is the active assistant book, the main msgs too. */
export function upsertManualThread(
  state: StoredAiState,
  opts: {
    manualId: number | null;
    manualPath?: string;
    brand?: string;
    msgs: ChatMessage[];
    touchMain?: boolean;
  }
): StoredAiState {
  const byManual = { ...(state.byManual || {}) };
  if (opts.manualId != null) {
    byManual[String(opts.manualId)] = { msgs: opts.msgs.slice(-40), ts: Date.now() };
  }
  const touchMain =
    opts.touchMain !== false &&
    (opts.manualId == null || state.manualId == null || state.manualId === opts.manualId);
  return {
    ...state,
    msgs: touchMain ? opts.msgs.slice(-40) : state.msgs,
    manual: touchMain ? opts.manualPath ?? state.manual : state.manual,
    manualId: touchMain ? opts.manualId ?? state.manualId : state.manualId,
    mfr: touchMain ? opts.brand ?? state.mfr : state.mfr,
    byManual,
    ts: Date.now(),
  };
}
