/**
 * Incomplete manuals are free to view and never use a company-library slot.
 * Shared with get-manual-url so the web app and the edge function agree.
 */
export {
  isIncompleteFlag,
  libraryRowIsFree,
  manualIsIncomplete,
  mayViewIncompleteFree,
  pathWithinManual,
  slotCountedManuals,
} from '../../supabase/functions/get-manual-url/incomplete.ts';

/** Badge text on shelves and in the viewer. */
export const INCOMPLETE_FREE_BADGE = 'Incomplete – free';
export const INCOMPLETE_FREE_TITLE =
  'This document is incomplete. It is free to view and does not use a library slot.';
