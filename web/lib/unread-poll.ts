/**
 * Header unread-count poll (notifications badge).
 * Soft beta / no Ads: one QA tab must not hammer overnight 5xx.
 *
 * - Pause while the tab is hidden (`document.visibilityState`).
 * - After 504 / timeout / 5xx, exponential backoff with a cap; reset on success.
 */

export const UNREAD_POLL_INTERVAL_MS = 45_000;
export const UNREAD_POLL_BACKOFF_CAP_MS = 10 * 60 * 1000;

export function isUnreadPollVisible(visibilityState?: string | null): boolean {
  return visibilityState !== 'hidden';
}

export function nextUnreadPollDelayMs(currentDelayMs: number, failed: boolean): number {
  if (!failed) return UNREAD_POLL_INTERVAL_MS;
  const base = currentDelayMs > 0 ? currentDelayMs : UNREAD_POLL_INTERVAL_MS;
  return Math.min(base * 2, UNREAD_POLL_BACKOFF_CAP_MS);
}

function httpStatusFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value.trim());
  return null;
}

function isHttp5xx(status: number | null): boolean {
  return status != null && status >= 500 && status <= 599;
}

function looksLikeTimeoutOrGateway(text: string): boolean {
  return /504|gateway\s*timeout|timed?\s*out|etimedout|econnreset|aborterror|\baborted\b|und_err_connect_timeout|connecttimeouterror/i.test(
    text,
  );
}

/** True for 504, request timeout, and other HTTP 5xx — not 4xx / RLS / validation. */
export function isUnreadPollBackoffError(error: unknown): boolean {
  if (error == null) return false;
  if (typeof error === 'number') return isHttp5xx(error);
  if (typeof error === 'string') {
    return isHttp5xx(httpStatusFromUnknown(error)) || looksLikeTimeoutOrGateway(error);
  }
  if (typeof error !== 'object') return false;

  const e = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
    details?: unknown;
    hint?: unknown;
    cause?: unknown;
  };

  if (isHttp5xx(httpStatusFromUnknown(e.status)) || isHttp5xx(httpStatusFromUnknown(e.statusCode))) {
    return true;
  }
  // PostgREST puts the HTTP status in `code` when the body has no SQLSTATE.
  if (isHttp5xx(httpStatusFromUnknown(e.code))) return true;

  const text = [e.message, e.name, e.details, e.hint, e.code]
    .filter((part) => typeof part === 'string' && part)
    .join(' ');
  if (looksLikeTimeoutOrGateway(text)) return true;
  if (e.cause) return isUnreadPollBackoffError(e.cause);
  return false;
}

export type UnreadPollLoopOptions = {
  /** Return true when the request hit 504 / timeout / 5xx. */
  poll: () => Promise<boolean>;
  isVisible: () => boolean;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  addVisibilityListener: (fn: () => void) => void;
  removeVisibilityListener: (fn: () => void) => void;
};

/**
 * Interval poll that stays quiet on a hidden tab and stretches the delay after
 * gateway / 5xx failures. First tick waits one interval (initial load fetches separately).
 */
export function startUnreadPollLoop(opts: UnreadPollLoopOptions): () => void {
  let stopped = false;
  let timer: unknown = null;
  let delayMs = UNREAD_POLL_INTERVAL_MS;
  let inFlight = false;

  const clearTimer = () => {
    if (timer == null) return;
    opts.clearTimeout(timer);
    timer = null;
  };

  const arm = () => {
    clearTimer();
    if (stopped || !opts.isVisible()) return;
    timer = opts.setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
  };

  const tick = async () => {
    if (stopped || !opts.isVisible() || inFlight) return;
    inFlight = true;
    let failed = false;
    try {
      failed = await opts.poll();
    } catch (err) {
      failed = isUnreadPollBackoffError(err);
    }
    inFlight = false;
    if (stopped) return;
    delayMs = nextUnreadPollDelayMs(delayMs, failed);
    arm();
  };

  const onVisibility = () => {
    if (stopped) return;
    if (opts.isVisible()) {
      void tick();
      return;
    }
    clearTimer();
  };

  opts.addVisibilityListener(onVisibility);
  arm();

  return () => {
    stopped = true;
    clearTimer();
    opts.removeVisibilityListener(onVisibility);
  };
}

/** Browser wiring for the Header unread poll. */
export function startDocumentUnreadPoll(poll: () => Promise<boolean>): () => void {
  return startUnreadPollLoop({
    poll,
    isVisible: () => typeof document === 'undefined' || isUnreadPollVisible(document.visibilityState),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    addVisibilityListener: (fn) => {
      if (typeof document === 'undefined') return;
      document.addEventListener('visibilitychange', fn);
    },
    removeVisibilityListener: (fn) => {
      if (typeof document === 'undefined') return;
      document.removeEventListener('visibilitychange', fn);
    },
  });
}
