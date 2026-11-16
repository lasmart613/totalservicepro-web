'use client';

/**
 * Public company profile for a listed organization.
 * Logged-out directory cards open this page. It is the direct
 * profile: name, place, average, and visible reviews. Contact details stay
 * off this page.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { OrgRatingBadge } from '@/components/directory/OrgRatingBadge';
import { PublicLink, useT } from '@/lib/fa/locale';
import { getSupabaseClient } from '@/lib/supabase/client';
import { orgTypeLabel } from '@/lib/labels';
import type { PublicOrgProfile, PublicReview } from '@/lib/reviews';
import { replyEditOpen, REVIEW_EDIT_WINDOW_DAYS } from '@/lib/reviews';

type EligibleJob = {
  customer_organization_id: number;
  job_key: string;
  ticket_id: number | null;
  report_id: string | null;
  invoice_id: number | null;
  source: string;
  reference: string | null;
  already_rated: boolean;
  review_id: string | null;
  stars: number | null;
  body: string | null;
  can_edit: boolean;
};

function jobLabel(t: (text: string) => string, job: EligibleJob): string {
  const kind =
    job.source === 'report'
      ? t('Completed service report')
      : job.source === 'invoice'
        ? t('Paid invoice')
        : t('Completed ticket');
  return job.reference ? `${kind} ${job.reference}` : kind;
}

export default function DirectoryOrgProfile() {
  const params = useParams<{ id: string }>();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] || '' : String(rawId || '');
  const t = useT();
  const [profile, setProfile] = useState<PublicOrgProfile | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [jobs, setJobs] = useState<EligibleJob[]>([]);
  const [canReply, setCanReply] = useState(false);
  const [jobKey, setJobKey] = useState('');
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const loadContext = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setSignedIn(false);
      return;
    }
    setSignedIn(true);
    const res = await fetch(`/api/reviews/context?serviceOrgId=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const next = Array.isArray(json.jobs) ? (json.jobs as EligibleJob[]) : [];
    setJobs(next);
    setCanReply(json.canReply === true);
    setJobKey((current) => current || next[0]?.job_key || '');
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/directory/profile?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json.profile) {
          setMissing(true);
          setProfile(null);
          return;
        }
        setProfile(json.profile as PublicOrgProfile);
        setReviews(Array.isArray(json.reviews) ? json.reviews : []);
        await loadContext();
      } catch {
        if (!cancelled) setMissing(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadContext]);

  const selected = jobs.find((job) => job.job_key === jobKey) || null;

  useEffect(() => {
    if (!selected) return;
    setStars(selected.stars || 0);
    setText(selected.body || '');
  }, [selected]);

  async function authHeader(): Promise<Record<string, string> | null> {
    const { data } = await getSupabaseClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async function saveRating(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const headers = await authHeader();
      if (!headers) {
        setMessage(t('Sign in to rate this company.'));
        return;
      }
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reviewId: selected.review_id || undefined,
          serviceOrganizationId: Number(id),
          customerOrganizationId: selected.customer_organization_id,
          ticketId: selected.ticket_id,
          reportId: selected.report_id,
          invoiceId: selected.invoice_id,
          stars,
          body: text,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(t(json.error || 'Could not save the rating.'));
        return;
      }
      setMessage(t('Rating saved.'));
      const refreshed = await fetch(`/api/directory/profile?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const next = await refreshed.json().catch(() => ({}));
      if (next.profile) {
        setProfile(next.profile);
        setReviews(Array.isArray(next.reviews) ? next.reviews : []);
      }
      await loadContext();
    } finally {
      setSaving(false);
    }
  }

  async function saveReply(reviewId: string) {
    const headers = await authHeader();
    if (!headers) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/reviews/reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: reviewId, body: replyText[reviewId] || '' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(t(json.error || 'Only an owner or company admin can reply.'));
        return;
      }
      setMessage(t('Reply posted.'));
      const refreshed = await fetch(`/api/directory/profile?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const next = await refreshed.json().catch(() => ({}));
      if (Array.isArray(next.reviews)) setReviews(next.reviews);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        <PublicLink href="/directory" className="text-[var(--gold)] text-sm font-bold">
          {t('Company directory')}
        </PublicLink>
        {loading ? (
          <p className="text-[var(--text3)] py-12">{t('Loading reviews…')}</p>
        ) : missing || !profile ? (
          <p className="text-[var(--text3)] py-12">{t('This company is not in the public directory.')}</p>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold mt-3">{profile.name || t('Organization')}</h1>
            <p className="text-[11px] font-bold text-[var(--gold)] mt-1">{t(orgTypeLabel(profile.type) || 'Organization')}</p>
            <OrgRatingBadge count={profile.ratingCount} average={profile.ratingAverage} />
            <p className="text-sm text-[var(--text3)] mt-1">
              {[profile.city, profile.state].filter(Boolean).join(', ')}
            </p>
            {profile.slogan ? <p className="mt-3 font-semibold">{profile.slogan}</p> : null}
            {profile.description ? <p className="mt-2 text-sm leading-relaxed">{profile.description}</p> : null}
            {profile.bio ? <p className="mt-2 text-sm leading-relaxed">{profile.bio}</p> : null}
            {profile.website ? (
              <p className="mt-3 text-sm">
                <a href={/^https?:\/\//i.test(profile.website) ? profile.website : `https://${profile.website}`} className="text-[var(--gold)] hover:underline" target="_blank" rel="noopener noreferrer">
                  {t('Website')}
                </a>
              </p>
            ) : null}

            <section className="mt-8" aria-labelledby="rate-heading">
              <h2 id="rate-heading" className="text-lg font-extrabold mb-2">{t('Rate this company')}</h2>
              {!signedIn ? (
                <p className="text-sm text-[var(--text3)]">
                  <PublicLink href="/login" className="text-[var(--gold)] hover:underline">
                    {t('Sign in to rate this company.')}
                  </PublicLink>
                </p>
              ) : jobs.length === 0 ? (
                <p className="text-sm text-[var(--text3)]">{t('No completed job with this company yet.')}</p>
              ) : (
                <form onSubmit={saveRating} className="card p-4 space-y-3">
                  <label className="block text-sm">
                    <span className="font-bold">{t('Choose a completed job')}</span>
                    <select className="input w-full mt-1" value={jobKey} onChange={(e) => setJobKey(e.target.value)}>
                      {jobs.map((job) => (
                        <option key={job.job_key} value={job.job_key}>
                          {jobLabel(t, job)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected?.already_rated && !selected.review_id ? (
                    <p className="text-sm">{t('Your clinic already rated this job.')}</p>
                  ) : selected?.already_rated && selected.review_id && !selected.can_edit ? (
                    <p className="text-sm">{t('This rating can no longer be edited.')}</p>
                  ) : (
                    <>
                      <fieldset>
                        <legend className="text-sm font-bold">{t('Stars')}</legend>
                        <div className="flex gap-3 mt-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <label key={n} className="text-sm font-bold">
                              <input
                                type="radio"
                                name="review-stars"
                                className="mr-1"
                                checked={stars === n}
                                onChange={() => setStars(n)}
                                required
                              />
                              {n}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label className="block text-sm">
                        <span className="font-bold">{t('Written review (optional)')}</span>
                        <textarea
                          className="input w-full mt-1 min-h-24"
                          value={text}
                          maxLength={4000}
                          onChange={(e) => setText(e.target.value)}
                        />
                      </label>
                      <p className="text-xs text-[var(--text3)]">
                        {t('You can edit this rating for 30 days.').replace('30', String(REVIEW_EDIT_WINDOW_DAYS))}
                      </p>
                      <button type="submit" className="btn btn-primary" disabled={saving}>
                        {selected?.review_id ? t('Update rating') : t('Submit rating')}
                      </button>
                    </>
                  )}
                </form>
              )}
              {message ? <p className="text-sm mt-3">{message}</p> : null}
            </section>

            <section className="mt-8" aria-labelledby="reviews-heading">
              <h2 id="reviews-heading" className="text-lg font-extrabold mb-3">{t('Customer reviews')}</h2>
              {reviews.length === 0 ? (
                <p className="text-sm text-[var(--text3)]">{t('No reviews yet.')}</p>
              ) : (
                <ul className="space-y-3">
                  {reviews.map((review) => (
                    <li key={review.id} className="card p-4">
                      <p className="font-bold text-[var(--gold)]" aria-label={t('Stars')}>
                        {'★'.repeat(review.stars)}
                        <span className="sr-only">{review.stars}</span>
                      </p>
                      {review.body ? <p className="text-sm mt-2 whitespace-pre-wrap">{review.body}</p> : null}
                      {review.reply_body ? (
                        <p className="text-sm mt-3">
                          <span className="font-bold">{t('Company reply')}: </span>
                          {review.reply_body}
                        </p>
                      ) : null}
                      {canReply && replyEditOpen(review.reply_at) ? (
                        <div className="mt-3">
                          <label className="block text-sm">
                            <span className="font-bold">{t('Reply to this review')}</span>
                            <textarea
                              className="input w-full mt-1 min-h-20"
                              maxLength={2000}
                              value={replyText[review.id] ?? review.reply_body ?? ''}
                              onChange={(e) => setReplyText((prev) => ({ ...prev, [review.id]: e.target.value }))}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-secondary mt-2"
                            disabled={saving}
                            onClick={() => void saveReply(review.id)}
                          >
                            {t('Post reply')}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
