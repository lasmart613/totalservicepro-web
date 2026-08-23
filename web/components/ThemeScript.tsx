import { THEME_INIT_SCRIPT } from '@/lib/theme';

/** Blocking boot script. Saved Light applies only when a signed-in session hint exists. */
export function ThemeScript() {
  return (
    <script
      id="tsp-theme-init"
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
