'use client';

import { JOB_ERRORS } from '@/lib/marketplace/jobs';

type T = (text: string) => string;

export function jobTypeLabel(type: string | null | undefined, t: T): string {
  if (type === 'full_time') return t('Full-time');
  if (type === 'part_time') return t('Part-time');
  if (type === 'contract') return t('Contract');
  if (type === 'subcontract') return t('Subcontract');
  return '';
}

export function jobSideLabel(side: string | null | undefined, t: T): string {
  if (side === 'hiring') return t('Hiring');
  if (side === 'looking') return t('Looking for work');
  return '';
}

export function jobStatusLabel(status: string | null | undefined, t: T): string {
  if (status === 'open') return t('Open post');
  if (status === 'filled') return t('Filled');
  if (status === 'closed') return t('Closed');
  return '';
}

export function translateJobError(error: string, t: T): string {
  if (error === JOB_ERRORS.signIn) return t('Sign in required.');
  if (error === JOB_ERRORS.hiringOrg) return t('Join an organization before posting a hiring job.');
  if (error === JOB_ERRORS.hiringUsesOrg) return t('Hiring posts use your organization.');
  if (error === JOB_ERRORS.wrongOrg) return t('That organization is not one you belong to.');
  if (error === JOB_ERRORS.lookingOrg) return t('Include my organization needs an organization on your profile.');
  if (error === JOB_ERRORS.title) return t('Enter a job title (at least 3 characters).');
  if (error === JOB_ERRORS.description) return t('Describe the role or the work you are looking for.');
  if (error === JOB_ERRORS.type) return t('Choose full-time, part-time, contract, or subcontract.');
  if (error === JOB_ERRORS.side) return t('Choose hiring or looking for work.');
  if (error === JOB_ERRORS.status) return t('Choose open, filled, or closed.');
  if (error === JOB_ERRORS.email) return t('Enter a valid contact email or leave it blank.');
  if (error === JOB_ERRORS.permission) return t('You do not have permission to edit this job post.');
  if (error === JOB_ERRORS.save) return t('Could not save this job post.');
  if (error === JOB_ERRORS.unavailable) return t('Job board is not available yet.');
  if (error === 'Could not load job posts.') return t('Could not load job posts.');
  if (error === 'Job post not found.') return t('Job post not found.');
  return t('Could not save this job post.');
}
