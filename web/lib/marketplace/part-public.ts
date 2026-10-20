/**
 * Public shape of a parts-for-sale listing for /api/marketplace/parts, /parts/[id]
 * and seller storefronts.
 *
 * - Stripe product/price ids are never returned. Checkout loads them server-side.
 * - serial_number is returned only to the seller org's own members (or the
 *   listing owner). Equipment serials identify the owner's unit, so other
 *   signed-in users don't get them either.
 * - details is cleaned with the same recursive sanitizer as public share previews.
 */
import { sanitizeShareListingDetails } from '../share-listing-public.ts';
import {
  actorBelongsToListingOrg,
  isListingOwner,
  type ListingActor,
  type ListingOwnershipFields,
} from './ownership.ts';

export const PART_ALWAYS_HIDDEN_KEYS = ['stripe_product_id', 'stripe_price_id'] as const;

/** True only for the listing owner or a member of the listing's seller org. */
export function viewerSeesPartSerial(
  listing: ListingOwnershipFields | null | undefined,
  actor: ListingActor | null | undefined
): boolean {
  if (!listing || !actor?.userId) return false;
  return isListingOwner(listing, actor.userId) || actorBelongsToListingOrg(listing, actor);
}

/** Copy of row without Stripe ids, with serial only when revealSerial, details sanitized. */
export function stripPrivatePartFields<T extends Record<string, unknown>>(
  row: T,
  revealSerial: boolean
): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of PART_ALWAYS_HIDDEN_KEYS) delete out[k];
  if (!revealSerial) delete out.serial_number;
  if ('details' in out) out.details = sanitizeShareListingDetails(out.details);
  return out as T;
}
