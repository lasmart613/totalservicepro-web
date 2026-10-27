/**
 * Incomplete manuals never use a company-library slot. They still have to be
 * added before they can be opened. Shared with get-manual-url.
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
  'This document is incomplete. Adding it is free and does not use a library slot.';
