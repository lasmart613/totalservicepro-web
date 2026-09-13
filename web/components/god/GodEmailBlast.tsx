'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { godAuthHeader } from '@/lib/god-client';
import { orgTypeLabel } from '@/lib/labels';
import type { GodOrgRow } from '@/lib/god-orgs';
import {
  BLAST_RESUME_STORAGE_KEY,
  BLAST_SEND_CHUNK_SIZE,
  BLAST_TEMPLATES,
  addBlastSkipCounts,
  blastChunkCount,
  blastDraftDiffersFromLocked,
  blastDraftStorageKey,
  clinicInviteAudience,
  emptyBlastSkipCounts,
  encodeBlastResumeToken,
  formatBlastSkipToast,
  parseBlastDraft,
  parseBlastResumeToken,
  pickBlastRecipient,
  selectedWithEmails,
  uniqueBlastOrganizationIds,
  type BlastDraft,
  type BlastSkipCounts,
  type BlastTemplateKey,
} from '@/lib/god-email-blast';

type SendLog = {
  id: string;
  created_at: string;
  organization_id: number | string | null;
  organization_name: string | null;
  recipient_email: string;
  subject: string;
  template_key?: string | null;
  unsubscribed_at?: string | null;
};

type LockedPreview = BlastDraft & {
  template_key: BlastTemplateKey;
  template_name: string;
  from: string;
  reply_to: string;
};

const DRAFT_SAVE_MS = 300;

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  { value: 'service_company', label: 'Repair company' },
  { value: 'customer', label: 'Clinic / laser owner' },
  { value: 'laser_clinic', label: 'Laser clinic' },
  { value: 'laser_rental', label: 'Rental' },
  { value: 'laser_reseller', label: 'Reseller' },
  { value: 'parts_supplier', label: 'Parts' },
  { value: 'vendor', label: 'Vendor' },
];

const PLAN_FILTERS = [
  { value: 'all', label: 'All plans' },
  { value: 'free', label: 'Free' },
  { value: 'premium', label: 'Premium' },
  { value: 'team', label: 'Team' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'unpaid', label: 'Unpaid' },
];

