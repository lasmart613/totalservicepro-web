/**
 * Landing images below the fold use loading="lazy", and hero slides mount
 * their still only once visited. Browsers then never fetch them when nothing
 * scrolls the page: full-page screenshots, link-preview renderers, and some
 * in-app browsers show empty dark cards forever.
 *
 * After the window load event plus one idle slot, the landing flips every
 * still to eager so they all load. First paint and LCP are unchanged.
 */

type IdleWindow = {
  document: { readyState: string };
  addEventListener: (type: 'load', cb: () => void) => void;
  removeEventListener: (type: 'load', cb: () => void) => void;
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown;
  cancelIdleCallback?: (id: unknown) => void;
};

export const LANDING_WARM_IDLE_TIMEOUT_MS = 1500;
/** Safari has no requestIdleCallback. */
export const LANDING_WARM_FALLBACK_MS = 300;

/** Calls cb once, after load and one idle slot. Returns a cancel function. */
export function scheduleAfterLoadIdle(win: IdleWindow, cb: () => void): () => void {
  let cancelled = false;
  let idleId: unknown = null;
  let timeoutId: unknown = null;

  const fire = () => {
    if (!cancelled) cb();
  };

  const idle = () => {
    if (cancelled) return;
    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(fire, { timeout: LANDING_WARM_IDLE_TIMEOUT_MS });
    } else {
      timeoutId = win.setTimeout(fire, LANDING_WARM_FALLBACK_MS);
    }
  };

  const onLoad = () => {
    win.removeEventListener('load', onLoad);
    idle();
  };

  if (win.document.readyState === 'complete') idle();
  else win.addEventListener('load', onLoad);

  return () => {
    cancelled = true;
    win.removeEventListener('load', onLoad);
    if (idleId !== null && typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(idleId);
    if (timeoutId !== null) win.clearTimeout(timeoutId);
  };
}

/** loading attribute for a landing still. */
export function landingImgLoading(priority: boolean | undefined, warm: boolean): 'eager' | 'lazy' {
  return priority || warm ? 'eager' : 'lazy';
}

type DecodableRoot = { querySelectorAll: (sel: string) => ArrayLike<{ decode?: () => Promise<void> }> };

/**
 * decoding="async" stills far below the fold stay undecoded until they near
 * the viewport, so a first full-page capture still shows the dark card.
 * Decode them once warm. Errors (a failed load) are ignored.
 */
export function decodeLandingImages(root: DecodableRoot | null | undefined): number {
  if (!root) return 0;
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    if (typeof img.decode === 'function') img.decode().catch(() => {});
  }
  return imgs.length;
}
