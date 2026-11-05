'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { EQUIPMENT_TYPES } from '@/lib/equipment-types';
import { canPostWanted } from '@/lib/roles';
import {
  WANTED_CONDITIONS,
  WANTED_CONDITION_LABEL,
  WANTED_CONTACT,
  WANTED_PUBLIC_SELECT,
  prefillWantedFromOrg,
  type OrgWantedPrefill,
  type WantedContact,
  type WantedRecord,
  type WantedWrite,
} from '@/lib/marketplace/wanted';

type OrgChoice = OrgWantedPrefill & { id: number; type?: string | null };

const EMPTY: WantedWrite = {
  title: '',
  description: '',
  manufacturer: null,
  model: null,
  modality: 'laser',
  preferred_condition: 'any',
  city: null,
  state: null,
  country: null,
  service_area: null,
  budget_min: null,
  budget_max: null,
  currency: 'USD',
  contact_via: 'message',
  poster_name: null,
  contact_name: null,
};

function text(value: string | null | undefined): string {
  return value || '';
}

export function WantedForm({ postId }: { postId?: string }) {
  const t = useT();
  const router = useRouter();
  const editing = Boolean(postId);
  const [form, setForm] = useState<WantedWrite>(EMPTY);
  const [orgs, setOrgs] = useState<OrgChoice[]>([]);
  const [orgId, setOrgId] = useState<number | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        if (!cancelled) setReady(true);
        return;
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, organization_id, organizations(id, name, type, city, state, country, contact_name, service_territories)')
        .eq('id', user.id)
        .maybeSingle();
      const profileOrg = unwrapOrg((profile as { organizations?: unknown } | null)?.organizations);
      const role = (profile as { role?: string } | null)?.role;
      const { data: memberships } = await supabase
        .from('organization_memberships')
        .select('organization_id, organizations(id, name, type, city, state, country, contact_name, service_territories)')
        .eq('user_id', user.id);
      const choices = new Map<number, OrgChoice>();
      for (const row of memberships || []) {
        const org = unwrapOrg((row as { organizations?: unknown }).organizations);
        const id = Number((row as { organization_id?: number }).organization_id);
        if (org && Number.isSafeInteger(id)) choices.set(id, { ...org, id });
      }
      if (profileOrg?.id && !choices.has(profileOrg.id)) choices.set(profileOrg.id, profileOrg);
      const list = [...choices.values()];
      const activeId = Number((profile as { organization_id?: number } | null)?.organization_id) || list[0]?.id || null;
      if (!cancelled) {
        setOrgs(list);
        setOrgId(activeId);
        setAllowed(canPostWanted(role, (profileOrg || list.find((item) => item.id === activeId))?.type));
      }
      if (postId) {
        const { data } = await supabase.from('marketplace_wanted').select(WANTED_PUBLIC_SELECT).eq('id', postId).maybeSingle();
        if (!cancelled && data) {
          const row = data as unknown as WantedRecord;
          setOrgId(row.organization_id == null ? activeId : Number(row.organization_id));
          setMissing(false);
          setForm({
            title: row.title,
            description: row.description,
            manufacturer: row.manufacturer,
            model: row.model,
            modality: row.modality,
            preferred_condition: row.preferred_condition,
            city: row.city,
            state: row.state,
            country: row.country,
            service_area: row.service_area,
            budget_min: row.budget_min,
            budget_max: row.budget_max,
            currency: row.currency || 'USD',
            contact_via: row.contact_via,
            poster_name: row.poster_name,
            contact_name: row.contact_name,
          });
        } else if (!cancelled) {
          setMissing(true);
        }
      } else if (!cancelled) {
        const org = list.find((item) => item.id === activeId) || profileOrg;
        const location = await loadLocation(supabase, activeId);
        setForm((prev) => ({ ...prev, ...EMPTY, ...prefillWantedFromOrg(org, location) }));
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const setText = (key: keyof WantedWrite, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onOrg = async (nextId: number) => {
    setOrgId(nextId);
    const org = orgs.find((item) => item.id === nextId);
    if (!org || editing) return;
    const location = await loadLocation(getSupabaseClient(), nextId);
    const filled = prefillWantedFromOrg(org, location);
    setForm((prev) => ({
      ...prev,
      poster_name: filled.poster_name ?? prev.poster_name,
      contact_name: filled.contact_name ?? prev.contact_name,
      city: filled.city ?? null,
      state: filled.state ?? null,
      country: filled.country ?? null,
      service_area: filled.service_area ?? null,
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const payload = {
        ...form,
        organization_id: orgId,
        budget_min: form.budget_min === ('' as unknown) ? null : form.budget_min,
        budget_max: form.budget_max === ('' as unknown) ? null : form.budget_max,
      };
      const res = await fetch(editing ? `/api/marketplace/wanted/${postId}` : '/api/marketplace/wanted', {
        method: editing ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t(json.error || 'That wanted post could not be saved.'));
        return;
      }
      toast.success(t('Wanted post saved.'));
      const id = json.post?.id || postId;
      router.push(id ? `/marketplace/wanted/${id}` : '/marketplace/wanted');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace/wanted" className="text-sm text-[var(--gold)] hover:underline">
          {t('Back to Wanted')}
        </Link>
        <h1 className="text-3xl font-extrabold mt-3 mb-2">{editing ? t('Edit wanted post') : t('Post a Wanted')}</h1>
        <p className="text-[var(--text3)] mb-6">
          {t('Wanted posts stay free. There is no charge to post or to view them.')}
        </p>
        {!ready ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading wanted posts...')}</div>
        ) : missing ? (
          <div className="card p-6 mt-4">{t('That wanted post was not found.')}</div>
        ) : !allowed ? (
          <div className="card p-6">{t('You need an organization membership to post a wanted listing.')}</div>
        ) : (
          <form
            className="card p-6 space-y-4 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {orgs.length > 1 ? (
              <label className="label block">
                {t('Posted by')}
                <select className="input mt-1" value={orgId ?? ''} onChange={(e) => void onOrg(Number(e.target.value))}>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="label block">
              {t('Title')}
              <input className="input mt-1" value={form.title} onChange={(e) => setText('title', e.target.value)} required />
            </label>
            <label className="label block">
              {t('Equipment sought')}
              <textarea
                className="input mt-1 min-h-[120px]"
                value={form.description}
                onChange={(e) => setText('description', e.target.value)}
                required
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="label block">
                {t('Make (if known)')}
                <input className="input mt-1" value={text(form.manufacturer)} onChange={(e) => setText('manufacturer', e.target.value)} />
              </label>
              <label className="label block">
                {t('Model (if known)')}
                <input className="input mt-1" value={text(form.model)} onChange={(e) => setText('model', e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="label block">
                {t('Modality')}
                <select
                  className="input mt-1"
                  value={form.modality}
                  onChange={(e) => setForm((prev) => ({ ...prev, modality: e.target.value as WantedWrite['modality'] }))}
                >
                  {EQUIPMENT_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {t(item.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label block">
                {t('Preferred condition')}
                <select
                  className="input mt-1"
                  value={form.preferred_condition}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, preferred_condition: e.target.value as WantedWrite['preferred_condition'] }))
                  }
                >
                  {WANTED_CONDITIONS.map((value) => (
                    <option key={value} value={value}>
                      {t(WANTED_CONDITION_LABEL[value])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-sm text-[var(--text3)]">{t('Location starts from your organization. Change anything that should be public.')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="label block">
                {t('City')}
                <input className="input mt-1" value={text(form.city)} onChange={(e) => setText('city', e.target.value)} />
              </label>
              <label className="label block">
                {t('State')}
                <input className="input mt-1" value={text(form.state)} onChange={(e) => setText('state', e.target.value)} />
              </label>
              <label className="label block">
                {t('Country')}
                <input className="input mt-1" value={text(form.country)} onChange={(e) => setText('country', e.target.value)} />
              </label>
            </div>
            <label className="label block">
              {t('Service area')}
              <input className="input mt-1" value={text(form.service_area)} onChange={(e) => setText('service_area', e.target.value)} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="label block">
                {t('Minimum budget')}
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  step="1"
                  value={form.budget_min ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, budget_min: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </label>
              <label className="label block">
                {t('Maximum budget')}
                <input
                  className="input mt-1"
                  type="number"
                  min={0}
                  step="1"
                  value={form.budget_max ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, budget_max: e.target.value === '' ? null : Number(e.target.value) }))}
                />
              </label>
              <label className="label block">
                {t('Currency')}
                <input className="input mt-1" value={form.currency} onChange={(e) => setText('currency', e.target.value.toUpperCase())} />
              </label>
            </div>
            <p className="text-xs text-[var(--text3)]">{t('Budget (optional)')}</p>
            <fieldset>
              <legend className="label mb-2">{t('Contact')}</legend>
              {WANTED_CONTACT.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm mb-2">
                  <input
                    type="radio"
                    name="contact_via"
                    checked={form.contact_via === value}
                    onChange={() => setForm((prev) => ({ ...prev, contact_via: value as WantedContact }))}
                  />
                  {value === 'message' ? t('Contact through messages') : t('Contact through the organization')}
                </label>
              ))}
              <p className="text-xs text-[var(--text3)]">
                {t('Email and phone stay on the organization profile and are not published on this board.')}
              </p>
            </fieldset>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="label block">
                {t('Organization name')}
                <input className="input mt-1" value={text(form.poster_name)} onChange={(e) => setText('poster_name', e.target.value)} />
              </label>
              <label className="label block">
                {t('Contact name')}
                <input className="input mt-1" value={text(form.contact_name)} onChange={(e) => setText('contact_name', e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('Saving...') : editing ? t('Save') : t('Post a Wanted')}
              </button>
              <Link href={editing ? `/marketplace/wanted/${postId}` : '/marketplace/wanted'} className="btn btn-secondary">
                {t('Cancel')}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function unwrapOrg(value: unknown): OrgChoice | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const org = row as OrgWantedPrefill & { id?: number; type?: string | null };
  const id = Number(org.id);
  if (!Number.isSafeInteger(id)) return null;
  return { ...org, id };
}

async function loadLocation(
  supabase: ReturnType<typeof getSupabaseClient>,
  organizationId: number | null
): Promise<{ city?: string | null; state?: string | null } | null> {
  if (!organizationId) return null;
  const { data } = await supabase
    .from('locations')
    .select('city, state, is_primary')
    .eq('organization_id', organizationId)
    .order('is_primary', { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}
