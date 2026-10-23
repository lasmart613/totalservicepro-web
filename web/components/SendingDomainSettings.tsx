'use client';

/**
 * Settings > "Send from your own domain" (000941, CRM_EMAIL_ENABLED only).
 * Owner / company_admin / admin add a domain; RepairPlanet creates it in Resend
 * and shows the DNS records to add at the org's own DNS host. Verify starts a
 * check; while pending the page polls every 30s (server throttles to 15s/org).
 * Hidden entirely when the feature is off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useCrmEmailT } from '@/components/CustomerEmailComposer';

type Rec = { record: string; name: string; type: string; value: string; ttl: string; status: string; priority?: number };
type DomainState = {
  enabled: boolean;
  canManage?: boolean;
  domain?: { domain: string; status: string; records: Rec[]; checkedAt: string | null } | null;
  sendsAs?: string | null;
  error?: string;
  retryAfter?: number;
};

async function call(method: string, path = '', body?: unknown): Promise<{ ok: boolean; j: DomainState }> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(`/api/crm-email/domain${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  return { ok: r.ok, j: (await r.json().catch(() => ({ enabled: false }))) as DomainState };
}

const STATUS_LABEL: Record<string, string> = {
  verified: 'Verified',
  pending: 'Checking DNS…',
  not_started: 'Add the DNS records, then press Verify.',
  partially_verified: 'Some records verified. Keep checking.',
  partially_failed: 'Some records failed. Check the values.',
  failed: 'Verification failed. Check the records and verify again.',
  temporary_failure: 'Temporary DNS problem. Try Verify again later.',
};

export default function SendingDomainSettings() {
  const t = useCrmEmailT();
  const [st, setSt] = useState<DomainState | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (refresh = false) => {
    const { j } = await call('GET', refresh ? '?refresh=1' : '');
    setSt((cur) => (j.enabled === false && cur?.enabled ? cur : j));
  }, []);

  useEffect(() => {
    load(true).catch(() => setSt({ enabled: false }));
  }, [load]);

  const status = st?.domain?.status;
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (st?.domain && status !== 'verified') timer.current = setInterval(() => load(true).catch(() => {}), 30000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [st?.domain, status, load]);

  if (!st || !st.enabled) return null;

  async function run(method: string, path: string, body?: unknown, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const { ok, j } = await call(method, path, body);
      if (ok) {
        setSt(j);
        if (okText) setMsg({ ok: true, text: t(okText) });
      } else setMsg({ ok: false, text: j.error || t('Something went wrong. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  const d = st.domain;
  return (
    <div data-testid="sending-domain-settings">
      <h2 className="font-semibold mb-1">{t('Send from your own domain')}</h2>
      <p className="text-xs text-[var(--text3)] mb-3">
        {t('Optional. Customer emails go out as “{name} via RepairPlanet” until your domain is verified. Then people whose email is at that domain send as themselves.')}
      </p>
      {!d && st.canManage && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run('POST', '', { domain: input }, 'Domain added. Add the DNS records below at your DNS host.');
          }}
        >
          <input
            className="input flex-1"
            placeholder="yourcompany.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label={t('Your domain')}
            data-testid="sending-domain-input"
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()} data-testid="sending-domain-add">
            {t('Add domain')}
          </button>
        </form>
      )}
      {!d && !st.canManage && <p className="text-xs text-[var(--text3)]">{t('Only an owner or admin can set this up.')}</p>}
      {d && (
        <div className="space-y-3">
          <p data-testid="sending-domain-status">
            <strong>{d.domain}</strong> · {t(STATUS_LABEL[d.status] || 'Checking DNS…')}
          </p>
          {st.sendsAs && <p className="text-xs">{t('Your emails send as {email}.').replace('{email}', st.sendsAs)}</p>}
          {d.status !== 'verified' && (
            <>
              <p className="text-xs text-[var(--text3)]">
                {t('Add these records at the company that hosts your DNS (for example GoDaddy, Cloudflare or Namecheap). RepairPlanet never changes your DNS.')}
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full" data-testid="sending-domain-records">
                  <thead>
                    <tr className="text-left">
                      <th className="pr-2">{t('Type')}</th>
                      <th className="pr-2">{t('Name')}</th>
                      <th className="pr-2">{t('Value')}</th>
                      <th className="pr-2">{t('Priority')}</th>
                      <th>{t('Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.records.map((r, i) => (
                      <tr key={i} className="align-top">
                        <td className="pr-2">{r.type}</td>
                        <td className="pr-2 font-mono break-all">{r.name}</td>
                        <td className="pr-2 font-mono break-all select-all">{r.value}</td>
                        <td className="pr-2">{r.priority ?? ''}</td>
                        <td>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {st.canManage && (
            <div className="flex gap-2">
              {d.status !== 'verified' && (
                <button className="btn btn-primary" disabled={busy} onClick={() => run('POST', '/verify', undefined, 'Verification started.')} data-testid="sending-domain-verify">
                  {t('Verify')}
                </button>
              )}
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('Remove this domain? Customer emails go back to “via RepairPlanet”.'))) run('DELETE', '', undefined, 'Domain removed.');
                }}
                data-testid="sending-domain-remove"
              >
                {t('Remove domain')}
              </button>
            </div>
          )}
          {d.checkedAt && <p className="text-xs text-[var(--text3)]">{t('Last checked')}: {new Date(d.checkedAt).toLocaleString()}</p>}
        </div>
      )}
      {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</p>}
    </div>
  );
}
