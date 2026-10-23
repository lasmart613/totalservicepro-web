package com.photometrytools;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Page URL, bridge payload, and on-device line grouping shared with the iOS card scan. */
public final class CardScanContract {
    public static final String ERR_CANCELLED = "Cancelled";
    public static final String ERR_BUSY = "A card scan is already open.";
    public static final String ERR_CAMERA = "A camera is required to scan a business card.";
    public static final String QUEUED_MESSAGE =
            "This customer is queued on the device. It will sync to your directory when a connection is available.";
    public static final String SAVED_MESSAGE =
            "Saved from the card you confirmed. The customer page will refresh.";

    private CardScanContract() {}

    public static final class Page {
        public static final Page NONE = new Page("none", null);
        public static final Page DIRECTORY = new Page("directory", null);

        public final String kind;
        public final String profileId;

        private Page(String kind, String profileId) {
            this.kind = kind;
            this.profileId = profileId;
        }

        public static Page profile(String id) {
            return new Page("profile", id);
        }

        public boolean isProfile() {
            return "profile".equals(kind);
        }
    }

    public static Page resolvePage(String url) {
        if (url == null || url.isEmpty()) return Page.NONE;
        URI uri;
        try {
            uri = new URI(url);
        } catch (Exception e) {
            return Page.NONE;
        }
        String path = uri.getPath() == null ? "" : uri.getPath();
        String fileName = lastSegment(path).toLowerCase(Locale.US);
        if ("customer_directory.html".equals(fileName)) return Page.DIRECTORY;
        if ("customer_profile.html".equals(fileName)) {
            String id = queryParam(uri.getRawQuery(), "id");
            if (id == null || id.isEmpty()) return Page.NONE;
            return Page.profile(id);
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.US);
        boolean live = "repairplanet.net".equals(host) || host.endsWith(".repairplanet.net");
        boolean file = "file".equals(scheme);
        if (!live && !file) return Page.NONE;
        String[] parts = path.split("/");
        List<String> segments = new ArrayList<>();
        for (String part : parts) {
            if (!part.isEmpty()) segments.add(part);
        }
        if (segments.isEmpty() || !"customers".equals(segments.get(0).toLowerCase(Locale.US))) return Page.NONE;
        if (segments.size() == 1) return Page.DIRECTORY;
        if (segments.size() == 2) {
            String id = decode(segments.get(1));
            if (id.isEmpty()) return Page.NONE;
            String lower = id.toLowerCase(Locale.US);
            if ("new".equals(lower) || "layout".equals(lower) || "page".equals(lower)) return Page.NONE;
            return Page.profile(id);
        }
        return Page.NONE;
    }

    public static final class Request {
        public final String mode;
        public final String organizationId;
        /** Live customer form: confirm, then hand the fields back to the page. */
        public final boolean prefillForm;

        public Request(String mode, String organizationId) {
            this(mode, organizationId, false);
        }

        public Request(String mode, String organizationId, boolean prefillForm) {
            this.mode = mode;
            this.organizationId = organizationId;
            this.prefillForm = prefillForm;
        }
    }

    public static Request requestFrom(JSONObject payload, String pageUrl) {
        Page page = resolvePage(pageUrl);
        String mode = "";
        if (payload != null) mode = payload.optString("mode", "").toLowerCase(Locale.US);
        String explicit = firstString(payload, "organizationId");
        if (explicit == null) explicit = firstString(payload, "organization_id");
        if (explicit == null) explicit = firstString(payload, "id");
        boolean prefill = payload != null && payload.optBoolean("prefillForm", false);
        String profileId = page.isProfile() ? page.profileId : null;
        if ("update".equals(mode) || (mode.isEmpty() && profileId != null)) {
            return new Request("update", explicit != null ? explicit : profileId, prefill);
        }
        return new Request("create", null, prefill);
    }

