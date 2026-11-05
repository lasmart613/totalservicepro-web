'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useT, useSiteLocale } from '@/lib/fa/locale';
import { Header } from '@/components/Header';
import { WantedBudget } from '@/components/marketplace/WantedBudget';
import { getSupabaseClient } from '@/lib/supabase/client';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import { formatLocaleDate } from '@/lib/i18n/format-date';
import { useSignedIn } from '@/lib/use-signed-in';
import {
  WANTED_CONDITION_LABEL,
  WANTED_PUBLIC_SELECT,
  WANTED_STATUS_LABEL,
  canManageWanted,
  wantedLocationLabel,
  wantedModalityLabel,
  type WantedRecord,
  type WantedStatus,
} from '@/lib/marketplace/wanted';

type WantedMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at?: string | null;
};

export function WantedDetail({ postId }: { postId: string }) {
  const t = useT();
  const locale = useSiteLocale();
  const { signedIn } = useSignedIn();
  const [post, setPost] = useState<WantedRecord | null>(null);
  const [messages, setMessages] = useState<WantedMessage[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const load = async () => {
    const supabase = getSupabaseClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    setUserId(user?.id || null);
    let row: WantedRecord | null = null;
    const direct = await supabase.from('marketplace_wanted').select(WANTED_PUBLIC_SELECT).eq('id', postId).maybeSingle();
    if (!direct.error && direct.data) row = direct.data as unknown as WantedRecord;
    const headers = await marketplaceAuthHeaders();
    if (!row) {
      const res = await fetch(`/api/marketplace/wanted/${postId}`, { cache: 'no-store', headers });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.post) row = json.post as WantedRecord;
    }
    setPost(row);
    if (user && row) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, organization_id, organizations(type)')
        .eq('id', user.id)
        .maybeSingle();
      const org = (profile as { organizations?: { type?: string | null } | { type?: string | null }[] | null } | null)?.organizations;
      const orgType = Array.isArray(org) ? org[0]?.type : org?.type;
      const { data: memberships } = await supabase.from('organization_memberships').select('organization_id').eq('user_id', user.id);
      setCanManage(
        canManageWanted(row, {
          userId: user.id,
          orgId: (profile as { organization_id?: number | null } | null)?.organization_id,
          role: (profile as { role?: string } | null)?.role,
          orgType,
          membershipOrgIds: (memberships || []).map((item) => item.organization_id),
        })
      );
      const res = await fetch(`/api/marketplace/wanted/${postId}/messages`, { cache: 'no-store', headers });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.messages)) setMessages(json.messages as WantedMessage[]);
    } else {
      setCanManage(false);
      setMessages([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // Reload when the signed-in flag settles so messages appear after auth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, signedIn]);

  const setStatus = async (status: WantedStatus) => {
    const headers = await marketplaceAuthHeaders();
    const res = await fetch(`/api/marketplace/wanted/${postId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(t(json.error || 'That wanted post could not be saved.'));
      return;
    }
    toast.success(t('Wanted post saved.'));
    setPost(json.post as WantedRecord);
  };

  const send = async () => {
    setSending(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch(`/api/marketplace/wanted/${postId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t(json.error || 'Could not send that message.'));
        return;
      }
      setDraft('');
      if (json.message) setMessages((prev) => [...prev, json.message as WantedMessage]);
    } finally {
      setSending(false);
    }
  };

  const statusKey = (post?.status || 'open') as WantedStatus;
  const closed = post?.status === 'closed';

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace/wanted" className="text-sm text-[var(--gold)] hover:underline">
          {t('Back to Wanted')}
        </Link>
        {loading ? (
          <div className="card p-8 mt-4 text-center text-[var(--text3)]">{t('Loading wanted posts...')}</div>
        ) : !post ? (
          <div className="card p-8 mt-4 text-center">{t('That wanted post was not found.')}</div>
        ) : (
          <article className="card p-6 mt-4 text-left">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <h1 className="text-3xl font-extrabold">{post.title}</h1>
              <span className="text-xs font-semibold px-2 py-1 rounded-full border border-[var(--gold)]/40">
                {t(WANTED_STATUS_LABEL[statusKey] || WANTED_STATUS_LABEL.open)}
              </span>
            </div>
            <p className="text-sm text-[var(--text3)] mb-3">
              {t('Free listing')}
              {post.created_at ? ` · ${formatLocaleDate(post.created_at, locale)}` : ''}
            </p>
            <p className="whitespace-pre-wrap mb-4">{post.description}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
              <div>
                <dt className="text-[var(--text3)]">{t('Modality')}</dt>
                <dd>{t(wantedModalityLabel(post.modality))}</dd>
              </div>
              <div>
                <dt className="text-[var(--text3)]">{t('Preferred condition')}</dt>
                <dd>{t(WANTED_CONDITION_LABEL[post.preferred_condition || 'any'])}</dd>
              </div>
              <div>
                <dt className="text-[var(--text3)]">{t('Make (if known)')}</dt>
                <dd>{post.manufacturer || t('Not specified')}</dd>
              </div>
              <div>
                <dt className="text-[var(--text3)]">{t('Model (if known)')}</dt>
                <dd>{post.model || t('Not specified')}</dd>
              </div>
              <div>
                <dt className="text-[var(--text3)]">{t('Location')}</dt>
                <dd>{wantedLocationLabel(post) || t('Not specified')}</dd>
              </div>
              <div>
                <dt className="text-[var(--text3)]">{t('Budget (optional)')}</dt>
                <dd>{wantedBudgetViewEmpty(post) ? t('Not specified') : <WantedBudget post={post} />}</dd>
              </div>
            </dl>
            {post.poster_name || post.contact_name ? (
              <p className="text-sm mb-4">
                {t('Posted by')} {post.poster_name || t('Organization')}
                {post.contact_name ? ` · ${post.contact_name}` : ''}
              </p>
            ) : null}
            <p className="text-sm text-[var(--text3)] mb-4">
              {post.contact_via === 'org'
                ? t('Contact through the organization. Email and phone stay on the organization profile and are not published on this board.')
                : t('Reach them with a message. Email and phone are not shown on this board.')}
            </p>
            {canManage ? (
              <div className="flex flex-wrap gap-2 mb-6">
                <Link href={`/marketplace/wanted/${post.id}/edit`} className="btn btn-secondary text-sm">
                  {t('Edit wanted post')}
                </Link>
                {post.status !== 'filled' ? (
                  <button type="button" className="btn btn-secondary text-sm" onClick={() => void setStatus('filled')}>
                    {t('Mark filled')}
                  </button>
                ) : null}
                {post.status !== 'closed' ? (
                  <button type="button" className="btn btn-secondary text-sm" onClick={() => void setStatus('closed')}>
                    {t('Close wanted post')}
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary text-sm" onClick={() => void setStatus('open')}>
                    {t('Reopen wanted post')}
                  </button>
                )}
              </div>
            ) : null}
            <section>
              <h2 className="font-bold text-lg mb-2">{t('Messages on this post')}</h2>
              {!signedIn ? (
                <Link href="/login" className="text-[var(--gold)] hover:underline">
                  {t('Sign in to message the buyer.')}
                </Link>
              ) : (
                <>
                  {messages.length === 0 ? <p className="text-sm text-[var(--text3)] mb-3">{t('No messages yet.')}</p> : null}
                  <ul className="space-y-2 mb-4">
                    {messages.map((message) => (
                      <li key={message.id} className="bg-[var(--surface3)] rounded p-3 text-sm">
                        <div className="text-xs text-[var(--text3)] mb-1">
                          {message.sender_id === userId
                            ? t('You')
                            : message.sender_id === post.created_by
                              ? post.poster_name || t('Buyer')
                              : t('Organization reply')}
                          {message.created_at ? ` · ${formatLocaleDate(message.created_at, locale)}` : ''}
                        </div>
                        <p className="whitespace-pre-wrap">{message.body}</p>
                      </li>
                    ))}
                  </ul>
                  {closed ? (
                    <p className="text-sm text-[var(--text3)]">{t('This wanted post is closed.')}</p>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                      }}
                    >
                      <label className="label block" htmlFor="wanted-message">
                        {t('Your message')}
                        <textarea
                          id="wanted-message"
                          className="input mt-1 min-h-[90px]"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                      </label>
                      <button type="submit" className="btn btn-primary mt-3" disabled={sending}>
                        {t('Send message')}
                      </button>
                    </form>
                  )}
                  <p className="text-xs text-[var(--text3)] mt-3">
                    {t('Only you, the posting organization, and people who write here can read these messages.')}
                  </p>
                </>
              )}
            </section>
          </article>
        )}
      </div>
    </div>
  );
}

function wantedBudgetViewEmpty(post: WantedRecord): boolean {
  return (post.budget_min == null || post.budget_min === ('' as unknown)) && (post.budget_max == null || post.budget_max === ('' as unknown));
}
