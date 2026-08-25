'use client';

import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { roleLabel } from '@/lib/labels';
import {
  acceptTeamInvite,
  fetchMemberships,
  leaveOrganization,
  switchOrganization,
  type OrgMembership,
  type PendingOrgInvite,
} from '@/lib/org-membership-client';

export function OrgSwitcher({
  compact = false,
  variant = 'chip',
}: {
  compact?: boolean;
  variant?: 'chip' | 'menu';
}) {
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [pending, setPending] = useState<PendingOrgInvite[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await fetchMemberships();
      setMemberships(data.memberships);
      setPending(data.pendingInvites);
    } catch {
      setMemberships([]);
      setPending([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const active = memberships.find((m) => m.isActive) || memberships[0];
  if (!active && pending.length === 0) return null;
  if (memberships.length < 2 && pending.length === 0 && compact) return null;

  const onSwitch = async (organizationId: number | string) => {
    if (String(organizationId) === String(active?.organizationId)) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await switchOrganization(organizationId);
      toast.success('Working as that company now. Jobs stay in their own shop.');
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not switch company');
      setBusy(false);
    }
  };

  const onAccept = async (invite: PendingOrgInvite, leave?: number | string) => {
    setBusy(true);
    try {
      await acceptTeamInvite(invite.id, leave);
      toast.success(
        leave
          ? `Joined ${invite.name} and left the previous shop. Your login is unchanged.`
          : `Added ${invite.name} as ${roleLabel(invite.role)}. Home shop unchanged.`
      );
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not accept invite');
      setBusy(false);
    }
  };

  const panel = (
        <div
          className={
            variant === 'menu'
              ? 'mt-2 w-full min-w-0 rounded-lg border border-[var(--gold)] bg-[var(--surface)] text-sm overflow-visible'
              : 'absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] min-w-[16rem] rounded-xl border border-[var(--gold)] bg-[var(--surface3)] shadow-xl z-[120] overflow-visible text-sm'
          }
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--text3)] border-b border-[var(--border)]">
            Working as
          </div>
          {memberships.map((m) => (
            <button
              key={String(m.organizationId)}
              type="button"
              disabled={busy}
              onClick={() => onSwitch(m.organizationId)}
              className={`w-full text-left px-3 py-2.5 hover:bg-[var(--surface)] ${
                m.isActive ? 'bg-[var(--surface)]' : ''
              }`}
            >
              <div className="font-semibold truncate">{m.name}</div>
              <div className="text-[11px] text-[var(--text3)]">
                {roleLabel(m.role)}
                {m.isHome ? ' · Home shop' : ''}
                {m.isActive ? ' · Active' : ''}
              </div>
            </button>
          ))}
          {pending.length > 0 && (
            <div className="border-t border-[var(--border)] px-3 py-2 space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">
                Pending invites
              </div>
              {pending.map((inv) => (
                <div key={inv.id} className="rounded border border-[var(--border)] p-2">
                  <div className="font-semibold">{inv.name}</div>
                  <div className="text-[11px] text-[var(--text3)] mb-2">
                    {roleLabel(inv.role)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn btn-primary text-[11px] px-2 py-1"
                      disabled={busy}
                      onClick={() => onAccept(inv)}
                    >
                      Join (keep home)
                    </button>
                    {memberships
                      .filter((m) => !m.isHome)
                      .map((m) => (
                        <button
                          key={`leave-${m.organizationId}`}
                          type="button"
                          className="btn btn-secondary text-[11px] px-2 py-1"
                          disabled={busy}
                          onClick={() => onAccept(inv, m.organizationId)}
                        >
                          Join & leave {m.name}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
  );

  if (variant === 'menu') {
    return <div className="w-full min-w-0">{panel}</div>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 max-w-[220px] rounded-full border border-[var(--gold-border)] px-2.5 py-1 text-xs hover:bg-[var(--surface3)]"
        aria-label="Switch company"
        title="Switch which company you are working as"
      >
        <Building2 size={14} className="text-[var(--gold)] shrink-0" />
        <span className="truncate font-semibold">
          {active?.name || 'Choose company'}
        </span>
        <ChevronDown size={12} className="opacity-70 shrink-0" />
      </button>
      {open && panel}
    </div>
  );
}

export function MembershipsSettings() {
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [pending, setPending] = useState<PendingOrgInvite[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await fetchMemberships();
      setMemberships(data.memberships);
      setPending(data.pendingInvites);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!memberships.length && !pending.length) return null;

  const onLeave = async (m: OrgMembership) => {
    if (!window.confirm(`Leave ${m.name}? Your login stays. You will lose access to that shop's jobs.`)) {
      return;
    }
    setBusy(true);
    try {
      await leaveOrganization(m.organizationId);
      toast.success(`Left ${m.name}. Account kept.`);
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not leave');
      setBusy(false);
    }
  };

  const onAccept = async (invite: PendingOrgInvite, leave?: number | string) => {
    setBusy(true);
    try {
      await acceptTeamInvite(invite.id, leave);
      toast.success(`Joined ${invite.name}`);
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || 'Could not accept invite');
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="font-semibold mb-2">Companies</div>
      <p className="text-xs text-[var(--text3)] mb-3">
        Same login on the website and Android app. Switch which shop you are working as —
        jobs stay in their own company.
      </p>
      <div className="space-y-2">
        {memberships.map((m) => (
          <div
            key={String(m.organizationId)}
            className="flex items-start justify-between gap-2 rounded border border-[var(--border)] px-3 py-2"
          >
            <div>
              <div className="font-medium">{m.name}</div>
              <div className="text-[11px] text-[var(--text3)]">
                {roleLabel(m.role)}
                {m.isHome ? ' · Home shop' : ''}
                {m.isActive ? ' · Active' : ''}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {!m.isActive && (
                <button
                  type="button"
                  className="btn btn-secondary text-[11px] px-2 py-1"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await switchOrganization(m.organizationId);
                      window.location.reload();
                    } catch (e: any) {
                      toast.error(e?.message || 'Switch failed');
                      setBusy(false);
                    }
                  }}
                >
                  Work as
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary text-[11px] px-2 py-1 text-red-400"
                disabled={busy}
                onClick={() => onLeave(m)}
              >
                Leave
              </button>
            </div>
          </div>
        ))}
      </div>
      {pending.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold">Pending invites</div>
          {pending.map((inv) => (
            <div key={inv.id} className="rounded border border-[var(--gold)] px-3 py-2">
              <div className="font-medium">{inv.name}</div>
              <div className="text-[11px] text-[var(--text3)] mb-2">{roleLabel(inv.role)}</div>
              <button
                type="button"
                className="btn btn-primary text-[11px] px-2 py-1"
                disabled={busy}
                onClick={() => onAccept(inv)}
              >
                Join (keep home)
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
