import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  aiDailyLimitsForOrg,
  dailyLimitMessage,
  isDailyLimitReached,
  utcDayStartIso,
  type AiDailyLimits,
  type AiRequestKind,
} from '@/lib/ai/daily-quota';
import type { OrgPlanFields } from '@/lib/org-plan';

export const dynamic = 'force-dynamic';

const FALLBACK_SUPABASE_URL = 'https://yljztfajyvjzqikxdddf.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsanp0ZmFqeXZqenFpa3hkZGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MjMzMDYsImV4cCI6MjA4NTE5OTMwNn0.O3qRONKT4XdEoSZTPg0Lg_tLyThMxRAMWjGwHy5W5JM';

function supabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    FALLBACK_SUPABASE_URL
  ).replace(/\/$/, '');
}

function supabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    FALLBACK_SUPABASE_ANON_KEY
  );
}

function grokAssistantUrl(): string {
  return `${supabaseUrl()}/functions/v1/grok-assistant`;
}

function usagePayload(
  textUsed: number,
  voiceUsed: number,
  limits: AiDailyLimits
) {
  return {
    text: { used: textUsed, limit: limits.text },
    voice: { used: voiceUsed, limit: limits.voice },
    tier: limits.tier,
  };
}

async function countToday(
  db: SupabaseClient,
  userId: string,
  kind: AiRequestKind
): Promise<number> {
  const { count, error } = await db
    .from('api_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('request_type', kind)
    .gte('created_at', utcDayStartIso());
  if (error) {
    throw new Error(`Could not read AI usage (${error.message})`);
  }
  return count ?? 0;
}

async function recordUsage(
  db: SupabaseClient,
  userId: string,
  kind: AiRequestKind
): Promise<void> {
  const { error } = await db.from('api_usage').insert({
    user_id: userId,
    request_type: kind,
    tokens_used: 1,
  });
  if (error) console.warn('api_usage insert', kind, error.message);
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = supabaseUrl();
    const anon = supabaseAnonKey();
    if (!anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const db: SupabaseClient = hasServiceRole() ? getSupabaseAdmin() : supabase;
    let org: OrgPlanFields | null = null;
    if (hasServiceRole()) {
      const { data: prof } = await db
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      if (prof?.organization_id != null) {
        const { data: orgRow } = await db
          .from('organizations')
          .select('is_premium, subscription_tier, plan')
          .eq('id', prof.organization_id)
          .maybeSingle();
        org = (orgRow as OrgPlanFields | null) || null;
      }
    } else {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id, organizations(is_premium, subscription_tier, plan)')
        .eq('id', user.id)
        .maybeSingle();
      const orgRel = (profile as { organizations?: OrgPlanFields | OrgPlanFields[] | null } | null)
        ?.organizations;
      org = (Array.isArray(orgRel) ? orgRel[0] : orgRel) || null;
    }
    const limits = aiDailyLimitsForOrg(org);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || 'chat');
    const kind: AiRequestKind = body.voiceMode === true ? 'voice' : 'text';

    const textUsed = await countToday(db, user.id, 'text');
    const voiceUsed = await countToday(db, user.id, 'voice');

    if (action === 'usage') {
      return NextResponse.json(usagePayload(textUsed, voiceUsed, limits));
    }

    const used = kind === 'voice' ? voiceUsed : textUsed;
    const limit = limits[kind];
    if (isDailyLimitReached(used, limit)) {
      return NextResponse.json(
        {
          error: 'daily_limit_reached',
          message: dailyLimitMessage(kind, used, limit),
          used,
          limit,
          tier: limits.tier,
          _usage: usagePayload(textUsed, voiceUsed, limits),
        },
        { status: 429 }
      );
    }

    const grokResp = await fetch(grokAssistantUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    let json: Record<string, unknown> = {};
    try {
      json = (await grokResp.json()) as Record<string, unknown>;
    } catch {
      json = { error: `Invalid response (${grokResp.status})` };
    }

    let recordedText = textUsed;
    let recordedVoice = voiceUsed;
    if (grokResp.ok && (action === 'chat' || action === 'voice')) {
      const after = await countToday(db, user.id, kind);
      if (after <= used) {
        await recordUsage(db, user.id, kind);
        if (kind === 'text') recordedText = textUsed + 1;
        else recordedVoice = voiceUsed + 1;
      } else if (kind === 'text') {
        recordedText = after;
      } else {
        recordedVoice = after;
      }
    }

    json._usage = usagePayload(recordedText, recordedVoice, limits);
    json.tier = limits.tier;

    return NextResponse.json(json, { status: grokResp.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'AI request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
