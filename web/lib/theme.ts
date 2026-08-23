/**
 * Light / Dark persistence for the Next.js app.
 *
 * Same storage key as Android `theme.js` (`tsp_theme`).
 * - Explicit `light` / `dark` wins and is written on toggle.
 * - No saved choice: honor prefers-color-scheme; otherwise Dark.
 * - Never persist the system preference as a user choice.
 */

export const THEME_KEY = 'tsp_theme';
export const LIGHT_CLASS = 'light';

export type ThemeChoice = 'light' | 'dark';

export function resolveEffectiveTheme(
  saved: string | null | undefined,
  prefersLight: boolean,
): ThemeChoice {
  if (saved === 'light' || saved === 'dark') return saved;
  return prefersLight ? 'light' : 'dark';
}

export function applyEffectiveTheme(
  theme: ThemeChoice,
  root: Pick<HTMLElement, 'classList' | 'dataset'> = document.documentElement,
): void {
  root.classList.toggle(LIGHT_CLASS, theme === 'light');
  root.dataset.theme = theme;
}

function readCookieTheme(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )tsp_theme=(light|dark)(?:;|$)/);
  return match?.[1] ?? null;
}

export function readSavedTheme(): string | null {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* private mode / blocked storage */
  }
  return readCookieTheme();
}

export function persistThemeChoice(theme: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* class still applies this session */
  }
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${THEME_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

function prefersLightScheme(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

export function applyStoredTheme(): ThemeChoice {
  const theme = resolveEffectiveTheme(readSavedTheme(), prefersLightScheme());
  applyEffectiveTheme(theme);
  return theme;
}

export function togglePersistedTheme(): ThemeChoice {
  const next: ThemeChoice = document.documentElement.classList.contains(LIGHT_CLASS)
    ? 'dark'
    : 'light';
  persistThemeChoice(next);
  applyEffectiveTheme(next);
  return next;
}

export function subscribeThemeSync(onApply?: (theme: ThemeChoice) => void): () => void {
  const apply = () => onApply?.(applyStoredTheme());

  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) apply();
  };

  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

  const onMedia = () => {
    const saved = readSavedTheme();
    if (saved !== 'light' && saved !== 'dark') apply();
  };

  window.addEventListener('storage', onStorage);
  media?.addEventListener('change', onMedia);

  return () => {
    window.removeEventListener('storage', onStorage);
    media?.removeEventListener('change', onMedia);
  };
}

/** Runs before first paint. Reads storage only — does not write a preference. */
export const THEME_INIT_SCRIPT = `!function(){try{var k=${JSON.stringify(THEME_KEY)},c=${JSON.stringify(LIGHT_CLASS)},s=null;try{s=localStorage.getItem(k)}catch(e){}if(s!=="light"&&s!=="dark"){var m=document.cookie.match(/(?:^|; )tsp_theme=(light|dark)(?:;|$)/);if(m)s=m[1]}var t=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"),r=document.documentElement;r.classList.toggle(c,t==="light");r.dataset.theme=t}catch(e){}}();`;