    public static JSONObject outcomeJson(boolean saved, boolean queued, String organizationId, BusinessCardFields fields)
            throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("saved", saved);
        obj.put("queued", queued);
        obj.put("organizationId", organizationId == null ? "" : organizationId);
        obj.put("fields", fields == null ? new BusinessCardFields().bridgeJson() : fields.bridgeJson());
        return obj;
    }

    /** JWT {@code sub} from a Supabase access token. Manual base64url so API 24 can run it. */
    public static String userIdFromAccessToken(String accessToken) {
        if (accessToken == null) return "";
        String[] parts = accessToken.split("\\.");
        if (parts.length < 2) return "";
        byte[] data = decodeBase64Url(parts[1]);
        if (data == null) return "";
        try {
            JSONObject json = new JSONObject(new String(data, StandardCharsets.UTF_8));
            String subject = json.optString("sub", "");
            return subject == null ? "" : subject;
        } catch (Exception e) {
            return "";
        }
    }

    public static String accessTokenFromSession(String sessionJson) {
        if (sessionJson == null || sessionJson.isEmpty()) return "";
        try {
            JSONObject parsed = new JSONObject(sessionJson);
            JSONObject sess = parsed.has("currentSession") ? parsed.getJSONObject("currentSession") : parsed;
            return sess.optString("access_token", "");
        } catch (Exception e) {
            return "";
        }
    }

    public static final class Glyph {
        public final String text;
        public final float midY;
        public final float minX;

        public Glyph(String text, float midY, float minX) {
            this.text = text;
            this.midY = midY;
            this.minX = minX;
        }
    }

    /**
     * Groups glyphs into reading-order lines.
     * {@code height} is in the same unit as {@link Glyph#midY}. ML Kit's origin is the
     * top of the image, so lines sort by increasing midY. Vision's origin is the bottom;
     * the 0.02 grouping distance is the same once the axis is flipped.
     */
    public static List<String> groupLines(List<Glyph> glyphs, float height) {
        List<String> text = new ArrayList<>();
        if (glyphs == null || glyphs.isEmpty() || height <= 0f) return text;
        List<Glyph> sorted = new ArrayList<>();
        for (Glyph glyph : glyphs) {
            if (glyph == null || glyph.text == null || glyph.text.trim().isEmpty()) continue;
            sorted.add(glyph);
        }
        Collections.sort(sorted, new Comparator<Glyph>() {
            @Override
            public int compare(Glyph a, Glyph b) {
                return Float.compare(a.midY, b.midY);
            }
        });
        float threshold = 0.02f * height;
        List<List<Glyph>> lines = new ArrayList<>();
        for (Glyph glyph : sorted) {
            if (!lines.isEmpty()) {
                List<Glyph> current = lines.get(lines.size() - 1);
                if (Math.abs(current.get(0).midY - glyph.midY) < threshold) {
                    current.add(glyph);
                    continue;
                }
            }
            List<Glyph> line = new ArrayList<>();
            line.add(glyph);
            lines.add(line);
        }
        for (List<Glyph> line : lines) {
            Collections.sort(line, new Comparator<Glyph>() {
                @Override
                public int compare(Glyph a, Glyph b) {
                    return Float.compare(a.minX, b.minX);
                }
            });
            StringBuilder sb = new StringBuilder();
            for (Glyph glyph : line) {
                String piece = glyph.text.trim();
                if (piece.isEmpty()) continue;
                if (sb.length() > 0) sb.append(' ');
                sb.append(piece);
            }
            if (sb.length() > 0) text.add(sb.toString());
        }
        return text;
    }

    private static String firstString(JSONObject payload, String key) {
        if (payload == null || !payload.has(key)) return null;
        Object value = payload.opt(key);
        if (!(value instanceof String)) return null;
        String trimmed = BusinessCardFields.trim((String) value);
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String lastSegment(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? path : path.substring(slash + 1);
    }

    private static String queryParam(String rawQuery, String name) {
        if (rawQuery == null || rawQuery.isEmpty()) return "";
        String[] pairs = rawQuery.split("&");
        for (String pair : pairs) {
            int eq = pair.indexOf('=');
            String key = eq < 0 ? pair : pair.substring(0, eq);
            if (!name.equals(decode(key))) continue;
            return eq < 0 ? "" : decode(pair.substring(eq + 1)).trim();
        }
        return "";
    }

    private static String decode(String value) {
        if (value == null) return "";
        try {
            return java.net.URLDecoder.decode(value.replace("+", "%2B"), "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    static byte[] decodeBase64Url(String value) {
        if (value == null || value.isEmpty()) return null;
        StringBuilder alphabet = new StringBuilder(value.length() + 3);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '-') alphabet.append('+');
            else if (c == '_') alphabet.append('/');
            else alphabet.append(c);
        }
        int remainder = alphabet.length() % 4;
        if (remainder != 0) {
            for (int i = 0; i < 4 - remainder; i++) alphabet.append('=');
        }
        return decodeBase64(alphabet.toString());
    }

    private static byte[] decodeBase64(String data) {
        int[] table = new int[128];
        Arrays.fill(table, -1);
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < alphabet.length(); i++) table[alphabet.charAt(i)] = i;
        int buffer = 0;
        int bits = 0;
        List<Byte> bytes = new ArrayList<>();
        for (int i = 0; i < data.length(); i++) {
            char c = data.charAt(i);
            if (c == '=') break;
            if (c >= 128 || table[c] < 0) return null;
            buffer = (buffer << 6) | table[c];
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                bytes.add((byte) ((buffer >> bits) & 0xFF));
            }
        }
        byte[] out = new byte[bytes.size()];
        for (int i = 0; i < bytes.size(); i++) out[i] = bytes.get(i);
        return out;
    }
}