const TEMPLATE_OPTIONS: Array<{ value: BlastTemplateKey; label: string }> = [
  { value: 'clinic_invite', label: BLAST_TEMPLATES.clinic_invite.name },
  { value: 'shop_invite', label: BLAST_TEMPLATES.shop_invite.name },
];

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function readStoredDraft(templateKey: BlastTemplateKey): BlastDraft | null {
  try {
    const raw = localStorage.getItem(blastDraftStorageKey(templateKey));
    if (!raw) return null;
    return parseBlastDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredDraft(templateKey: BlastTemplateKey, draft: BlastDraft, locked: BlastDraft | null) {
  try {
    const key = blastDraftStorageKey(templateKey);
    if (locked && !blastDraftDiffersFromLocked(draft, locked)) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* private mode / quota */
  }
}

function clearStoredDraft(templateKey: BlastTemplateKey) {
  try {
    localStorage.removeItem(blastDraftStorageKey(templateKey));
  } catch {
    /* ignore */
  }
}

function newBrowserBlastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `blast-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function readStoredResume(templateKey: BlastTemplateKey): {
  blast_id: string;
  organization_ids: Array<number | string>;
} | null {
  try {
    const parsed = parseBlastResumeToken(sessionStorage.getItem(BLAST_RESUME_STORAGE_KEY));
    if (!parsed || parsed.template_key !== templateKey) return null;
    return { blast_id: parsed.blast_id, organization_ids: parsed.organization_ids };
  } catch {
    return null;
  }
}

function writeStoredResume(opts: {
  blast_id: string;
  template_key: BlastTemplateKey;
  organization_ids: Array<number | string>;
}) {
  try {
    if (!opts.organization_ids.length) {
      sessionStorage.removeItem(BLAST_RESUME_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      BLAST_RESUME_STORAGE_KEY,
      encodeBlastResumeToken({
        blast_id: opts.blast_id,
        template_key: opts.template_key,
        organization_ids: opts.organization_ids,
      })
    );
  } catch {
    /* private mode / quota */
  }
}

function clearStoredResume() {
  try {
    sessionStorage.removeItem(BLAST_RESUME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function GodEmailBlast({ variant = 'page' }: { variant?: 'page' | 'crm' }) {
  const [orgs, setOrgs] = useState<GodOrgRow[]>([]);
  const [sends, setSends] = useState<SendLog[]>([]);
  const [locked, setLocked] = useState<LockedPreview | null>(null);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [templateKey, setTemplateKey] = useState<BlastTemplateKey>('clinic_invite');
  const [type, setType] = useState('all');
  const [plan, setPlan] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [blastId, setBlastId] = useState<string | null>(null);
  const [resumeIds, setResumeIds] = useState<Array<number | string>>([]);
  const [progress, setProgress] = useState<{
    queued: number;
    sent: number;
    skipped: number;
    failed: number;
    remaining: number;
    chunk: number;
    chunks: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await godAuthHeader();
        const [orgRes, previewRes, logRes] = await Promise.all([
          fetch('/api/god/orgs', { headers, cache: 'no-store' }),
          fetch(`/api/god/blast/preview?template_key=${templateKey}`, { headers, cache: 'no-store' }),
          fetch('/api/god/invite/log', { headers, cache: 'no-store' }),
        ]);
        const orgJson = await orgRes.json().catch(() => ({}));
        const previewJson = await previewRes.json().catch(() => ({}));
        const logJson = await logRes.json().catch(() => ({}));
        if (cancelled) return;
        setOrgs(orgJson.orgs || []);
        if (previewRes.ok) {
          const nextLocked: LockedPreview = {
            template_key: previewJson.template_key,
            template_name: previewJson.template_name,
            subject: previewJson.subject || '',
            from: previewJson.from,
            reply_to: previewJson.reply_to,
            html: previewJson.html || '',
            text: previewJson.text || '',
          };
          setLocked(nextLocked);
          const draft = readStoredDraft(templateKey);
          if (draft && blastDraftDiffersFromLocked(draft, nextLocked)) {
            setSubject(draft.subject);
            setHtml(draft.html);
            setText(draft.text);
            setPreviewHtml(draft.html);
          } else {
            setSubject(nextLocked.subject);
            setHtml(nextLocked.html);
            setText(nextLocked.text);
            setPreviewHtml(nextLocked.html);
          }
        }
        setSends(logJson.sends || []);
        const storedResume = readStoredResume(templateKey);
        if (storedResume?.organization_ids.length) {
          setBlastId(storedResume.blast_id);
          setResumeIds(storedResume.organization_ids);
        } else {
          setResumeIds([]);
        }
      } catch (e) {
        console.error('god email blast load', e);
        toast.error('Could not load Email blast');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewHtml(html), DRAFT_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [html]);

  useEffect(() => {
    if (!locked || locked.template_key !== templateKey) return;
    const timer = window.setTimeout(() => {
      writeStoredDraft(templateKey, { subject, html, text }, locked);
    }, DRAFT_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [subject, html, text, locked, templateKey]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return orgs.filter((org) => {
      if (type !== 'all' && String(org.type).toLowerCase() !== type) return false;
      if (plan !== 'all' && org.planKey !== plan) return false;
      if (!query) return true;
      const hay = [
        org.name,
        org.orgEmail,
        org.adminEmail,
        org.typeLabel,
        org.planLabel,
        ...org.users.map((u) => `${u.name} ${u.email}`),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [orgs, type, plan, q]);

  const selectedRows = visible.filter((org) => selected.has(String(org.id)));
  const selectedEmailRows = selectedWithEmails(selectedRows);
  const clinicAudience = useMemo(() => clinicInviteAudience(orgs), [orgs]);
  const subjectCustomized = Boolean(locked && subject !== locked.subject);
  const bodyCustomized = Boolean(locked && (html !== locked.html || text !== locked.text));
  const canSend = Boolean(selectedEmailRows.length && subject.trim() && html.trim());

  function resetToLocked() {
    if (!locked) return;
    setSubject(locked.subject);
    setHtml(locked.html);
    setText(locked.text);
    setPreviewHtml(locked.html);
    clearStoredDraft(templateKey);
    toast.message('Restored the locked template. This send only — source files were not changed.');
  }

  function toggle(id: number | string) {
    const key = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const org of visible) {
        if (on) next.add(String(org.id));
        else next.delete(String(org.id));
      }
      return next;
    });
  }

  function selectClinicAudience() {
    setType('laser_clinic');
    setPlan('all');
    setSelected(new Set(clinicAudience.map((org) => String(org.id))));
  }

  function openConfirm() {
    if (!selectedEmailRows.length) {
      toast.error('Select one or more organizations with an email first.');
      return;
    }
    if (!subject.trim() || !html.trim()) {
      toast.error('Subject and HTML body cannot be empty.');
      return;
    }
    setConfirming(true);
  }

  async function sendChunks(organizationIds: Array<number | string>, existingBlastId?: string | null) {
    if (!organizationIds.length) {
      toast.error('Select one or more organizations with an email first.');
      return;
    }
    if (!subject.trim() || !html.trim()) {
      toast.error('Subject and HTML body cannot be empty.');
      return;
    }
    const runId = existingBlastId || newBrowserBlastId();
    setBlastId(runId);
    setSending(true);
    setProgress({
      queued: organizationIds.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      remaining: organizationIds.length,
      chunk: 0,
      chunks: Math.max(1, blastChunkCount(organizationIds.length)),
    });
    let queue = [...organizationIds];
    let retryableAcc: Array<number | string> = [];
    let remaining = [...organizationIds];
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let skipCounts = emptyBlastSkipCounts();
    let chunk = 0;
    try {
      const headers = await godAuthHeader();
      while (queue.length) {
        chunk += 1;
        setProgress({
          queued: organizationIds.length,
          sent,
          skipped,
          failed,
          remaining: remaining.length,
          chunk,
          chunks: Math.max(chunk, blastChunkCount(organizationIds.length)),
        });
        const res = await fetch('/api/god/blast/send', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            confirm: true,
            template_key: templateKey,
            organization_ids: queue,
            blast_id: runId,
            subject,
            html,
            text,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          remaining = uniqueBlastOrganizationIds([...queue, ...retryableAcc]);
          setResumeIds(remaining);
          writeStoredResume({
            blast_id: runId,
            template_key: templateKey,
            organization_ids: remaining,
          });
          setProgress({
            queued: organizationIds.length,
            sent,
            skipped,
            failed,
            remaining: remaining.length,
            chunk,
            chunks: Math.max(chunk, blastChunkCount(organizationIds.length)),
            error: json.error || 'Send failed',
          });
          toast.error(json.error || 'Send failed');
          return;
        }
        sent += Number(json.sentCount) || 0;
        skipCounts = addBlastSkipCounts(skipCounts, json.skip_counts as Partial<BlastSkipCounts> | undefined);
        skipped = Object.values(skipCounts).reduce((sum, n) => sum + n, 0);
        failed = Number(skipCounts.provider_error) || 0;
        const unprocessed = Array.isArray(json.unprocessed_organization_ids)
          ? json.unprocessed_organization_ids
          : null;
        const retryable = Array.isArray(json.retryable_organization_ids)
          ? json.retryable_organization_ids
          : [];
        retryableAcc = uniqueBlastOrganizationIds([...retryableAcc, ...retryable]);
        queue = unprocessed ?? (Array.isArray(json.remaining_organization_ids) ? json.remaining_organization_ids : []);
        remaining = uniqueBlastOrganizationIds([...queue, ...retryableAcc]);
        setResumeIds(remaining);
        writeStoredResume({
          blast_id: json.blast_id || runId,
          template_key: templateKey,
          organization_ids: remaining,
        });
        setProgress({
          queued: organizationIds.length,
          sent,
          skipped,
          failed,
          remaining: remaining.length,
          chunk,
          chunks: Math.max(chunk, blastChunkCount(organizationIds.length)),
        });
        if (!queue.length) break;
      }
      toast.success(`Sent ${sent} ${locked?.template_name || 'blast'}${sent === 1 ? '' : 's'}.`);
      const skipToast = formatBlastSkipToast(skipCounts);
      if (skipToast) toast.message(skipToast);
      if (remaining.length) {
        setResumeIds(remaining);
        writeStoredResume({
          blast_id: runId,
          template_key: templateKey,
          organization_ids: remaining,
        });
        toast.message(`${remaining.length} failed send${remaining.length === 1 ? '' : 's'} left on Continue remaining.`);
      } else {
        setResumeIds([]);
        clearStoredResume();
      }
      const logRes = await fetch('/api/god/invite/log', { headers, cache: 'no-store' });
      const logJson = await logRes.json().catch(() => ({}));
      setSends(logJson.sends || []);
      setConfirming(false);
      setSelected(new Set());
    } catch (e: unknown) {
      remaining = uniqueBlastOrganizationIds([...queue, ...retryableAcc]);
      setResumeIds(remaining);
      writeStoredResume({
        blast_id: runId,
        template_key: templateKey,
        organization_ids: remaining,
      });
      setProgress((prev) => ({
        queued: organizationIds.length,
        sent,
        skipped,
        failed,
        remaining: remaining.length,
        chunk,
        chunks: Math.max(chunk, blastChunkCount(organizationIds.length)),
        error: e instanceof Error ? e.message : 'Send failed',
      }));
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  async function sendSelected() {
    await sendChunks(selectedRows.map((org) => org.id), null);
  }

  async function continueRemaining() {
    const ids = resumeIds.length ? resumeIds : readStoredResume(templateKey)?.organization_ids || [];
    if (!ids.length) {
      toast.error('Nothing left to continue.');
      return;
    }
    setConfirming(true);
    await sendChunks(ids, blastId);
  }

  return (
    <section>
      {variant === 'page' ? (
        <>
          <h2 className="text-2xl font-bold mb-2">Email blast</h2>
          <p className="text-[var(--text3)] mb-4 max-w-3xl">
            Soft beta — no Ads. Pick a locked template, filter the audience, then check the orgs you
            want. Nothing is selected by default. Recipient is the organization email. clinic_invite
            skips repair companies.
          </p>
        </>
      ) : (
        <p className="text-[var(--text3)] mb-4 max-w-3xl">
          Locked God blasts. Nothing is selected by default. clinic_invite is for laser_clinic orgs
          with an org email — service companies are skipped.
        </p>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <label className="text-sm text-[var(--text3)] flex items-center gap-2">
          Template
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value as BlastTemplateKey)}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)]"
          >
            {TEMPLATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[220px]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
        >
          {TYPE_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2"
        >
          {PLAN_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <button type="button" className="btn btn-secondary text-xs" onClick={() => toggleVisible(true)}>
          Select visible
        </button>
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={selectClinicAudience}
          disabled={!clinicAudience.length}
        >
          Select laser clinics with org email
        </button>
        <button type="button" className="btn btn-secondary text-xs" onClick={() => setSelected(new Set())}>
          Clear selection
        </button>
        <span className="text-[var(--text3)]">
          {visible.length} shown · {selected.size} selected · {selectedEmailRows.length} selected
          with email · {orgs.length} total
        </span>
      </div>

      <div className="overflow-x-auto card mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
              <th className="p-3 w-10"></th>
              <th className="p-3">Organization</th>
              <th className="p-3">Type</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Org email</th>
              <th className="p-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((org) => {
              const key = String(org.id);
              const open = expanded === key;
              const recipient = pickBlastRecipient(org);
              return (
                <React.Fragment key={key}>
                  <tr className="border-b border-[var(--border)] hover:bg-[var(--surface3)]">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggle(org.id)}
                        aria-label={`Select ${org.name}`}
                      />
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-left font-semibold hover:text-[var(--gold)] bg-transparent border-0 p-0 text-inherit cursor-pointer"
                        onClick={() => setExpanded(open ? null : key)}
                      >
                        {org.name}
                      </button>
                    </td>
                    <td className="p-3">{org.typeLabel || orgTypeLabel(org.type)}</td>
                    <td className="p-3">{org.planLabel}</td>
                    <td className="p-3">{recipient || '—'}</td>
                    <td className="p-3 whitespace-nowrap">{formatDate(org.createdAt)}</td>
                  </tr>
                  {open && (
                    <tr className="bg-[var(--surface)]">
                      <td></td>
                      <td colSpan={5} className="p-3 text-[var(--text2)]">
                        <div className="mb-2 text-xs text-[var(--text3)]">
                          org.email: {org.orgEmail || '—'} · admin: {org.adminEmail || '—'}
                        </div>
                        {org.users.length === 0 ? (
                          <div>No users on this organization.</div>
                        ) : (
                          <ul className="space-y-1">
                            {org.users.map((u) => (
                              <li key={u.id}>
                                {u.name} · {u.email || 'no email'} · {u.role}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-[var(--text3)]">
                  No organizations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-xl font-bold">Preview and edit</h3>
            <p className="text-[var(--text3)] mt-1 max-w-3xl">
              Prefills from the locked template. Edits apply to this send only — they do not overwrite
              the source files. A browser draft is kept in localStorage so refresh does not wipe them.
              Outbound mail still gets List-Unsubscribe and the Somis footer if you remove it.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={resetToLocked}
            disabled={!locked || (!subjectCustomized && !bodyCustomized)}
          >
            Reset to locked template
          </button>
        </div>
        <p className="text-sm text-[var(--text3)] mb-3">
          Template:{' '}
          <span className="text-[var(--gold)]">{locked?.template_name || templateKey}</span>
          {subjectCustomized || bodyCustomized ? (
            <span> · customized for this send only</span>
          ) : (
            <span> · locked copy</span>
          )}
        </p>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-[var(--text3)]">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text)]"
                aria-label="Email subject"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--text3)]">HTML body</span>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-[280px] font-mono text-xs leading-5"
                aria-label="Email HTML body"
                spellCheck={false}
              />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--text3)]">Plain-text body</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-[160px] font-mono text-xs leading-5"
                aria-label="Email plain text body"
              />
            </label>
          </div>
          <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-[#0b0f14] min-h-[640px]">
            <iframe
              title="Email blast preview"
              srcDoc={previewHtml || ''}
              className="w-full min-h-[640px] h-full border-0 bg-[#0b0f14]"
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 mb-10">
        <button type="button" className="btn btn-primary" disabled={!canSend} onClick={openConfirm}>
          Send blast to {selectedEmailRows.length} with email
        </button>
        {resumeIds.length ? (
          <button type="button" className="btn btn-secondary" disabled={sending} onClick={continueRemaining}>
            Continue remaining ({resumeIds.length})
          </button>
        ) : null}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="card max-w-lg w-full p-6">
            <h3 className="text-xl font-bold mb-2">Send email blast?</h3>
            <dl className="text-sm mb-4 space-y-1">
              <div>
                <dt className="inline text-[var(--text3)]">Template: </dt>
                <dd className="inline">
                  {locked?.template_name || templateKey} ({templateKey})
                </dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Subject: </dt>
                <dd className="inline">{subject.trim() || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Body: </dt>
                <dd className="inline">
                  {bodyCustomized ? 'Customized for this send only' : 'Locked template'}
                </dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">From: </dt>
                <dd className="inline">{locked?.from || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Reply-To: </dt>
                <dd className="inline">{locked?.reply_to || '—'}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Recipient count: </dt>
                <dd className="inline">{selectedEmailRows.length}</dd>
              </div>
              <div>
                <dt className="inline text-[var(--text3)]">Chunk size: </dt>
                <dd className="inline">{BLAST_SEND_CHUNK_SIZE} per request</dd>
              </div>
            </dl>
            <p className="text-sm text-[var(--text3)] mb-3">
              This emails the edited subject and body to each selected organization email. Large
              sends go in chunks of {BLAST_SEND_CHUNK_SIZE} so Netlify cannot time out mid-flight.
              Already-logged recipients for this template in the last 24 hours are skipped. Edits
              apply to this send only. Nothing else is written on those orgs.
            </p>
            {progress ? (
              <p className="text-sm mb-3" aria-live="polite">
                {progress.error
                  ? `Stopped after chunk ${progress.chunk}: ${progress.error}. ${progress.remaining} remaining.`
                  : sending
                    ? `Sending chunk ${progress.chunk} of ${progress.chunks} · ${progress.sent} sent · ${progress.skipped} skipped · ${progress.failed} failed · ${progress.remaining} remaining`
                    : `${progress.sent} sent · ${progress.skipped} skipped · ${progress.failed} failed · ${progress.remaining} remaining`}
              </p>
            ) : null}
            <ul className="text-sm mb-5 max-h-40 overflow-y-auto space-y-1">
              {selectedRows.map((org) => (
                <li key={String(org.id)}>
                  <strong>{org.name}</strong> → {pickBlastRecipient(org) || 'no email'}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={sending}
                onClick={() => setConfirming(false)}
              >
                {progress?.error && resumeIds.length ? 'Hide' : 'Cancel'}
              </button>
              {progress?.error && resumeIds.length ? (
                <button type="button" className="btn btn-primary" disabled={sending} onClick={continueRemaining}>
                  Continue remaining ({resumeIds.length})
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={sending} onClick={sendSelected}>
                  {sending ? 'Sending…' : 'Confirm send'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <section>
        <h3 className="text-xl font-bold mb-2">Send log</h3>
        <p className="text-[var(--text3)] mb-3">Who already got a God blast or shop invite. Manual sends only.</p>
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
                <th className="p-3">When</th>
                <th className="p-3">Template</th>
                <th className="p-3">Organization</th>
                <th className="p-3">Recipient</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]">
                  <td className="p-3 whitespace-nowrap">{formatDate(row.created_at)}</td>
                  <td className="p-3">{row.template_key || '—'}</td>
                  <td className="p-3">{row.organization_name || row.organization_id}</td>
                  <td className="p-3">{row.recipient_email}</td>
                  <td className="p-3">{row.unsubscribed_at ? 'Unsubscribed' : 'Sent'}</td>
                </tr>
              ))}
              {sends.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-[var(--text3)]">
                    No blasts sent from this dashboard yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
