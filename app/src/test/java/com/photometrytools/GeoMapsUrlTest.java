package com.photometrytools;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Opaque geo: URIs must not go through Uri.getQueryParameter.
 * Decode/encode match android.net.Uri and encodeURIComponent: spaces are %20,
 * and a raw '+' is a plus. URLEncoder/URLDecoder (and Node URLSearchParams)
 * use '+' for spaces, so they are not the stand-in.
 * Run: javac these two classes, then java com.photometrytools.GeoMapsUrlTest
 */
public class GeoMapsUrlTest {
    private static final String UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";

    public static void main(String[] args) {
        eq(GeoMapsUrl.queryAfterQ("geo:0,0?q=Tempe%2C%20AZ"), "Tempe%2C%20AZ");
        eq(GeoMapsUrl.queryAfterQ("geo:0,0?q=Tempe%2C%20AZ&z=16"), "Tempe%2C%20AZ");
        eq(GeoMapsUrl.queryAfterQ("geo:0,0?q="), null);
        eq(GeoMapsUrl.queryAfterQ("geo:0,0"), null);
        eq(GeoMapsUrl.queryAfterQ(null), null);

        eq(url("geo:0,0?q=Tempe%2C%20AZ"),
                "https://www.google.com/maps/search/?api=1&query=Tempe%2C%20AZ");
        eq(url("geo:0,0?q=100%20Main%20St%2C%20Evanston%2C%20IL%2060201"),
                "https://www.google.com/maps/search/?api=1&query=100%20Main%20St%2C%20Evanston%2C%20IL%2060201");
        eq(url("geo:0,0?q=Tempe%2C%20AZ&z=16"),
                "https://www.google.com/maps/search/?api=1&query=Tempe%2C%20AZ");
        eq(url("geo:0,0?q="), null);
        eq(url("geo:0,0"), null);
        eq(url(null), null);
        eq(url("geo:0,0?q=%20%20"), null);
        // A raw '+' is a plus, not a space (Uri.decode / decodeURIComponent).
        eq(url("geo:0,0?q=Tempe,+AZ"),
                "https://www.google.com/maps/search/?api=1&query=Tempe%2C%2BAZ");
        eq(url("geo:0,0?q=Fun%21"),
                "https://www.google.com/maps/search/?api=1&query=Fun!");
        // URLEncoder writes spaces as '+'. The implementation must still emit %20.
        eq(GeoMapsUrl.mapsSearchUrlFromGeo(
                        "geo:0,0?q=Tempe%2C%20AZ",
                        GeoMapsUrlTest::decode,
                        GeoMapsUrlTest::formEncode),
                "https://www.google.com/maps/search/?api=1&query=Tempe%2C%20AZ");
        eq(GeoMapsUrl.mapsSearchUrlFromGeo(
                        "geo:0,0?q=100%20Main%20St%2C%20Evanston%2C%20IL%2060201",
                        GeoMapsUrlTest::decode,
                        GeoMapsUrlTest::formEncode),
                "https://www.google.com/maps/search/?api=1&query=100%20Main%20St%2C%20Evanston%2C%20IL%2060201");
        System.out.println("GeoMapsUrlTest ok");
    }

    private static String url(String geo) {
        return GeoMapsUrl.mapsSearchUrlFromGeo(geo, GeoMapsUrlTest::decode, GeoMapsUrlTest::encode);
    }

    /** Stand-in for android.net.Uri.decode. Percent-decoding only; '+' is not a space. */
    private static String decode(String raw) {
        if (raw == null) return null;
        StringBuilder out = new StringBuilder();
        byte[] utf8 = new byte[raw.length()];
        int n = 0;
        for (int i = 0; i < raw.length(); ) {
            char c = raw.charAt(i);
            if (c == '%' && i + 2 < raw.length()) {
                int hi = Character.digit(raw.charAt(i + 1), 16);
                int lo = Character.digit(raw.charAt(i + 2), 16);
                if (hi >= 0 && lo >= 0) {
                    utf8[n++] = (byte) ((hi << 4) + lo);
                    i += 3;
                    continue;
                }
            }
            if (n > 0) {
                out.append(new String(utf8, 0, n, StandardCharsets.UTF_8));
                n = 0;
            }
            out.append(c);
            i++;
        }
        if (n > 0) out.append(new String(utf8, 0, n, StandardCharsets.UTF_8));
        return out.toString();
    }

    /** Stand-in for android.net.Uri.encode / encodeURIComponent. Spaces are %20. */
    private static String encode(String value) {
        StringBuilder out = new StringBuilder();
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        for (byte b : bytes) {
            int c = b & 0xFF;
            if (UNRESERVED.indexOf(c) >= 0) {
                out.append((char) c);
            } else {
                out.append('%');
                out.append(Character.toUpperCase(Character.forDigit((c >> 4) & 0xF, 16)));
                out.append(Character.toUpperCase(Character.forDigit(c & 0xF, 16)));
            }
        }
        return out.toString();
    }

    /** application/x-www-form-urlencoded. Spaces are '+'. Used only to prove normalization. */
    private static String formEncode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void eq(String actual, String expected) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("expected <" + expected + "> but was <" + actual + ">");
        }
    }
}
