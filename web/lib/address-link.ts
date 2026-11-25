/**
 * Service-address maps links.
 *
 * Web and mobile browsers use the Google Maps search URL. The Android WebView
 * calls Android.openUrl(geo:) once; MainActivity launches that intent a single
 * time and falls back to the https URL when Maps is not installed.
 */

import { formatPostalText } from './fax-address.ts';

export type AddressParts = {
  street?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type AddressSource = {
  customer_address?: string | null;
  customer_address_line2?: string | null;
  address?: string | null;
  address_line2?: string | null;
  customer_city?: string | null;
  city?: string | null;
  customer_state?: string | null;
  state?: string | null;
  customer_zip?: string | null;
  zip?: string | null;
};

export type ServiceAddressMapsUrls = {
  https: string;
  geo: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const part = text(value);
    if (part) return part;
  }
  return '';
}

/**
 * "Street, City, ST 85251". ZIP is separated from the state by a space.
 * Any non-empty subset is kept (for example "Tempe, AZ"). Fully empty is "".
 */
export function formatServiceAddress(parts: AddressParts | null | undefined): string {
  if (!parts) return '';
  return formatPostalText({
    line1: parts.street,
    line2: parts.line2,
    city: parts.city,
    state: parts.state,
    zip: parts.zip,
  });
}

export function ticketAddressParts(ticket: AddressSource | null | undefined): AddressParts {
  return {
    street: firstText(ticket?.customer_address, ticket?.address),
    line2: firstText(ticket?.customer_address_line2, ticket?.address_line2),
    city: firstText(ticket?.customer_city, ticket?.city),
    state: firstText(ticket?.customer_state, ticket?.state),
    zip: firstText(ticket?.zip, ticket?.customer_zip),
  };
}

export function formatTicketAddress(ticket: AddressSource | null | undefined): string {
  return formatServiceAddress(ticketAddressParts(ticket));
}

/**
 * https://www.google.com/maps/search/?api=1&query=<encoded address>
 * and geo:0,0?q=<encoded address>. Null when there is nothing to search.
 */
export function serviceAddressMapsUrls(fullAddress: string | null | undefined): ServiceAddressMapsUrls | null {
  const address = text(fullAddress).replace(/\s*\n\s*/g, ', ');
  if (!address) return null;
  const encoded = encodeURIComponent(address);
  return {
    https: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
    geo: `geo:0,0?q=${encoded}`,
  };
}

type AndroidBridge = {
  openUrl?: (url: string) => void;
  isStub?: boolean;
};

type MapsWindow = Window & {
  Android?: AndroidBridge;
};

function realAndroidBridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as MapsWindow).Android;
  if (!bridge || bridge.isStub || typeof bridge.openUrl !== 'function') return null;
  return bridge;
}

/**
 * Ask the Android WebView to open geo: once. MainActivity resolves the intent
 * and falls back to the https Maps URL. Returns true when the https anchor
 * should not also navigate. Browsers (no bridge) return false.
 */
export function openNativeServiceAddress(fullAddress: string): boolean {
  const urls = serviceAddressMapsUrls(fullAddress);
  const bridge = realAndroidBridge();
  if (!urls || !bridge?.openUrl) return false;
  bridge.openUrl(urls.geo);
  return true;
}
