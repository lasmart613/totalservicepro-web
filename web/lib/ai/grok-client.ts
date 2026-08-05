/**
 * Client for Supabase edge function `grok-assistant` (shared with Android AI).
 * Text chat only on web for Sprint A — voice/TTS remains mobile.
 */

import { getSupabaseUrl } from '@/lib/supabase/client';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type UsageBucket = { used: number; limit: number };

export type AiUsage = {
  text: UsageBucket;
  voice: UsageBucket;
  tier?: string;
};

export type GrokChatResult = {
  ok: true;
  content: string;
  usage?: AiUsage;
  meta?: {
    manualLabel?: string;
    hasFaultDBHit?: boolean;
    hasManualPassages?: boolean;
  };
};

export type GrokErrorResult = {
  ok: false;
  status: number;
  error: string;
  message?: string;
  usage?: AiUsage;
};

function grokUrl(): string {
  const base = (getSupabaseUrl() || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  return `${base}/functions/v1/grok-assistant`;
}

async function postGrok(
  accessToken: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: any }> {
  const resp = await fetch(grokUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    json = { error: `Invalid response (${resp.status})` };
  }
  return { status: resp.status, json };
}

/** Daily usage for text/voice limits (Android parity). */
export async function fetchAiUsage(accessToken: string): Promise<AiUsage | null> {
  try {
    const { status, json } = await postGrok(accessToken, { action: 'usage' });
    if (status !== 200 || !json) return null;
    return {
      text: {
        used: Number(json.text?.used ?? 0),
        limit: Number(json.text?.limit ?? 5),
      },
      voice: {
        used: Number(json.voice?.used ?? 0),
        limit: Number(json.voice?.limit ?? 1),
      },
      tier: json.tier || 'free',
    };
  } catch {
    return null;
  }
}

/**
 * Chat completion with optional manual path (storage_path) for RAG scoping.
 * Mirrors Android ai_assistant.html payload.
 */
export async function grokChat(opts: {
  accessToken: string;
  messages: ChatMessage[];
  manualPath?: string | null;
}): Promise<GrokChatResult | GrokErrorResult> {
  const nonSys = opts.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const { status, json } = await postGrok(opts.accessToken, {
      action: 'chat',
      voiceMode: false,
      manualPath: opts.manualPath || null,
      messages: nonSys,
    });

    if (status === 429) {
      return {
        ok: false,
        status,
        error: 'daily_limit_reached',
        message:
          json?.message ||
          `Daily text limit reached (${json?.used ?? '?'}/${json?.limit ?? '?'}). Resets at midnight.`,
        usage: json?._usage
          ? {
              text: json._usage.text,
              voice: json._usage.voice,
              tier: json.tier,
            }
          : json?.used != null
            ? {
                text: { used: json.used, limit: json.limit ?? 5 },
                voice: { used: 0, limit: 1 },
              }
            : undefined,
      };
    }

    if (status !== 200) {
      return {
        ok: false,
        status,
        error: json?.error || `Request failed (${status})`,
        message: json?.details ? String(json.details).slice(0, 200) : undefined,
      };
    }

    const content =
      json?.choices?.[0]?.message?.content ||
      json?.message?.content ||
      '';

    if (!content) {
      return {
        ok: false,
        status: 500,
        error: 'Empty response from AI',
      };
    }

    return {
      ok: true,
      content: String(content).trim(),
      usage: json?._usage
        ? {
            text: json._usage.text,
            voice: json._usage.voice,
            tier: json.tier,
          }
        : undefined,
      meta: json?._meta,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      error: e?.message || 'Connection error',
    };
  }
}
