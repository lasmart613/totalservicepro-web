/**
 * theme.js - Centralized Light / Dark / System theme handler
 * 
 * Goals:
 * - Prevent flash of wrong theme on page load
 * - Use single consistent storage key
 * - Support explicit 'light', 'dark', or 'system' preference
 * - Good readability and maintainability
 */

(function() {
    const THEME_KEY = 'tsp_theme';
    const LIGHT_CLASS = 'light';

    /**
     * Returns the effective theme to apply.
     * Respects explicit user choice or falls back to system preference.
     */
    function getEffectiveTheme() {
        const saved = localStorage.getItem(THEME_KEY);

        if (saved === 'light' || saved === 'dark') {
            return saved;
        }

        // Default behavior: follow system or explicit 'system' value
        if (!saved || saved === 'system') {
            const prefersLight = window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: light)').matches;
            return prefersLight ? 'light' : 'dark';
        }

        return 'dark'; // final fallback
    }

    /**
     * Applies the correct theme class to <html> as early as possible.
     */
    function applyTheme() {
        const effective = getEffectiveTheme();
        const root = document.documentElement;

        if (effective === 'light') {
            root.classList.add(LIGHT_CLASS);
        } else {
            root.classList.remove(LIGHT_CLASS);
        }

        // Store the resolved value so other scripts can read it if needed
        root.dataset.theme = effective;
    }

    // Apply immediately (this script should be loaded very early in <head>)
    applyTheme();

    /**
     * Public API - allows other scripts / settings pages to change theme
     */
    window.TSPTheme = {
        setTheme(mode) {
            // Accept: 'light', 'dark', or 'system'
            if (['light', 'dark', 'system'].includes(mode)) {
                localStorage.setItem(THEME_KEY, mode);
                applyTheme();
                // Notify other open tabs/windows
                window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
            }
        },

        getTheme() {
            return localStorage.getItem(THEME_KEY) || 'system';
        },

        getEffectiveTheme() {
            return document.documentElement.dataset.theme || 'dark';
        },

        toggle() {
            const current = this.getEffectiveTheme();
            const next = current === 'light' ? 'dark' : 'light';
            this.setTheme(next);
        }
    };

    // React to system preference changes when user has chosen "system"
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        mediaQuery.addEventListener('change', () => {
            const saved = localStorage.getItem(THEME_KEY);
            if (!saved || saved === 'system') {
                applyTheme();
            }
        });
    }

    // React to theme changes from other tabs or settings page
    window.addEventListener('storage', function(e) {
        if (e.key === THEME_KEY) {
            applyTheme();
        }
    });

    // Safety net: re-apply theme after DOM is ready
    // This helps if any page has late scripts or inline styles that interfere
    document.addEventListener('DOMContentLoaded', function() {
        applyTheme();
    });
})();