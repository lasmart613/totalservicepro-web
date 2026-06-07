/* TSP v2026.04.03.4 */
/**
 * Total Service Pro — Web Compatibility Layer
 * Polyfills Android bridge calls and injects desktop sidebar on web.
 * Include in every page just before </body>
 * For Android WebView builds, this is mostly a no-op stub but provides safety.
 */
(function() {
    'use strict';

    // ── Detect environment ────────────────────────────────────────────────────
    const IS_WEB = typeof Android === 'undefined';
    const IS_MOBILE_WEB = IS_WEB && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const IS_DESKTOP = IS_WEB && !IS_MOBILE_WEB;

    if (!IS_WEB) return; // Running in Android WebView — nothing to do (or minimal stubs)

    // ── Android bridge stub ───────────────────────────────────────────────────
    // Prevents "Android is not defined" errors on any page that forgets the guard
    window.Android = window.Android || {
        isStub:               true,
        saveSession:          function() {},
        clearSession:         function() {},
        startVoiceRecognition: function() {
            if (window._webSpeechStart) window._webSpeechStart();
        },
        stopVoiceRecognition:  function() {
            if (window._webSpeechStop) window._webSpeechStop();
        },
        printReport:           function(html) { window._webPrint && window._webPrint(html); },
        goBack:                function() { history.back(); },
        showToast:             function(msg) {
            const t = document.getElementById('toast');
            if (t) { t.textContent = msg; t.className = 'toast show'; setTimeout(() => t.classList.remove('show'), 3000); }
        },
        launchBillingFlow:     function() { window.location.href = 'paywall.html'; },
        openUrl:               function(url) { window.open(url, '_blank', 'noopener'); },
        getExitConfirmEnabled: function() { return false; },
        setExitConfirmEnabled: function() {},
        getPremiumStatus:      function() { return false; },
        setPremiumStatus:      function() {},
        generateAndSavePdfDirectly: function() { /* web fallback */ if (window._webGeneratePdf) window._webGeneratePdf(); },
    };

    // ── Sidebar nav definition (for desktop browser testing of the app) ───────
    const NAV_ITEMS = [
        { section: 'Main' },
        { icon: '🏠', label: 'Dashboard',        href: 'index.html' },
        { icon: '📅', label: 'Schedule',          href: 'service_schedule.html' },
        { icon: '📋', label: 'Service Reports',   href: 'reports_list.html' },
        { icon: '📝', label: 'Estimates',         href: 'estimates_list.html' },
        { icon: '🧾', label: 'Invoices',          href: 'invoices_list.html' },

        { section: 'Tools' },
        { icon: '🤖', label: 'AI Assistant',      href: 'ai_assistant.html' },
        { icon: '📚', label: 'Manual Library',    href: 'manual_library.html' },
        { icon: '🔧', label: 'Calculators',       href: 'calculators_menu.html' },

        { section: 'Business' },
        { icon: '👥', label: 'Customers',         href: 'customer_directory.html' },
        { icon: '🛒', label: 'Parts Marketplace', href: 'marketplace.html' },
        { icon: '🧪', label: 'Test Equipment',    href: 'test_equipment.html' },

        { section: 'Account' },
        { icon: '👤', label: 'Profile',           href: 'user_profile.html' },
        { icon: '🏢', label: 'Company',           href: 'company_profile.html' },
        { icon: '⚙️', label: 'Settings',          href: 'settings.html' },
    ];

    // ── Inject sidebar on desktop for easier testing of the full app ─────────
    function injectSidebar() {
        if (!IS_DESKTOP) return;

        const currentPage = window.location.pathname.split('/').pop() || 'index.html';

        let navHtml = '';
        for (const item of NAV_ITEMS) {
            if (item.section) {
                navHtml += `<div class="web-nav-section"><span class="web-nav-label">${item.section}</span>`;
                continue;
            }
            const isActive = currentPage === item.href ? ' active' : '';
            navHtml += `<a class="web-nav-item${isActive}" href="${item.href}">
                <span class="web-nav-icon">${item.icon}</span>${item.label}
            </a>`;
            if (NAV_ITEMS[NAV_ITEMS.indexOf(item) + 1]?.section) navHtml += '</div>';
        }

        const sidebar = document.createElement('nav');
        sidebar.className = 'web-sidebar';
        sidebar.innerHTML = `
            <div class="web-sidebar-logo">
                <div class="brand">
                    <span class="brand-name">Total Service Pro</span>
                    <span class="brand-sub">Field Service Platform</span>
                </div>
            </div>
            ${navHtml}
            <div class="web-sidebar-footer">
                <a class="app-cta-pill" href="https://play.google.com/store/apps/details?id=com.photometrytools" target="_blank" rel="noopener">
                    <span class="app-cta-icon">📱</span>
                    <div class="app-cta-text">
                        <div class="app-cta-title">Get the Android App</div>
                        <div class="app-cta-sub">Full experience on mobile</div>
                    </div>
                </a>
            </div>
        `;

        const body = document.body;
        const shell = document.createElement('div');
        shell.className = 'web-shell';

        const main = document.createElement('div');
        main.className = 'web-main';

        while (body.firstChild) main.appendChild(body.firstChild);

        shell.appendChild(sidebar);
        shell.appendChild(main);
        body.appendChild(shell);

        // Add minimal supporting CSS if not present
        if (!document.getElementById('web-shell-styles')) {
            const style = document.createElement('style');
            style.id = 'web-shell-styles';
            style.textContent = `
                .web-shell { display: flex; min-height: 100vh; }
                .web-sidebar { width: 240px; background: #111; border-right: 1px solid #222; padding: 16px 0; flex-shrink: 0; overflow-y: auto; }
                .web-sidebar-logo { padding: 0 16px 16px; border-bottom: 1px solid #222; margin-bottom: 8px; }
                .web-nav-section { padding: 12px 16px 4px; }
                .web-nav-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
                .web-nav-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; color: #ccc; text-decoration: none; font-size: 14px; }
                .web-nav-item:hover { background: #1a1a1a; color: #fff; }
                .web-nav-item.active { background: #1f1f1f; color: #FBBF24; border-left: 3px solid #FBBF24; padding-left: 13px; }
                .web-nav-icon { font-size: 16px; width: 20px; text-align: center; }
                .web-main { flex: 1; min-width: 0; overflow: auto; }
                .web-sidebar-footer { position: absolute; bottom: 0; padding: 12px 16px; width: 240px; border-top: 1px solid #222; background: #111; }
                .app-cta-pill { display: flex; align-items: center; gap: 10px; background: #1a1a1a; border: 1px solid #333; border-radius: 999px; padding: 8px 12px; text-decoration: none; color: #ccc; font-size: 12px; }
                .app-cta-pill:hover { border-color: #FBBF24; }
            `;
            document.head.appendChild(style);
        }
    }

    // ── Mobile web app banner (for browser testing on phone) ─────────────────
    function injectAppBanner() {
        if (!IS_MOBILE_WEB) return;
        if (sessionStorage.getItem('tsp_banner_dismissed')) return;

        const banner = document.createElement('div');
        banner.className = 'app-banner show';
        banner.id = 'appBanner';
        banner.innerHTML = `
            <span class="app-banner-icon">📱</span>
            <div class="app-banner-text">
                <div class="app-banner-title">Get the Full TSP Experience</div>
                <div class="app-banner-sub">Download the Android app for offline access & voice features</div>
            </div>
            <a class="app-banner-btn" href="https://play.google.com/store/apps/details?id=com.photometrytools" target="_blank" rel="noopener">Download</a>
            <button class="app-banner-close" onclick="dismissAppBanner()">×</button>
        `;

        document.body.insertBefore(banner, document.body.firstChild);

        // Add banner styles if needed
        if (!document.getElementById('app-banner-styles')) {
            const bs = document.createElement('style');
            bs.id = 'app-banner-styles';
            bs.textContent = `
                .app-banner { display: flex; align-items: center; gap: 12px; background: #1a1a1a; border-bottom: 1px solid #333; padding: 8px 12px; font-size: 13px; }
                .app-banner-icon { font-size: 18px; }
                .app-banner-text { flex: 1; }
                .app-banner-title { font-weight: 600; }
                .app-banner-sub { font-size: 11px; color: #888; }
                .app-banner-btn { background: #FBBF24; color: #111; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; text-decoration: none; white-space: nowrap; }
                .app-banner-close { background: none; border: none; color: #888; font-size: 18px; line-height: 1; padding: 0 4px; cursor: pointer; }
            `;
            document.head.appendChild(bs);
        }
    }

    window.dismissAppBanner = function() {
        sessionStorage.setItem('tsp_banner_dismissed', '1');
        const b = document.getElementById('appBanner');
        if (b) b.remove();
    };

    // ── Patch navigation helpers for pure web (no _s session passing needed) ─
    function patchNavigateTo() {
        if (typeof window.navigateTo === 'function') {
            const orig = window.navigateTo;
            window.navigateTo = function(page) {
                window.location.href = page;
            };
        }
        if (typeof window.navTo === 'function') {
            window.navTo = function(page) {
                window.location.href = page;
            };
        }
    }

    function init() {
        injectSidebar();
        injectAppBanner();
        setTimeout(patchNavigateTo, 0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
