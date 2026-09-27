/**
 * Service-address maps links.
 *
 * Web and mobile browsers use the Google Maps search URL. Native Android
 * (Capacitor, or this app's WebView bridge) opens a geo: intent so the
 * Google Maps app handles it, then falls back to the https URL.
 */

export type AddressParts = {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type AddressSource = {
  customer_address?: string | null;
  address?: string | null;
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

/** Street, city, state, zip joined with ", ", skipping blanks. */
export function formatServiceAddress(parts: AddressParts | null | undefined): string {
  if (!parts) return '';
  return [text(parts.street), text(parts.city), text(parts.state), text(parts.zip)]
    .filter(Boolean)
    .join(', ');
}

export function ticketAddressParts(ticket: AddressSource | null | undefined): AddressParts {
  return {
    street: firstText(ticket?.customer_address, ticket?.address),
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
  const address = text(fullAddress);
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

type AppLauncher = {
  openUrl?: (opts: { url: string }) => Promise<unknown>;
  canOpenUrl?: (opts: { url: string }) => Promise<{ value?: boolean }>;
};

type CapacitorLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { AppLauncher?: AppLauncher };
};

type MapsWindow = Window & {
  Android?: AndroidBridge;
  Capacitor?: CapacitorLike;
};

function mapsWindow(): MapsWindow | null {
  if (typeof window === 'undefined') return null;
  return window as MapsWindow;
}

function realAndroidBridge(w: MapsWindow): AndroidBridge | null {
  const bridge = w.Android;
  if (!bridge || bridge.isStub || typeof bridge.openUrl !== 'function') return null;
  return bridge;
}

/** Capacitor native Android, or this app's Android WebView JavascriptInterface. */
export function hasNativeAndroidMaps(w: MapsWindow | null = mapsWindow()): boolean {
  if (!w) return false;
  if (realAndroidBridge(w)) return true;
  const cap = w.Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  const platform = cap.getPlatform?.();
  if (platform) return platform === 'android';
  return /Android/i.test(w.navigator?.userAgent || '');
}

async function openCapacitorGeo(w: MapsWindow, geo: string, httpsUrl: string): Promise<void> {
  const launcher = w.Capacitor?.Plugins?.AppLauncher;
  const webFallback = () => {
    w.open(httpsUrl, '_blank', 'noopener,noreferrer');
  };
  try {
    if (launcher?.openUrl) {
      if (!launcher.canOpenUrl) {
        await launcher.openUrl({ url: geo });
        return;
      }
      const can = await launcher.canOpenUrl({ url: geo });
      if (can?.value) {
        await launcher.openUrl({ url: geo });
        return;
      }
    }
    const opened = w.open(geo, '_system');
    if (!opened) webFallback();
  } catch {
    try {
      const opened = w.open(geo, '_system');
      if (!opened) webFallback();
    } catch {
      webFallback();
    }
  }
}

/**
 * On native Android, open geo:0,0?q= so the Maps app launches.
 * Returns true when the caller should cancel the https anchor navigation.
 */
export function openNativeServiceAddress(fullAddress: string): boolean {
  const urls = serviceAddressMapsUrls(fullAddress);
  const w = mapsWindow();
  if (!urls || !w || !hasNativeAndroidMaps(w)) return false;
  const bridge = realAndroidBridge(w);
  if (bridge?.openUrl) {
    try {
      bridge.openUrl(urls.geo);
      return true;
    } catch {
      try {
        bridge.openUrl(urls.https);
        return true;
      } catch {
        return false;
      }
    }
  }
  void openCapacitorGeo(w, urls.geo, urls.https);
  return true;
}
