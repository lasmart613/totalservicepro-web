package com.photometrytools;

import java.util.function.Function;

/**
 * Builds a Google Maps https search URL from an opaque {@code geo:} URI.
 * {@code Uri.parse("geo:0,0?q=...").getQueryParameter("q")} throws
 * UnsupportedOperationException because geo URIs are not hierarchical.
 */
public final class GeoMapsUrl {
    private GeoMapsUrl() {}

    /**
     * Encoded text after the first {@code ?q=}, up to the next {@code &}.
     * Null when there is no query.
     */
    public static String queryAfterQ(String geoUrl) {
        if (geoUrl == null) return null;
        int marker = geoUrl.indexOf("?q=");
        if (marker < 0) return null;
        int start = marker + "?q=".length();
        if (start > geoUrl.length()) return null;
        int end = geoUrl.indexOf('&', start);
        String raw = end >= 0 ? geoUrl.substring(start, end) : geoUrl.substring(start);
        return raw.isEmpty() ? null : raw;
    }

    /**
     * {@code geo:0,0?q=} → {@code https://www.google.com/maps/search/?api=1&query=}.
     * {@code decode} is {@code Uri.decode} on Android. Null when the address is empty.
     */
    public static String mapsSearchUrlFromGeo(
            String geoUrl,
            Function<String, String> decode,
            Function<String, String> encode) {
        String raw = queryAfterQ(geoUrl);
        if (raw == null) return null;
        String decoded = decode.apply(raw);
        if (decoded == null || decoded.trim().isEmpty()) return null;
        String encoded = encode.apply(decoded);
        if (encoded == null || encoded.isEmpty()) return null;
        // URLEncoder and URLSearchParams write spaces as '+'. Android Uri.encode
        // and encodeURIComponent write '%20'. A raw '+' here is always a space
        // from a form encoder (a real plus is already '%2B'), so normalize it.
        encoded = encoded.replace("+", "%20");
        return "https://www.google.com/maps/search/?api=1&query=" + encoded;
    }
}
