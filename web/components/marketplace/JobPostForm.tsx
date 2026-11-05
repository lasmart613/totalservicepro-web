'use client';

import React, { useState } from 'react';
import { useT } from '@/lib/fa/locale';
import { JOB_SIDES, JOB_TYPES, type JobSide, type JobType } from '@/lib/marketplace/jobs';
import { jobSideLabel, jobTypeLabel } from './job-labels';

export type JobFormValues = {
  side: JobSide;
  job_type: JobType;
  title: string;
  description: string;
  city: string;
  state: string;
  location: string;
  remote: boolean;
  service_area: string;
  compensation: string;
  equipment: string;
  modality: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  post_as_org: boolean;
  organization_id: string | number | null;
};

export function emptyJobForm(partial?: Partial<JobFormValues>): JobFormValues {
  return {
    side: 'hiring',
    job_type: 'full_time',
    title: '',
    description: '',
    city: '',
    state: '',
    location: '',
    remote: false,
    service_area: '',
    compensation: '',
    equipment: '',
    modality: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    post_as_org: false,
    organization_id: null,
    ...partial,
  };
}

export function JobPostForm({
  initial,
  organizationName,
  hasOrganization,
  saving,
  submitLabel,
  onSubmit,
}: {
  initial: JobFormValues;
  organizationName: string;
  hasOrganization: boolean;
  saving: boolean;
  submitLabel: string;
  onSubmit: (values: JobFormValues) => void;
}) {
  const t = useT();
  const [form, setForm] = useState<JobFormValues>(initial);
  const set = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <form
      className="card p-4 md:p-6 space-y-4 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
    >
      <p className="text-sm text-[var(--text3)]">{t('Job posts are free during soft beta.')}</p>
      <p className="text-sm text-[var(--text3)]">
        {t('Contact is prefilled from your profile and organization. You can change it.')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="job-side">{t('Who is posting')}</label>
          <select
            id="job-side"
            className="input"
            value={form.side}
            onChange={(event) => set('side', event.target.value as JobSide)}
          >
            {JOB_SIDES.map((side) => (
              <option key={side} value={side}>{jobSideLabel(side, t)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="job-type">{t('Job type')}</label>
          <select
            id="job-type"
            className="input"
            value={form.job_type}
            onChange={(event) => set('job_type', event.target.value as JobType)}
          >
            {JOB_TYPES.map((type) => (
              <option key={type} value={type}>{jobTypeLabel(type, t)}</option>
            ))}
          </select>
        </div>
      </div>

      {form.side === 'hiring' ? (
        <p className="text-sm">
          {t('Hiring posts use your organization.')}{' '}
          {organizationName ? <strong>{organizationName}</strong> : null}
          {!hasOrganization ? (
            <span className="block text-[var(--text3)] mt-1">
              {t('Join an organization before posting a hiring job.')}
            </span>
          ) : null}
        </p>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.post_as_org}
            onChange={(event) => set('post_as_org', event.target.checked)}
            disabled={!hasOrganization}
          />
          <span>{t('Include my organization')}</span>
          {form.post_as_org && organizationName ? <strong>{organizationName}</strong> : <span className="text-[var(--text3)]">{t('Post as myself')}</span>}
        </label>
      )}

      {form.job_type === 'subcontract' ? (
        <p className="text-sm text-[var(--text3)]">
          {t('A subcontract post can be one discrete call-out, including out of state.')}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="job-title">{t('Job title')}</label>
        <input
          id="job-title"
          className="input"
          value={form.title}
          maxLength={160}
          required
          onChange={(event) => set('title', event.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="job-description">{t('Job description')}</label>
        <textarea
          id="job-description"
          className="input min-h-[140px]"
          value={form.description}
          maxLength={8000}
          required
          onChange={(event) => set('description', event.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="job-city">{t('City')}</label>
          <input id="job-city" className="input" value={form.city} onChange={(event) => set('city', event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="job-state">{t('State')}</label>
          <input id="job-state" className="input" value={form.state} onChange={(event) => set('state', event.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="job-location">{t('Location')}</label>
        <input
          id="job-location"
          className="input"
          value={form.location}
          onChange={(event) => set('location', event.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.remote} onChange={(event) => set('remote', event.target.checked)} />
        <span>{t('Remote work')}</span>
      </label>
      <div>
        <label className="label" htmlFor="job-area">{t('Service area')}</label>
        <input
          id="job-area"
          className="input"
          placeholder={t('City, state, or region you will travel to')}
          value={form.service_area}
          onChange={(event) => set('service_area', event.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="job-pay">{t('Compensation (optional)')}</label>
        <input
          id="job-pay"
          className="input"
          placeholder={t('Pay, rate, or range')}
          value={form.compensation}
          onChange={(event) => set('compensation', event.target.value)}
        />
        <p className="text-xs text-[var(--text3)] mt-1">
          {t('Optional pay, rate, or range. Nothing is billed from this board.')}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="job-equipment">{t('Equipment (optional)')}</label>
          <input
            id="job-equipment"
            className="input"
            placeholder={t('Equipment you work on')}
            value={form.equipment}
            onChange={(event) => set('equipment', event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="job-modality">{t('Modality (optional)')}</label>
          <input
            id="job-modality"
            className="input"
            value={form.modality}
            onChange={(event) => set('modality', event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="job-contact-name">{t('Contact name')}</label>
          <input
            id="job-contact-name"
            className="input"
            value={form.contact_name}
            onChange={(event) => set('contact_name', event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="job-contact-email">{t('Contact email')}</label>
          <input
            id="job-contact-email"
            className="input"
            type="email"
            value={form.contact_email}
            onChange={(event) => set('contact_email', event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="job-contact-phone">{t('Contact phone')}</label>
          <input
            id="job-contact-phone"
            className="input"
            value={form.contact_phone}
            onChange={(event) => set('contact_phone', event.target.value)}
          />
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={saving || (form.side === 'hiring' && !hasOrganization)}>
        {saving ? t('Save job post') : submitLabel}
      </button>
    </form>
  );
}
