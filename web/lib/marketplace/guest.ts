/** Logged-out marketplace visitors go to register, not a priced product page. */
export const GUEST_SIGNUP_HREF = '/signup';

export const GUEST_PRICE_PLACEHOLDER = '$••••';

export function listingHref(signedIn: boolean, href: string): string {
  return signedIn ? href : GUEST_SIGNUP_HREF;
}

export function displayListingPrice(signedIn: boolean, priceLabel: string): string {
  return signedIn ? priceLabel : GUEST_PRICE_PLACEHOLDER;
}
