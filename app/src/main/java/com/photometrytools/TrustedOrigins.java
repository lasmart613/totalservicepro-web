package com.photometrytools;

import android.net.Uri;

import java.util.Locale;

/**
 * Hosts the WebView may treat as this app. Comparison uses {@link Uri#getScheme()}
 * and {@link Uri#getHost()} exactly: https only, no suffix, contains, or wildcard.
 *
 * <p>{@code totalservicepro.netlify.app} is not listed. The shell's site is
 * https://repairplanet.net (and www). Netlify is a deploy alias, not a host
 * this app needs to embed.
 *
 * <p>{@code yljztfajyvjzqikxdddf.supabase.co} is the project's auth and API
 * host. It is not a page that receives the session or the JS bridge. Main-frame
 * navigations to it leave the WebView. Subframes on that host are cancelled:
 * the page calls Supabase with fetch, not with an iframe. {@code data:} and
 * {@code blob:} subframes are cancelled for the same reason.
 */
public final class TrustedOrigins {
    public static final String HOST_REPAIRPLANET = "repairplanet.net";
    public static final String HOST_WWW = "www.repairplanet.net";
    public static final String HOST_SUPABASE = "yljztfajyvjzqikxdddf.supabase.co";

    private TrustedOrigins() {}

    /**
     * @param scheme value from {@link Uri#getScheme()}
     * @param host value from {@link Uri#getHost()} (already lowercase, no port, no userinfo)
     */
    public static boolean allows(String scheme, String host) {
        if (scheme == null || host == null) return false;
        if (!"https".equals(scheme.toLowerCase(Locale.US))) return false;
        return HOST_REPAIRPLANET.equals(host)
                || HOST_WWW.equals(host)
                || HOST_SUPABASE.equals(host);
    }

    public static boolean allowsUrl(String url) {
        Uri uri = parse(url);
        if (uri == null) return false;
        return allows(uri.getScheme(), uri.getHost());
    }

    /** Live site pages. Session injection and the bridge are limited to these and bundled assets. */
    public static boolean isFirstPartyAppPage(String url) {
        Uri uri = parse(url);
        if (uri == null || uri.getScheme() == null || uri.getHost() == null) return false;
        if (!"https".equals(uri.getScheme().toLowerCase(Locale.US))) return false;
        String host = uri.getHost();
        return HOST_REPAIRPLANET.equals(host) || HOST_WWW.equals(host);
    }

    public static boolean isBundledAsset(String url) {
        return url != null && url.startsWith("file:///android_asset/");
    }

    public static boolean isSessionPage(String url) {
        return isFirstPartyAppPage(url) || isBundledAsset(url);
    }

    /** Google or this project's Supabase authorize URL. Opens in a Custom Tab. */
    public static boolean isAuthStart(String url) {
        Uri uri = parse(url);
        if (uri == null || uri.getScheme() == null || uri.getHost() == null) return false;
        if (!"https".equals(uri.getScheme().toLowerCase(Locale.US))) return false;
        String host = uri.getHost();
        if ("accounts.google.com".equals(host) || "accounts.youtube.com".equals(host)) return true;
        String path = uri.getPath() == null ? "" : uri.getPath();
        return HOST_SUPABASE.equals(host) && path.startsWith("/auth/v1/authorize");
    }

    /**
     * Subframe navigations that may stay inside the WebView. Everything else
     * is cancelled. This does not grant session injection.
     * First-party https pages and bundled assets may load. data:, blob:, and
     * the Supabase host may not: those frames would see addJavascriptInterface.
     */
    public static boolean subframeMayLoad(String url) {
        if (isBundledAsset(url)) return true;
        Uri uri = parse(url);
        if (uri == null || uri.getScheme() == null) return false;
        return subframeAllowed(uri.getScheme(), uri.getHost());
    }

    /**
     * Scheme and host as {@link Uri#getScheme()} and {@link Uri#getHost()}
     * return them. Host is null for data: and blob: URLs.
     */
    public static boolean subframeAllowed(String scheme, String host) {
        if (scheme == null) return false;
        String normalized = scheme.toLowerCase(Locale.US);
        if ("https".equals(normalized)) {
            return HOST_REPAIRPLANET.equals(host) || HOST_WWW.equals(host);
        }
        return "about".equals(normalized) || "javascript".equals(normalized);
    }

    public static boolean isAuthCallback(String url) {
        Uri uri = parse(url);
        if (uri == null || uri.getScheme() == null) return false;
        String scheme = uri.getScheme().toLowerCase(Locale.US);
        if ("totalservicepro".equals(scheme)) {
            return "auth-callback".equals(uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US));
        }
        if (!isFirstPartyAppPage(url)) return false;
        String path = uri.getPath() == null ? "" : uri.getPath();
        return "/auth/callback".equals(path);
    }

    private static Uri parse(String url) {
        if (url == null || url.isEmpty()) return null;
        try {
            return Uri.parse(url);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
