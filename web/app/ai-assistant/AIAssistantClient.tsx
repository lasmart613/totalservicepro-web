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
import { toast } from 'sonner';

type ManualRow = {
  title: string;
  storage_path: string;
  brand: string | null;
};

const STORAGE_KEY = 'tsp_ai_web_v1';

const QUICK_CHIPS: { label: string; prompt: string }[] = [
  { label: '⚡ Fault codes', prompt: 'What are the most common fault codes for this system?' },
  { label: '🔧 Calibration', prompt: 'Walk me through the calibration procedure' },
  { label: '📋 PM steps', prompt: 'What preventive maintenance steps should I perform?' },
  { label: '🔩 Spare parts', prompt: 'What spare parts should I carry for this system?' },
  { label: '⚠️ Safety', prompt: 'What are the laser safety precautions?' },
];

function formatMsgHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

function defaultUsage(): AiUsage {
  return {
    text: { used: 0, limit: 5 },
    voice: { used: 0, limit: 1 },
    tier: 'free',
  };
}

export default function AIAssistantClient() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [brand, setBrand] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [usage, setUsage] = useState<AiUsage>(defaultUsage());
  const [limitBanner, setLimitBanner] = useState('');

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
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [manuals, brand]);

  const selectedManualLabel = useMemo(() => {
    const m = manuals.find((x) => x.storage_path === manualPath);
    return m ? `${m.brand || ''} · ${m.title}`.trim() : '';
  }, [manuals, manualPath]);

  const saveState = useCallback(
    (msgs: ChatMessage[], path: string, mfr: string) => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            msgs: msgs.slice(-40),
            manual: path,
            mfr,
            ts: Date.now(),
          })
        );
      } catch {
        /* ignore quota */
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        router.replace('/login?next=/ai-assistant');
        return;
      }
      if (cancelled) return;
      setToken(session.access_token);

      // Restore chat / manual
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (Array.isArray(s.msgs)) setMessages(s.msgs);
          if (s.manual) setManualPath(String(s.manual));
          if (s.mfr) setBrand(String(s.mfr));
        }
      } catch {
        /* ignore */
      }

      // Manuals catalog
      const { data: man, error: manErr } = await supabase
        .from('manuals')
        .select('title,storage_path,brand')
        .order('brand')
        .order('title');
      if (manErr) {
        console.warn('manuals load', manErr);
        toast.error('Could not load manuals list');
      } else if (!cancelled) {
        const rows = (man || []).filter((m: any) => m.storage_path && m.title) as ManualRow[];
        setManuals(rows);
        // If restored path has brand, ensure brand select matches
        setBrand((prev) => {
          if (prev) return prev;
          const path =
            typeof window !== 'undefined'
              ? (() => {
                  try {
                    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').manual;
                  } catch {
                    return '';
                  }
                })()
              : '';
          if (path) {
            const hit = rows.find((r) => r.storage_path === path);
            if (hit?.brand) return hit.brand;
          }
          return prev;
        });
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  function onBrandChange(v: string) {
    setBrand(v);
    setManualPath('');
    saveState(messages, '', v);
  }

  function onManualChange(v: string) {
    setManualPath(v);
    saveState(messages, v, brand);
  }

  async function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || !token) return;

    if (usage.text.used >= usage.text.limit) {
      const msg = `Daily text limit reached (${usage.text.used}/${usage.text.limit}). Resets at midnight.`;
      setLimitBanner(msg);
      toast.error(msg);
      return;
    }

    const nextMsgs: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMsgs);
    setInput('');
    setSending(true);
    setLimitBanner('');
    saveState(nextMsgs, manualPath, brand);

    const result = await grokChat({
      accessToken: token,
      messages: nextMsgs,
      manualPath: manualPath || null,
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
        saveState(fail, manualPath, brand);
        toast.error(result.error);
      }
      setSending(false);
      return;
    }

    const withReply: ChatMessage[] = [
      ...nextMsgs,
      { role: 'assistant', content: result.content },
    ];
    setMessages(withReply);
    saveState(withReply, manualPath, brand);
    if (result.usage) {
      setUsage((u) => ({
        text: result.usage!.text || u.text,
        voice: result.usage!.voice || u.voice,
        tier: result.usage!.tier || u.tier,
      }));
    } else {
      const u = await fetchAiUsage(token);
      if (u) setUsage(u);
    }
    setSending(false);
  }

  function clearHistory() {
    if (!confirm('Clear conversation history?')) return;
    setMessages([]);
    saveState([], manualPath, brand);
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)] text-sm">
          Loading AI Assistant…
        </div>
      </div>
    );
  }

  const textLimitHit = usage.text.used >= usage.text.limit;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <Header />

      <div className="max-w-3xl mx-auto w-full px-4 py-4 flex flex-col flex-1 min-h-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text)]">🤖 AI Assistant</h1>
            <p className="text-sm text-[var(--text3)] mt-0.5">
              Same engine as the mobile app (fault codes + selected manual).{' '}
              <span className="text-[var(--text3)]">Voice is available in the Android app.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={clearHistory}
            className="text-xs text-[var(--text3)] hover:text-[var(--gold)] shrink-0 mt-1"
          >
            Clear chat
          </button>
        </div>

        {/* Usage */}
        <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-[var(--text3)]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface2)]">
            <span>⌨️ Text</span>
            <strong className={textLimitHit ? 'text-red-400' : 'text-[var(--gold)]'}>
              {usage.text.used}/{usage.text.limit}
            </strong>
            {usage.tier && (
              <span className="opacity-70 capitalize">· {usage.tier}</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] opacity-70">
            🎙️ Voice {usage.voice.used}/{usage.voice.limit}
            <span className="hidden sm:inline">(mobile)</span>
          </span>
        </div>

        {/* Manual context */}
        <div className="card p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text3)]">
              Brand
            </label>
            <select
              className="input w-full mt-1 text-sm"
              value={brand}
              onChange={(e) => onBrandChange(e.target.value)}
            >
              <option value="">Select manufacturer…</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text3)]">
              Manual
            </label>
            <select
              className="input w-full mt-1 text-sm"
              value={manualPath}
              onChange={(e) => onManualChange(e.target.value)}
              disabled={!brand}
            >
              <option value="">{brand ? 'Select model / manual…' : 'Pick a brand first'}</option>
              {manualsForBrand.map((m) => (
                <option key={m.storage_path} value={m.storage_path}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
          {selectedManualLabel ? (
            <div className="sm:col-span-2 text-xs text-[var(--gold)]">
              📖 Scoped to: <strong>{selectedManualLabel}</strong>
            </div>
          ) : (
            <div className="sm:col-span-2 text-xs text-[var(--text3)]">
              Select a manual for accurate PM, calibration, and model-specific answers. Fault codes
              still work from the TSP database.
            </div>
          )}
        </div>

        {limitBanner && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs border border-red-500/40 bg-red-500/10 text-red-300">
            {limitBanner}
          </div>
        )}

        {/* Quick chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={sending || textLimitHit}
              onClick={() => sendPrompt(c.prompt)}
              className="text-xs px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface3)] hover:border-[var(--gold)] hover:text-[var(--gold)] disabled:opacity-40"
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="card flex-1 min-h-[280px] max-h-[min(52vh,520px)] overflow-y-auto p-4 mb-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-sm text-[var(--text3)] py-10 leading-relaxed">
              👋 Select brand + manual above, then ask about that system.
              <br />
              <span className="text-xs opacity-80">
                Fault codes use the TSP database; other topics pull from the selected manual corpus.
              </span>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--gold)] text-black font-medium'
                    : 'bg-[var(--surface3)] border border-[var(--border)] text-[var(--text2)]'
                }`}
                dangerouslySetInnerHTML={{ __html: formatMsgHtml(m.content) }}
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
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2 items-end pb-4">
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
            {sending ? '…' : 'Send'}
          </button>
        </div>

        <div className="pb-6 flex flex-wrap gap-4 text-xs">
          <Link href="/hub" className="text-[var(--gold)] hover:underline">
            ← Tech Hub
          </Link>
          <Link href="/manuals" className="text-[var(--text3)] hover:text-[var(--gold)]">
            Manual library
          </Link>
        </div>
      </div>
    </div>
  );
}
