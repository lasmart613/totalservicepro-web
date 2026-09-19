'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { type ChatMessage, fetchAiUsage, grokChat, type AiUsage } from '@/lib/ai/grok-client';
import { asManualId, buildGrokChatPayload } from '@/lib/ai/manual-scope';
import {
  messagesForManual,
  readAiState,
  upsertManualThread,
  writeAiState,
} from '@/lib/ai/chat-history';
import { formatAssistantHtml, formatUserHtml, mergeCitations, parseCitationMarkers } from '@/lib/ai/citations';
import { canAccessRepairAi } from '@/lib/roles';

type Props = {
  manualId?: string | number | null;
  title?: string | null;
  storagePath?: string | null;
  brand?: string | null;
};

function defaultUsage(): AiUsage {
  return { text: { used: 0, limit: 5 }, voice: { used: 0, limit: 1 }, tier: 'free' };
}

export function ViewerAiPanel({ manualId, title, storagePath, brand }: Props) {
  const supabase = getSupabaseClient();
  const scopedId = asManualId(manualId);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<AiUsage>(defaultUsage());
  const [error, setError] = useState('');

  const persist = useCallback(
    (msgs: ChatMessage[]) => {
      if (!userId || scopedId == null) return;
      const prev = readAiState(userId, orgId);
      const next = upsertManualThread(prev, {
        manualId: scopedId,
        manualPath: storagePath || prev.manual || '',
        brand: brand || prev.mfr || '',
        msgs,
        touchMain: prev.manualId == null || prev.manualId === scopedId,
      });
      writeAiState(userId, orgId, next);
    },
    [userId, orgId, scopedId, storagePath, brand]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || !session.user?.id) {
        if (!cancelled) setReady(true);
        return;
      }
      let resolvedOrg: string | number | null = null;
      let ok = false;
      try {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('role, organization_id, organizations(type)')
          .eq('id', session.user.id)
          .maybeSingle();
        const orgType =
          (prof?.organizations as { type?: string } | null)?.type ||
          session.user.user_metadata?.organization_type ||
          null;
        ok = canAccessRepairAi(prof?.role, orgType);
        resolvedOrg = prof?.organization_id ?? null;
      } catch {
        ok = false;
      }
      if (cancelled) return;
      setToken(session.access_token);
      setUserId(session.user.id);
      setOrgId(resolvedOrg);
      setAllowed(ok);
      if (ok) {
        const state = readAiState(session.user.id, resolvedOrg);
        setMessages(messagesForManual(state, scopedId));
        const u = await fetchAiUsage(session.access_token);
        if (!cancelled && u) setUsage(u);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, scopedId]);

  const assistantHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (scopedId != null) qs.set('manualId', String(scopedId));
    return qs.toString() ? `/ai-assistant?${qs.toString()}` : '/ai-assistant';
  }, [scopedId]);

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || !token || scopedId == null) return;
    if (usage.text.used >= usage.text.limit) {
      setError(`Daily text limit reached (${usage.text.used}/${usage.text.limit}).`);
      return;
    }
    const nextMsgs: ChatMessage[] = [...messages, { role: 'user', content: trimmed, ts: Date.now() }];
    setMessages(nextMsgs);
    setInput('');
    setSending(true);
    setError('');
    persist(nextMsgs);

    const payload = buildGrokChatPayload({
      messages: nextMsgs,
      manualId: scopedId,
      manualPath: storagePath || '',
    });
    const result = await grokChat({
      accessToken: token,
      messages: payload.messages,
      manualPath: payload.manualPath,
      manualId: payload.manualId,
      scopeChanged: payload.scopeChanged,
    });
    if (!result.ok) {
      if (result.status === 429) {
        setError(result.message || 'Daily limit reached');
        if (result.usage) setUsage((u) => ({ ...u, ...result.usage }));
      } else {
        setError(result.error || 'AI request failed');
      }
      setSending(false);
      return;
    }
    const citations = mergeCitations(result.citations, parseCitationMarkers(result.content));
    const withReply: ChatMessage[] = [
      ...nextMsgs,
      { role: 'assistant', content: result.content, citations, ts: Date.now() },
    ];
    setMessages(withReply);
    persist(withReply);
    if (result.usage) {
      setUsage((u) => ({
        text: result.usage!.text || u.text,
        voice: result.usage!.voice || u.voice,
        tier: result.usage!.tier || u.tier,
      }));
    }
    setSending(false);
  }

  if (!ready) {
    return <p className="viewer-ai-note">Loading AI…</p>;
  }
  if (scopedId == null) {
    return (
      <p className="viewer-ai-note">
        Open a library manual to ask AI about this book. Fixture/demo PDFs stay local.
      </p>
    );
  }
  if (!token) {
    return (
      <p className="viewer-ai-note">
        <Link href={`/login?next=${encodeURIComponent(`/manuals/view?id=${scopedId}`)}`} className="ai-cite-link">
          Sign in
        </Link>{' '}
        to ask about this manual.
      </p>
    );
  }
  if (!allowed) {
    return <p className="viewer-ai-note">Repair AI is for service companies.</p>;
  }

  const textLimitHit = usage.text.used >= usage.text.limit;
  const recent = messages.slice(-8);

  return (
    <div className="viewer-ai">
      <div className="viewer-ai-head">
        <span>Ask about this manual</span>
        <Link href={assistantHref} className="viewer-ai-jump">
          Jump from AI
        </Link>
      </div>
      <p className="viewer-ai-note">
        Soft beta · scoped to {title || 'this book'} · {usage.text.used}/{usage.text.limit} texts
      </p>
      <textarea
        className="viewer-ai-input"
        rows={3}
        placeholder="Ask about this page, PM, or a fault…"
        value={input}
        disabled={sending || textLimitHit}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void sendPrompt(input);
          }
        }}
      />
      <button
        type="button"
        className="viewer-ai-send"
        disabled={sending || textLimitHit || !input.trim()}
        onClick={() => void sendPrompt(input)}
      >
        {sending ? 'Thinking…' : 'Ask AI'}
      </button>
      {error && <p className="viewer-ai-error">{error}</p>}

      <div className="viewer-ai-hist-label">AI chat history</div>
      <div className="viewer-ai-hist" role="log" aria-label="AI chat history for this manual">
        {recent.length === 0 && <p className="viewer-ai-note">No questions yet for this manual.</p>}
        {recent.map((m, i) => (
          <div key={`${m.ts || i}-${m.role}`} className={`viewer-ai-msg ${m.role}`}>
            <div
              dangerouslySetInnerHTML={{
                __html: m.role === 'assistant' ? formatAssistantHtml(m.content, m.citations) : formatUserHtml(m.content),
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
