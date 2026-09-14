'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { godAuthHeader } from '@/lib/god-client';
import { isServiceOrgType } from '@/lib/org-types';
import type { GodOrgRow } from '@/lib/god-orgs';
import { COMPLIMENTARY_PREMIUM_DAYS } from '@/lib/complimentary-premium';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function GodComplimentaryPremium() {
  const [orgs, setOrgs] = useState<GodOrgRow[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [confirmExpire, setConfirmExpire] = useState(false);

  async function reload() {
    const headers = await godAuthHeader();
    const res = await fetch('/api/god/orgs?type=service_company', { headers, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'Could not load repair companies');
    setOrgs(json.orgs || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Could not load shops');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shops = useMemo(
    () => orgs.filter((org) => isServiceOrgType(org.type)),
    [orgs]
  );

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return shops;
    return shops.filter((org) => {
      const hay = [org.name, org.orgEmail, org.adminEmail, org.planLabel, org.premiumUntil]
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [shops, q]);

  const selectedShops = visible.filter((org) => selected.has(String(org.id)));

  function toggle(id: number | string) {
    const key = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function grant() {
    setGranting(true);
    try {
      const headers = await godAuthHeader();
      const res = await fetch('/api/god/orgs/complimentary-premium', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          confirm: true,
          organization_ids: selectedShops.map((org) => org.id),
          days: COMPLIMENTARY_PREMIUM_DAYS,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Grant failed');
      const granted = Number(json.grantedCount || 0);
      const skipped = Number(json.skippedCount || 0);
      toast.success(
        `Granted ${granted} complimentary Premium` + (skipped ? ` · skipped ${skipped}` : '')
      );
      if (Array.isArray(json.skipped) && json.skipped.length) {
        const first = json.skipped[0];
        toast.message(String(first.error || first.reason || 'Some orgs were skipped'));
      }
      setSelected(new Set());
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Grant failed');
    } finally {
      setGranting(false);
      setConfirmGrant(false);
    }
  }

  async function expireNow() {
    setExpiring(true);
    try {
      const headers = await godAuthHeader();
      const res = await fetch('/api/god/premium/expire', {
        method: 'POST',
        headers,
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'Expiry failed');
      const expired = Number(json.expiredCount || 0);
      const skipped = Number(json.skippedCount || 0);
      toast.success(
        `Expired ${expired} complimentary Premium` + (skipped ? ` · skipped ${skipped}` : '')
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Expiry failed');
    } finally {
      setExpiring(false);
      setConfirmExpire(false);
    }
  }

  return (
    <section className="card p-5 mb-8">
      <h2 className="text-xl font-bold mb-1">Complimentary Premium</h2>
      <p className="text-[var(--text3)] mb-4 max-w-3xl">
        Soft beta: grant {COMPLIMENTARY_PREMIUM_DAYS} days of Premium to a repair company without
        Stripe or a card. New shop signups get this automatically. Paid Stripe orgs and
        Premium rows without an expiry are never flipped or expired.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search repair companies"
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[220px]"
          aria-label="Search repair companies"
        />
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={() => setSelected(new Set(visible.map((org) => String(org.id))))}
          disabled={!visible.length}
        >
          Select visible
        </button>
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={() => setSelected(new Set())}
        >
          Clear selection
        </button>
        <span className="text-sm text-[var(--text3)]">
          {visible.length} shown · {selectedShops.length} selected
        </span>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selectedShops.length || granting}
          onClick={() => setConfirmGrant(true)}
        >
          Grant {COMPLIMENTARY_PREMIUM_DAYS} days to {selectedShops.length} selected
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={expiring}
          onClick={() => setConfirmExpire(true)}
        >
          Run expiry now
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              <th className="p-3 w-10"></th>
              <th className="p-3">Organization</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Premium until</th>
              <th className="p-3">Grant</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((org) => {
              const key = String(org.id);
              return (
                <tr key={key} className="border-b border-[var(--border)] hover:bg-[var(--surface3)]">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(org.id)}
                      aria-label={`Select ${org.name}`}
                    />
                  </td>
                  <td className="p-3 font-semibold">{org.name}</td>
                  <td className="p-3">{org.planLabel}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(org.premiumUntil)}</td>
                  <td className="p-3">{org.premiumGrant || '—'}</td>
                </tr>
              );
            })}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-[var(--text3)]">
                  No repair companies match.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-[var(--text3)]">
                  Loading repair companies…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmGrant && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full">
            <h3 className="text-lg font-bold mb-2">Grant complimentary Premium?</h3>
            <p className="text-[var(--text2)] mb-4">
              {selectedShops.length} repair compan
              {selectedShops.length === 1 ? 'y' : 'ies'} get {COMPLIMENTARY_PREMIUM_DAYS} days.
              No Stripe. No card. Paid Stripe orgs and Premium-without-expiry rows are skipped.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary" disabled={granting} onClick={grant}>
                {granting ? 'Granting…' : 'Confirm grant'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={granting}
                onClick={() => setConfirmGrant(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmExpire && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="card p-6 max-w-lg w-full">
            <h3 className="text-lg font-bold mb-2">Expire complimentary Premium?</h3>
            <p className="text-[var(--text2)] mb-4">
              Drops only orgs whose premium_until has passed back to Free. Paid Stripe orgs and
              orgs without an expiry are never touched.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary" disabled={expiring} onClick={expireNow}>
                {expiring ? 'Running…' : 'Confirm expiry'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={expiring}
                onClick={() => setConfirmExpire(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
