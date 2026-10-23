'use client';

/**
 * CRM > customer > Send email (000940). Sends from the user's own connected
 * mailbox (Microsoft 365 / Gmail) or, if none, from "<Name> via RepairPlanet"
 * with Reply-To set to the user's address. All checks are server-side.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useSiteLocale, useT } from '@/lib/fa/locale';
import { CRM_EMAIL_STRINGS } from '@/lib/i18n/crm-email-copy';
import {
  AUDIENCE_LABELS,
  audienceForOrgType,
  CRM_EMAIL_AUDIENCES,
  CRM_EMAIL_TEMPLATES,
  templateBody,
  type CrmEmailAudience,
} from '@/lib/crm-email/templates';

type Status = {
  enabled: boolean;
  providers?: ('microsoft' | 'google')[];
  connections?: { provider: 'microsoft' | 'google'; email: string }[];
  fallback?: boolean;
  ownDomain?: { domain: string; status: string; sendsAs: string | null } | null;
  senderName?: string;
  senderEmail?: string;
  recipients?: string[];
  usage?: { hour: number; day: number; hourCap: number; dayCap: number };
  error?: string;
};

type SendRow = {
  id: number;
  recipient_email: string;
  subject: string;
  transport: string;
  status: string;
  sender_name: string | null;
  created_at: string;
};

const PROVIDER_LABEL = { microsoft: 'Microsoft 365 / Outlook', google: 'Gmail / Google Workspace' } as const;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchCrmEmailStatus(customerId?: string | number): Promise<Status> {
  const q = customerId != null ? `?customer=${encodeURIComponent(String(customerId))}` : '';
  const r = await fetch(`/api/crm-email/status${q}`, { headers: await authHeader(), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as Status;
  if (!r.ok) return { enabled: Boolean(j.enabled), error: j.error || 'Could not load email settings.' };
  return j;
}

/** useT() plus this feature's own copy table (lib/i18n/crm-email-copy.ts). */
export function useCrmEmailT(): (text: string) => string {
  const locale = useSiteLocale();
  const t = useT();
  return (text: string) => (locale === 'en' ? text : (CRM_EMAIL_STRINGS[text] as Record<string, string> | undefined)?.[locale] ?? t(text));
}

