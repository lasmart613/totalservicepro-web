'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  type AiUsage,
  type ChatMessage,
  fetchAiUsage,
  grokChat,
} from '@/lib/ai/grok-client';
import { asManualId, assistantManualPicker, buildGrokChatPayload } from '@/lib/ai/manual-scope';
import { fetchAllPages } from '@/lib/supabase/paginate';
import {
  LEGACY_STORAGE_KEY,
  messagesForManual,
  readAiState,
  upsertManualThread,
  writeAiState,
} from '@/lib/ai/chat-history';
import {
  citationViewerHref,
  formatAssistantHtml,
  formatUserHtml,
  mergeCitations,
  parseCitationMarkers,
} from '@/lib/ai/citations';
import { toast } from 'sonner';
import { catalogManualTitle } from '@/lib/manual-catalog';
import { manualLanguageBadge, resolveManualLanguage } from '@/lib/manual-language';
import { canAccessRepairAi } from '@/lib/roles';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { currentOrgPlanLabel, type OrgPlanFields } from '@/lib/org-plan';
import { ORG_PLAN_SELECTS } from '@/lib/org-plan-load';
import { AssistantCitedManual } from '@/components/AssistantCitedManual';
import { useAssistantCitationOpen } from '@/components/useAssistantCitationOpen';
import { canAskAssistant, getVoiceMode } from '@/lib/ai/citation-auto-open';

type ManualRow = {
  id: number;
  title: string;
  storage_path: string;
  brand: string | null;
  model?: string | null;
  language?: string | null;
};

const AI_MANUAL_SELECT = 'id,title,storage_path,brand,model,language';
const AI_MANUAL_SELECT_LEGACY = 'id,title,storage_path,brand,model';

function assistantManualOptionLabel(row: ManualRow): string {
  const title = catalogManualTitle(row);
  const badge = manualLanguageBadge(resolveManualLanguage(row));
  if (!badge) return title;
  if (new RegExp(`\\(${badge.label}\\)\\s*$`, 'i').test(title)) return title;
  return `${title} · ${badge.code}`;
}

const QUICK_CHIPS: { emoji: string; label: string; prompt: string }[] = [
  { emoji: '⚡', label: 'Fault codes', prompt: 'What are the most common fault codes for this system?' },
  { emoji: '🔧', label: 'Calibration', prompt: 'Walk me through the calibration procedure' },
  { emoji: '📋', label: 'PM steps', prompt: 'What preventive maintenance steps should I perform?' },
  { emoji: '🔩', label: 'Spare parts', prompt: 'What spare parts should I carry for this system?' },
  { emoji: '⚠️', label: 'Safety', prompt: 'What are the laser safety precautions?' },
];

function answerTimestamp(): number {
  return Date.now();
}

function defaultUsage(): AiUsage {
  return {
    text: { used: 0, limit: 5 },
    voice: { used: 0, limit: 5 },
    tier: 'free',
  };
}

