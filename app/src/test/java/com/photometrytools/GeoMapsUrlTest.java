package com.photometrytools;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;

/**
 * Opaque geo: URIs must not go through Uri.getQueryParameter.
 * Run: javac these two classes, then java com.photometrytools.GeoMapsUrlTest
 */
public class GeoMapsUrlTest {
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
        System.out.println("GeoMapsUrlTest ok");
    }

    private static String url(String geo) {
        return GeoMapsUrl.mapsSearchUrlFromGeo(geo, GeoMapsUrlTest::decode, GeoMapsUrlTest::encode);
    }

    /** Stand-in for android.net.Uri.decode (percent-decoding, UTF-8). */
    private static String decode(String raw) {
        try {
            return URLDecoder.decode(raw, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Stand-in for android.net.Uri.encode (spaces as %20, not +). */
    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
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
