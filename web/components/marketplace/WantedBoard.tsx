'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PublicLink, useT } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { WantedBudget } from '@/components/marketplace/WantedBudget';
import { getSupabaseClient } from '@/lib/supabase/client';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { EQUIPMENT_TYPES } from '@/lib/equipment-types';
import { canPostWanted } from '@/lib/roles';
import { useSignedIn } from '@/lib/use-signed-in';
import {
  WANTED_CONDITIONS,
  WANTED_CONDITION_LABEL,
  WANTED_PUBLIC_SELECT,
  WANTED_STATUSES,
  WANTED_STATUS_LABEL,
  filterWantedPosts,
  isMissingWantedTable,
  isPublicWantedStatus,
  wantedBelongsToActor,
  wantedLocationLabel,
  wantedModalityLabel,
  type WantedRecord,
} from '@/lib/marketplace/wanted';

const EMPTY_FILTERS = { query: '', modality: '', condition: '', status: '', state: '' };

export function WantedBoard() {
  const t = useT();
  const { signedIn } = useSignedIn();
  const [posts, setPosts] = useState<WantedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(false);
  const [canPost, setCanPost] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const supabase = getSupabaseClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      let actorOrgId: string | number | null = null;
      const membershipOrgIds: Array<string | number> = [];
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role, organization_id, organizations(type)')
          .eq('id', user.id)
          .maybeSingle();
        const org = (profile as { organizations?: { type?: string | null } | { type?: string | null }[] | null } | null)
          ?.organizations;
        const orgType = Array.isArray(org) ? org[0]?.type : org?.type;
        actorOrgId = (profile as { organization_id?: string | number | null } | null)?.organization_id ?? null;
        if (!cancelled) setCanPost(canPostWanted((profile as { role?: string } | null)?.role, orgType));
        const { data: memberships } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', user.id);
        for (const row of memberships || []) {
          if (row?.organization_id != null) membershipOrgIds.push(row.organization_id);
        }
      }
      const columns = WANTED_PUBLIC_SELECT;
      let rows: WantedRecord[] = [];
      const query = supabase.from('marketplace_wanted').select(columns).order('created_at', { ascending: false }).limit(200);
      const { data, error } = await query;
      if (!error && data) {
        rows = data as unknown as WantedRecord[];
      } else if (!isMissingWantedTable(error)) {
        try {
          const headers = await marketplaceAuthHeaders();
          const res = await fetch(mine ? '/api/marketplace/wanted?mine=1' : '/api/marketplace/wanted', {
            cache: 'no-store',
            headers,
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(json.posts)) rows = json.posts as WantedRecord[];
        } catch {
          rows = [];
        }
      }
      if (cancelled) return;
      const visible = mine && user
        ? rows.filter((row) => wantedBelongsToActor(row, { userId: user.id, orgId: actorOrgId, membershipOrgIds }))
        : rows.filter((row) => isPublicWantedStatus(row.status));
      setPosts(visible);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, mine]);

  const filtered = useMemo(() => filterWantedPosts(posts, filters), [posts, filters]);
  const filtersOn = Object.values(filters).some(Boolean);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-extrabold">{t('Wanted')}</h1>
            <p className="text-[var(--text3)]">
              {t('Buyers post the laser or medical aesthetic equipment they are looking for. These listings are free.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PublicLink href="/marketplace" className="btn btn-secondary whitespace-nowrap">
              {t('Marketplace Home')}
            </PublicLink>
            {signedIn && canPost ? (
              <Link href="/marketplace/wanted/new" className="btn btn-primary whitespace-nowrap">
                {t('Post a Wanted')}
              </Link>
            ) : null}
          </div>
        </div>

        <p className="text-sm text-[var(--text3)] mb-4">{t('Wanted posts stay free. There is no charge to post or to view them.')}</p>

        <div className="card p-4 md:p-5 mb-6 text-left">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <label className="label flex-1 min-w-[12rem]" htmlFor="wanted-search">
              {t('Search wanted posts')}
              <input
                id="wanted-search"
                className="input mt-1"
                type="search"
                value={filters.query}
                onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
              />
            </label>
            {signedIn ? (
              <button type="button" className={`btn ${mine ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMine((v) => !v)}>
                {t('My wanted posts')}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="label" htmlFor="wanted-modality">
              {t('Modality')}
              <select
                id="wanted-modality"
                className="input mt-1"
                value={filters.modality}
                onChange={(e) => setFilters((prev) => ({ ...prev, modality: e.target.value }))}
              >
                <option value="">{t('All modalities')}</option>
                {EQUIPMENT_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="label" htmlFor="wanted-condition">
              {t('Preferred condition')}
              <select
                id="wanted-condition"
                className="input mt-1"
                value={filters.condition}
                onChange={(e) => setFilters((prev) => ({ ...prev, condition: e.target.value }))}
              >
                <option value="">{t('All conditions')}</option>
                {WANTED_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(WANTED_CONDITION_LABEL[value])}
                  </option>
                ))}
              </select>
            </label>
            <label className="label" htmlFor="wanted-status">
              {t('Status')}
              <select
                id="wanted-status"
                className="input mt-1"
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="">{t('All statuses')}</option>
                {WANTED_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(WANTED_STATUS_LABEL[value])}
                  </option>
                ))}
              </select>
            </label>
            <label className="label" htmlFor="wanted-state">
              {t('State')}
              <input
                id="wanted-state"
                className="input mt-1"
                value={filters.state}
                onChange={(e) => setFilters((prev) => ({ ...prev, state: e.target.value }))}
              />
            </label>
          </div>
          {filtersOn ? (
            <button type="button" className="btn btn-secondary mt-3 text-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t('Clear filters')}
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">{t('Loading wanted posts...')}</div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-lg mb-2">{posts.length === 0 ? t('No wanted posts yet.') : t('No wanted posts match these filters.')}</p>
            {!signedIn ? (
              <Link href="/login" className="text-[var(--gold)] hover:underline">
                {t('Sign in to post a wanted listing.')}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((post) => (
              <Link key={post.id} href={`/marketplace/wanted/${post.id}`} className="card p-6 hover:border-[var(--gold)] block text-left">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2 className="font-bold text-xl">{post.title}</h2>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--gold)]/40 whitespace-nowrap">
                    {t(WANTED_STATUS_LABEL[(post.status as keyof typeof WANTED_STATUS_LABEL) || 'open'] || WANTED_STATUS_LABEL.open)}
                  </span>
                </div>
                <p className="text-sm text-[var(--text3)] mb-2">
                  {t(wantedModalityLabel(post.modality))}
                  {post.manufacturer || post.model ? ` · ${[post.manufacturer, post.model].filter(Boolean).join(' ')}` : ''}
                </p>
                <p className="text-sm mb-2">{t(WANTED_CONDITION_LABEL[post.preferred_condition || 'any'])}</p>
                {wantedLocationLabel(post) ? <p className="text-sm text-[var(--text3)] mb-2">{wantedLocationLabel(post)}</p> : null}
                <p className="text-sm font-semibold text-[var(--gold)]">
                  <WantedBudget post={post} />
                </p>
                {post.poster_name ? (
                  <p className="text-xs text-[var(--text3)] mt-3">
                    {t('Posted by')} {post.poster_name}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
