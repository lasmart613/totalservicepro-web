import { THEME_INIT_SCRIPT } from '@/lib/theme';

/** Blocking boot script so a saved Light choice is applied before first paint. */
export function ThemeScript() {
  return (
    <script
      id="tsp-theme-init"
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