/** True only when the server says the feature is on (CRM_EMAIL_ENABLED). */
export function useCrmEmailEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetchCrmEmailStatus()
      .then((s) => live && setOn(s.enabled === true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return on;
}

export default function CustomerEmailComposer(props: {
  customerId: string | number;
  customerName?: string | null;
  customerType?: string | null;
  senderCompany?: string | null;
}) {
  const t = useCrmEmailT();
  const [status, setStatus] = useState<Status | null>(null);
  const [audience, setAudience] = useState<CrmEmailAudience>(audienceForOrgType(props.customerType));
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<SendRow[]>([]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const loadHistory = useCallback(async () => {
    const { data } = await getSupabaseClient()
      .from('customer_email_sends')
      .select('id, recipient_email, subject, transport, status, sender_name, created_at')
      .eq('customer_organization_id', Number(props.customerId))
      .order('created_at', { ascending: false })
      .limit(50);
    setHistory((data || []) as SendRow[]);
  }, [props.customerId]);

  const reload = useCallback(async () => {
    const s = await fetchCrmEmailStatus(props.customerId);
    setStatus(s);
    if (s.recipients?.length) setTo((cur) => cur || s.recipients![0]);
    return s;
  }, [props.customerId]);

  const applyTemplate = useCallback(
    (a: CrmEmailAudience, s: Status | null) => {
      setSubject(CRM_EMAIL_TEMPLATES[a].subject);
      setBody(
        templateBody(a, {
          customerName: '',
          senderName: s?.senderName || '',
          senderCompany: props.senderCompany || '',
          origin,
        })
      );
    },
    [origin, props.senderCompany]
  );

  useEffect(() => {
    let live = true;
    reload().then((s) => {
      if (!live) return;
      applyTemplate(audienceForOrgType(props.customerType), s);
    });
    loadHistory();
    const p = new URLSearchParams(window.location.search).get('mailbox');
    if (p) setMsg({ ok: p === 'connected', text: p === 'connected' ? t('Mailbox connected.') : t('Mailbox was not connected ({code}).').replace('{code}', p) });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.customerId]);

  const connected = status?.connections || [];
  const transportLabel = useMemo(() => {
    const c = connected.find((x) => x.provider === 'microsoft') || connected.find((x) => x.provider === 'google');
    if (c) return t('Sends from your mailbox: {email}').replace('{email}', c.email);
    if (status?.ownDomain?.sendsAs) return t('Sends from your verified domain: {email}').replace('{email}', status.ownDomain.sendsAs);
    if (status?.fallback)
      return t('No mailbox connected. Sends as “{name} via RepairPlanet”; replies go to {email}.')
        .replace('{name}', status.senderName || t('You'))
        .replace('{email}', status.senderEmail || '');
    return t('Connect your mailbox to send.');
  }, [connected, status, t]);

  if (!status) return <div className="section text-sm text-[var(--text3)]">{t('Loading…')}</div>;
  if (!status.enabled) return null;

  const canSend = Boolean(connected.length || status.ownDomain?.sendsAs || status.fallback) && Boolean(status.recipients?.length);

  async function connect(provider: 'microsoft' | 'google') {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/crm-email/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ provider, customer: String(props.customerId) }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) window.location.assign(j.url);
      else setMsg({ ok: false, text: j.error || t('Could not start mailbox connection.') });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(provider: 'microsoft' | 'google') {
    if (!window.confirm(t('Disconnect this mailbox? RepairPlanet will delete its saved access.'))) return;
    setBusy(true);
    try {
      const r = await fetch('/api/crm-email/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ provider }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg({
        ok: r.ok,
        text: r.ok
          ? provider === 'microsoft'
            ? t('Disconnected. To fully remove access, also remove RepairPlanet at myapps.microsoft.com.')
            : t('Disconnected and access revoked.')
          : j.error || t('Could not disconnect. Try again.'),
      });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/crm-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ customer_organization_id: Number(props.customerId), to, subject, body, audience }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg({ ok: r.ok, text: r.ok ? t('Email sent to {email}.').replace('{email}', to) : j.error || t('The email could not be sent.') });
      await Promise.all([reload(), loadHistory()]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="section">
        <div className="font-semibold mb-2">{t('Your mailbox')}</div>
        {connected.map((c) => (
          <div key={c.provider} className="flex items-center justify-between gap-2 text-sm py-1">
            <span>
              ✅ {PROVIDER_LABEL[c.provider]}: {c.email}
            </span>
            <button type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => disconnect(c.provider)}>
              {t('Disconnect')}
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 mt-2">
          {(status.providers || [])
            .filter((p) => !connected.some((c) => c.provider === p))
            .map((p) => (
              <button key={p} type="button" className="btn btn-secondary text-xs" disabled={busy} onClick={() => connect(p)}>
                {t('Connect {provider}').replace('{provider}', PROVIDER_LABEL[p])}
              </button>
            ))}
        </div>
        <p className="text-xs text-[var(--text3)] mt-2" data-testid="crm-email-transport">
          {transportLabel}
        </p>
      </div>

      <div className="section space-y-3">
        <div className="font-semibold">{t('Send email')}</div>
        <label className="block text-sm">
          {t('Template')}
          <select
            className="input w-full mt-1"
            value={audience}
            onChange={(e) => {
              const a = e.target.value as CrmEmailAudience;
              setAudience(a);
              applyTemplate(a, status);
            }}
          >
            {CRM_EMAIL_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {t(AUDIENCE_LABELS[a])}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {t('To')}
          {status.recipients?.length ? (
            <select className="input w-full mt-1" value={to} onChange={(e) => setTo(e.target.value)}>
              {status.recipients.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-[var(--text3)] mt-1">{t('Add an email to this customer’s contacts first.')}</p>
          )}
        </label>
        <label className="block text-sm">
          {t('Subject')}
          <input className="input w-full mt-1" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="block text-sm">
          {t('Message')}
          <textarea className="input w-full mt-1 font-mono text-xs" rows={16} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={busy || !canSend || !subject.trim() || !body.trim()} onClick={send}>
            {busy ? t('Sending…') : t('Send email')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => applyTemplate(audience, status)}>
            {t('Reset to template')}
          </button>
          {status.usage && (
            <span className="text-xs text-[var(--text3)]">
              {t('Sent this hour: {hour}/{hourCap} · today: {day}/{dayCap}')
                .replace('{hour}', String(status.usage.hour))
                .replace('{hourCap}', String(status.usage.hourCap))
                .replace('{day}', String(status.usage.day))
                .replace('{dayCap}', String(status.usage.dayCap))}
            </span>
          )}
        </div>
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</p>}
      </div>

      <div className="section">
        <div className="font-semibold mb-2">{t('Email history')}</div>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--text3)]">{t('No emails sent to this customer yet.')}</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="text-sm border-b border-[var(--border)] pb-2">
                <div className="font-medium">{h.subject}</div>
                <div className="text-xs text-[var(--text3)]">
                  {new Date(h.created_at).toLocaleString()} · {h.sender_name || ''} → {h.recipient_email} ·{' '}
                  {h.transport === 'resend' ? t('via RepairPlanet') : h.transport === 'resend_domain' ? t('from own domain') : t('from own mailbox')} · {t(h.status === 'sent' ? 'Sent' : h.status === 'failed' ? 'Failed' : 'Sending…')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