export default function AIAssistantClient() {
  const t = useT();
  const router = useRouter();
  const siteLanguage = useSiteLocale();
  const supabase = getSupabaseClient();
  const listRef = useRef<HTMLDivElement | null>(null);
  const sendingRef = useRef(false);
  const sendPromptRef = useRef<(text: string) => boolean>(() => false);

  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | number | null>(null);
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [brand, setBrand] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [manualId, setManualId] = useState<number | null>(null);
  const lastSentRef = useRef<{ id: number | null; path: string }>({ id: null, path: '' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<AiUsage>(defaultUsage());
  const [limitBanner, setLimitBanner] = useState('');
  const [caller, setCaller] = useState<{ role: string | null; orgType: string | null }>({
    role: null,
    orgType: null,
  });
  const [planLabel, setPlanLabel] = useState<string | null>(null);

  const brands = useMemo(() => {
    const set = new Set<string>();
    manuals.forEach((m) => {
      if (m.brand) set.add(m.brand);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [manuals]);

  const manualsForBrand = useMemo(() => {
    if (!brand) return [];
    return manuals
      .filter((m) => m.brand === brand)
      .sort((a, b) => catalogManualTitle(a).localeCompare(catalogManualTitle(b)));
  }, [manuals, brand]);

  const selectedManual = useMemo(() => {
    if (manualId != null) {
      const byId = manuals.find((x) => asManualId(x.id) === manualId);
      if (byId) return byId;
    }
    return manuals.find((x) => x.storage_path === manualPath) || null;
  }, [manuals, manualId, manualPath]);

  const selectedManualLabel = useMemo(() => {
    return selectedManual
      ? `${selectedManual.brand || ''} · ${catalogManualTitle(selectedManual)}`.trim()
      : '';
  }, [selectedManual]);

  const saveState = useCallback(
    (msgs: ChatMessage[], path: string, mfr: string, id: number | null = null) => {
      if (!userId) return;
      const prev = readAiState(userId, orgId);
      const next = upsertManualThread(prev, {
        manualId: id,
        manualPath: path,
        brand: mfr,
        msgs,
        touchMain: true,
      });
      writeAiState(userId, orgId, next);
    },
    [userId, orgId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || !session.user?.id) {
        router.replace('/login?next=/ai-assistant');
        return;
      }
      if (cancelled) return;
      setToken(session.access_token);
      setUserId(session.user.id);

      // Resolve org for isolation — chat history must not cross organizations
      let resolvedOrg: string | number | null = null;
      let callerRole: string | null = null;
      let callerOrgType: string | null = null;
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
        callerRole = typeof prof?.role === 'string' ? prof.role : null;
        callerOrgType = orgType;
        if (!canAccessRepairAi(prof?.role, orgType)) {
          toast.error('Repair AI is for service companies.');
          router.replace('/hub');
          return;
        }
        resolvedOrg = prof?.organization_id ?? null;
      } catch {
        resolvedOrg = null;
      }
      if (cancelled) return;
      setOrgId(resolvedOrg);
      setCaller({ role: callerRole, orgType: callerOrgType });
      if (resolvedOrg != null) {
        let planRow: OrgPlanFields | null = null;
        for (const columns of ORG_PLAN_SELECTS) {
          const { data, error } = await supabase
            .from('organizations')
            .select(columns)
            .eq('id', resolvedOrg)
            .maybeSingle();
          if (!error) {
            planRow = (data as OrgPlanFields | null) || null;
            break;
          }
          if (!/subscription_tier|manual_slots|\bplan\b|premium_|column/i.test(error.message || '')) break;
        }
        if (!cancelled) setPlanLabel(currentOrgPlanLabel(planRow));
      }

      let urlManualId: number | null = null;
      let urlPrompt = '';
      try {
        const qs = new URLSearchParams(window.location.search);
        urlManualId = asManualId(qs.get('manualId') || qs.get('id'));
        urlPrompt = String(qs.get('q') || qs.get('prompt') || '').trim();
      } catch {
        /* ignore */
      }

      // Restore ONLY this user+org chat; never the legacy global key
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      const s = readAiState(session.user.id, resolvedOrg);
      const restoredId = urlManualId ?? asManualId(s.manualId);
      if (urlManualId != null) {
        const scoped = messagesForManual(s, urlManualId);
        setMessages(scoped);
        setManualId(urlManualId);
        lastSentRef.current = { id: urlManualId, path: '' };
      } else if (restoredId != null) {
        setMessages(messagesForManual(s, restoredId).length ? messagesForManual(s, restoredId) : s.msgs);
        setManualId(restoredId);
        const pathFromState = restoredId === asManualId(s.manualId) ? s.manual || '' : '';
        if (pathFromState) setManualPath(pathFromState);
        lastSentRef.current = { id: restoredId, path: pathFromState };
        if (s.mfr) setBrand(String(s.mfr));
      } else if (s.msgs.length) {
        setMessages(s.msgs);
        if (s.manual) setManualPath(String(s.manual));
        if (s.mfr) setBrand(String(s.mfr));
        lastSentRef.current = { id: null, path: s.manual ? String(s.manual) : '' };
      } else {
        setMessages([]);
        setManualPath('');
        setManualId(null);
        setBrand('');
      }
      if (urlPrompt) setInput(urlPrompt);

      // Manuals catalog. Default PostgREST page is 1000 rows; Zeiss (manual 76)
      // sorts after that, so page through and still fetch the URL id directly.
      let loaded = await fetchAllPages<ManualRow>(async (from, to) =>
        supabase.from('manuals').select(AI_MANUAL_SELECT).order('brand').order('title').range(from, to)
      );
      if (loaded.error && /language|schema cache|column/i.test(loaded.error.message || '')) {
        loaded = await fetchAllPages<ManualRow>(async (from, to) =>
          supabase.from('manuals').select(AI_MANUAL_SELECT_LEGACY).order('brand').order('title').range(from, to)
        );
      }
      if (loaded.error) {
        console.warn('manuals load', loaded.error);
        toast.error('Could not load manuals list');
      }
      let rows = (loaded.data || []).filter((m) => m.storage_path && m.title && m.id != null);
      if (urlManualId != null && !rows.some((r) => asManualId(r.id) === urlManualId)) {
        let oneRes = await supabase
          .from('manuals')
          .select(AI_MANUAL_SELECT)
          .eq('id', urlManualId)
          .maybeSingle();
        if (oneRes.error && /language|schema cache|column/i.test(oneRes.error.message || '')) {
          oneRes = await supabase
            .from('manuals')
            .select(AI_MANUAL_SELECT_LEGACY)
            .eq('id', urlManualId)
            .maybeSingle();
        }
        const { data: one, error: oneErr } = oneRes;
        if (oneErr) console.warn('manual by id', oneErr);
        if (one?.storage_path && one?.title && one?.id != null) rows = [...rows, one as ManualRow];
      }
      if (!cancelled) {
        setManuals(rows);
        const urlPick = assistantManualPicker(rows, urlManualId);
        if (urlPick) {
          setManualId(urlPick.id);
          setManualPath(urlPick.storagePath);
          setBrand(urlPick.brand);
          lastSentRef.current = { id: urlPick.id, path: urlPick.storagePath };
          const scoped = messagesForManual(s, urlPick.id);
          if (scoped.length) setMessages(scoped);
        } else {
          setManualId((prev) => {
            if (prev != null && rows.some((r) => asManualId(r.id) === prev)) return prev;
            const savedId = asManualId(s.manualId);
            if (savedId != null && rows.some((r) => asManualId(r.id) === savedId)) return savedId;
            const path = s.manual;
            if (path) {
              const hit = rows.find((r) => r.storage_path === path);
              if (hit) return asManualId(hit.id) ?? prev;
            }
            return prev;
          });
          setBrand((prev) => {
            if (prev) return prev;
            const savedId = asManualId(s.manualId);
            const path = s.manual;
            const hit =
              (savedId != null && rows.find((r) => asManualId(r.id) === savedId)) ||
              (path ? rows.find((r) => r.storage_path === path) : null);
            if (hit?.brand) return hit.brand;
            return prev;
          });
          setManualPath((prev) => {
            if (prev) return prev;
            const savedId = asManualId(s.manualId);
            const hit = savedId != null ? rows.find((r) => asManualId(r.id) === savedId) : null;
            return hit?.storage_path || s.manual || prev;
          });
        }
      }

      const u = await fetchAiUsage(session.access_token);
      if (!cancelled && u) setUsage(u);

      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const citedManual = useAssistantCitationOpen({
    messages,
    sending,
    ready,
    manuals,
    caller,
    listRef,
    askAssistant: (text) => sendPromptRef.current(text),
  });

  function onBrandChange(v: string) {
    setBrand(v);
    setManualPath('');
    setManualId(null);
    saveState(messages, '', v, null);
  }

  function onManualChange(v: string) {
    const id = asManualId(v);
    const row = id != null ? manuals.find((m) => asManualId(m.id) === id) : null;
    const path = row?.storage_path || '';
    setManualId(id);
    setManualPath(path);
    saveState(messages, path, brand, id);
  }

  function sendPrompt(text: string): boolean {
    const trimmed = String(text ?? '').trim();
    const accessToken = token;
    if (
      !canAskAssistant({
        ready,
        sending: sendingRef.current || sending,
        hasToken: !!accessToken,
        text: trimmed,
      })
    ) {
      return false;
    }
    if (!accessToken) return false;

    if (usage.text.used >= usage.text.limit) {
      const msg = `Daily text limit reached (${usage.text.used}/${usage.text.limit}). Resets at midnight.`;
      setLimitBanner(msg);
      toast.error(msg);
      return false;
    }

    const nextMsgs: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMsgs);
    setInput('');
    sendingRef.current = true;
    setSending(true);
    setLimitBanner('');
    const currentId = selectedManual?.id ?? manualId;
    const currentPath = selectedManual?.storage_path || manualPath || '';
    saveState(nextMsgs, currentPath, brand, currentId);

    const payload = buildGrokChatPayload({
      messages: nextMsgs,
      manualId: currentId,
      manualPath: currentPath,
      manualTitle: selectedManual ? catalogManualTitle(selectedManual) : '',
      manualBrand: selectedManual?.brand || brand,
      manualModel: selectedManual?.model || '',
      manualLanguage: selectedManual ? resolveManualLanguage(selectedManual) : '',
      replyLanguage: siteLanguage,
      lastSentManualId: lastSentRef.current.id,
      lastSentManualPath: lastSentRef.current.path,
      voiceMode: getVoiceMode(),
    });
    lastSentRef.current = { id: payload.manualId, path: payload.manualPath || '' };

    void (async () => {
      try {
        const result = await grokChat({
          accessToken,
          messages: payload.messages,
          manualPath: payload.manualPath,
          manualId: payload.manualId,
          manualTitle: payload.manualTitle,
          manualBrand: payload.manualBrand,
          manualModel: payload.manualModel,
          manualLanguage: payload.manualLanguage,
          replyLanguage: payload.replyLanguage,
          scopeChanged: payload.scopeChanged,
          voiceMode: payload.voiceMode,
        });

        if (!result.ok) {
          if (result.status === 429) {
            setLimitBanner(result.message || result.error);
            if (result.usage) setUsage((u) => ({ ...u, ...result.usage }));
            toast.error(result.message || 'Daily limit reached');
          } else if (result.status === 401) {
            toast.error('Session expired — sign in again');
            router.push('/login?next=/ai-assistant');
          } else {
            const fail: ChatMessage[] = [
              ...nextMsgs,
              { role: 'assistant', content: `⚠️ ${result.error}${result.message ? `: ${result.message}` : ''}` },
            ];
            setMessages(fail);
            saveState(fail, currentPath, brand, currentId);
            toast.error(result.error);
          }
          return;
        }

        const citations = mergeCitations(result.citations, parseCitationMarkers(result.content));
        const answerTs = answerTimestamp();
        const withReply: ChatMessage[] = [
          ...nextMsgs,
          { role: 'assistant', content: result.content, citations, ts: answerTs },
        ];
        citedManual.markFresh(String(answerTs));
        setMessages(withReply);
        saveState(withReply, currentPath, brand, currentId);
        if (result.usage) {
          setUsage((u) => ({
            text: result.usage!.text || u.text,
            voice: result.usage!.voice || u.voice,
            tier: result.usage!.tier || u.tier,
          }));
        } else {
          const u = await fetchAiUsage(accessToken);
          if (u) setUsage(u);
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    })();
    return true;
  }

  useEffect(() => {
    sendPromptRef.current = sendPrompt;
  });

  function clearHistory() {
    if (!confirm(t('Clear conversation history?'))) return;
    citedManual.cancelPending();
    citedManual.close();
    setMessages([]);
    saveState([], manualPath, brand, manualId);
  }

  if (!ready) {
    return (
      <div className="fixed inset-0 z-30 flex flex-col bg-[var(--bg)]">
        <Header />
        <div className="flex-1 min-h-0 flex items-center justify-center text-[var(--text3)] text-sm">{t('Loading AI Assistant…')}</div>
      </div>
    );
  }

  const textLimitHit = usage.text.used >= usage.text.limit;
  const split = citedManual.open && citedManual.presentation === 'panel' && !!citedManual.cited;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[var(--bg)]">
      <Header />

      <div className={`flex-1 min-h-0 flex ${split ? 'flex-row' : 'justify-center'}`}>
      <div className={`px-4 py-3 flex flex-col flex-1 min-h-0 ${split ? 'ai-assistant-split border-r border-[var(--border)]' : 'w-full min-w-0 max-w-3xl'}`}>
        <div className="shrink-0 flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text)]">🤖 {t('AI Assistant')}</h1>
            <p className="text-sm text-[var(--text3)] mt-0.5">
              {t('Same engine as the mobile app (fault codes + selected manual).')}{' '}
              <span className="text-[var(--text3)]">{t('Voice is available in the Android app.')}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={clearHistory}
            className="text-xs text-[var(--text3)] hover:text-[var(--gold)] shrink-0 mt-1"
          >{t('Clear chat')}</button>
        </div>

        {/* Usage */}
        <div className="shrink-0 flex flex-wrap items-center gap-3 mb-3 text-xs text-[var(--text3)]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface2)]">
            <span>⌨️ {t('Text')}</span>
            <strong className={textLimitHit ? 'text-red-400' : 'text-[var(--gold)]'}>
              {usage.text.used}/{usage.text.limit}
            </strong>
            {planLabel && <span className="opacity-70">· {planLabel}</span>}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] opacity-70">
            🎙️ {t('Voice')} {usage.voice.used}/{usage.voice.limit}
            <span className="hidden sm:inline">{t('(mobile)')}</span>
          </span>
          <button
            type="button"
            onClick={citedManual.toggleAutoOpen}
            aria-pressed={citedManual.autoOpen}
            aria-label={t('Auto-open cited manual page')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--gold)] ${
              citedManual.autoOpen ? 'text-[var(--gold)]' : ''
            }`}
          >
            {citedManual.autoOpen ? t('Auto-open page ON') : t('Auto-open page OFF')}
          </button>
        </div>

        {/* Manual context */}
        <div className="card p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text3)]">{t('Brand')}</label>
            <select
              className="input w-full mt-1 text-sm"
              value={brand}
              onChange={(e) => onBrandChange(e.target.value)}
            >
              <option value="">{t('Select manufacturer…')}</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text3)]">{t('Manual')}</label>
            <select
              className="input w-full mt-1 text-sm"
              value={manualId != null ? String(manualId) : ''}
              onChange={(e) => onManualChange(e.target.value)}
              disabled={!brand}
            >
              <option value="">{brand ? t('Select model / manual…') : t('Pick a brand first')}</option>
              {manualsForBrand.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {assistantManualOptionLabel(m)}
                </option>
              ))}
            </select>
          </div>
          {selectedManualLabel ? (
            <div className="sm:col-span-2 text-xs text-[var(--gold)]">
              📖 Scoped to: <strong>{selectedManualLabel}</strong>
              {selectedManual?.id != null && (
                <>
                  {' · '}
                  <Link
                    href={citationViewerHref({
                      manualId: selectedManual.id,
                      title: catalogManualTitle(selectedManual),
                    })}
                    className="ai-cite-link underline-offset-2 hover:underline"
                  >{t('Open in viewer')}</Link>
                </>
              )}
            </div>
          ) : (
            <div className="sm:col-span-2 text-xs text-[var(--text3)]">
              Select a manual for accurate PM, calibration, and model-specific answers. Fault codes
              still work from the TSP database.
            </div>
          )}
        </div>

        {limitBanner && (
          <div className="shrink-0 mb-3 px-3 py-2 rounded-lg text-xs border border-red-500/40 bg-red-500/10 text-red-300">
            {limitBanner}
          </div>
        )}

        {/* Quick chips */}
        <div className="shrink-0 flex flex-wrap gap-2 mb-3">
          {QUICK_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={sending || textLimitHit}
              onClick={() => sendPrompt(c.prompt)}
              className="text-xs px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface3)] hover:border-[var(--gold)] hover:text-[var(--gold)] disabled:opacity-40"
            >
              {c.emoji} {t(c.label)}
            </button>
          ))}
        </div>

        {/* Messages — flex child fills leftover viewport and scrolls; do not use .card (overflow:hidden). */}
        <div
          ref={listRef}
          className="ai-chat-thread flex-1 min-h-0 overflow-y-auto p-4 mb-3 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)]"
          tabIndex={-1}
          data-answer-thread=""
          role="log"
          aria-label={t('AI Assistant conversation')}
          onClick={citedManual.onThreadClick}
        >
          {messages.length === 0 && (
            <div className="text-center text-sm text-[var(--text3)] py-10 leading-relaxed">
              👋 {t('Select brand + manual above, then ask about that system.')}
              <br />
              <span className="text-xs opacity-80">{t('Fault codes use the TSP database; other topics pull from the selected manual corpus.')}</span>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`ai-chat-bubble max-w-[92%] min-w-0 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--gold)] text-black font-medium'
                    : 'bg-[var(--surface3)] border border-[var(--border)] text-[var(--text2)]'
                }`}
                dangerouslySetInnerHTML={{
                  __html:
                    m.role === 'assistant'
                      ? formatAssistantHtml(m.content, m.citations)
                      : formatUserHtml(m.content),
                }}
              />
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 bg-[var(--surface3)] border border-[var(--border)] text-sm text-[var(--text3)]">
                Thinking…
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 flex gap-2 items-end pb-3">
          <textarea
            className="input flex-1 min-h-[44px] max-h-[120px] text-sm resize-y"
            placeholder={
              manualPath
                ? 'Ask about this system…'
                : 'Ask a question (select a manual for best results)…'
            }
            rows={2}
            value={input}
            disabled={sending || textLimitHit}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendPrompt(input);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary h-[44px] px-5 shrink-0"
            disabled={sending || textLimitHit || !input.trim()}
            onClick={() => sendPrompt(input)}
          >
            {sending ? '…' : t('Send')}
          </button>
        </div>

        <div className="shrink-0 pb-3 flex flex-wrap gap-4 text-xs">
          <Link href="/hub" className="text-[var(--gold)] hover:underline">
            {t('← Tech Hub')}
          </Link>
          <Link href="/manuals" className="text-[var(--text3)] hover:text-[var(--gold)]">
            {t('Manual library')}
          </Link>
        </div>
      </div>
      {citedManual.open && citedManual.cited && (
        <AssistantCitedManual
          cited={citedManual.cited}
          presentation={citedManual.presentation}
          onClose={citedManual.close}
        />
      )}
      </div>
    </div>
  );
}
