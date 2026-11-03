package com.photometrytools;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * JSON bodies for the same organizations / organization_customers / contacts
 * writes the live Customers pages perform. Empty fields are omitted.
 */
public final class CustomerCardPayload {
    private static final Pattern[] MISSING_COLUMN = new Pattern[]{
            Pattern.compile("Could not find the '([^']+)' column", Pattern.CASE_INSENSITIVE),
            Pattern.compile("column \"([^\"]+)\" of relation", Pattern.CASE_INSENSITIVE)
    };

    private CustomerCardPayload() {}

    public static String ticketPrefix(String company) {
        StringBuilder alphanumeric = new StringBuilder();
        if (company != null) {
            for (int i = 0; i < company.length(); i++) {
                char c = company.charAt(i);
                if (Character.isLetterOrDigit(c)) alphanumeric.append(c);
            }
        }
        if (alphanumeric.length() == 0) return "CUS";
        int end = Math.min(3, alphanumeric.length());
        return alphanumeric.substring(0, end).toUpperCase(Locale.US);
    }

    public static JSONObject organizationInsert(BusinessCardFields fields, String userId) throws JSONException {
        JSONObject body = organizationFields(fields);
        body.put("name", BusinessCardFields.trim(fields == null ? "" : fields.company));
        body.put("type", "customer");
        body.put("is_active", true);
        body.put("ticket_prefix", ticketPrefix(fields == null ? "" : fields.company));
        if (userId != null && !userId.isEmpty()) body.put("created_by", userId);
        return body;
    }

    public static JSONObject organizationUpdate(BusinessCardFields fields) throws JSONException {
        return organizationUpdate(fields, new Date());
    }

    static JSONObject organizationUpdate(BusinessCardFields fields, Date now) throws JSONException {
        JSONObject body = organizationFields(fields);
        String company = BusinessCardFields.trim(fields == null ? "" : fields.company);
        if (!company.isEmpty()) body.put("name", company);
        body.put("updated_at", iso8601(now == null ? new Date() : now));
        return body;
    }

    public static JSONObject linkInsert(String serviceOrganizationId, String customerOrganizationId, String userId)
            throws JSONException {
        JSONObject body = new JSONObject();
        body.put("service_organization_id", serviceOrganizationId == null ? "" : serviceOrganizationId);
        body.put("customer_organization_id", customerOrganizationId == null ? "" : customerOrganizationId);
        if (userId != null && !userId.isEmpty()) body.put("created_by", userId);
        return body;
    }

    public static JSONObject contactInsert(String organizationId, BusinessCardFields fields) throws JSONException {
        JSONObject body = contactFields(fields);
        if (body.length() == 0) return null;
        body.put("organization_id", organizationId == null ? "" : organizationId);
        body.put("is_primary", true);
        return body;
    }

    public static JSONObject contactUpdate(BusinessCardFields fields) throws JSONException {
        return contactUpdate(fields, new Date());
    }

    static JSONObject contactUpdate(BusinessCardFields fields, Date now) throws JSONException {
        JSONObject body = contactFields(fields);
        if (body.length() > 0) body.put("updated_at", iso8601(now == null ? new Date() : now));
        return body;
    }

    /**
     * PostgREST schema-cache errors name a column we can drop and retry.
     * Null-value errors are not column drops.
     */
    public static String missingColumn(String message) {
        if (message == null) return null;
        for (Pattern pattern : MISSING_COLUMN) {
            Matcher matcher = pattern.matcher(message);
            if (!matcher.find() || matcher.groupCount() < 1) continue;
            String column = matcher.group(1);
            if (column != null && !column.isEmpty()) return column;
        }
        return null;
    }

    public static String[] splitPersonName(String name) {
        String[] raw = BusinessCardFields.trim(name).split("\\s+");
        java.util.ArrayList<String> words = new java.util.ArrayList<>();
        for (String word : raw) {
            if (!word.isEmpty()) words.add(word);
        }
        java.util.Set<String> honorifics = new java.util.HashSet<>(java.util.Arrays.asList(
                "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof."
        ));
        while (!words.isEmpty() && honorifics.contains(words.get(0).toLowerCase(Locale.US))) {
            words.remove(0);
        }
        if (words.isEmpty()) return new String[]{"", ""};
        String first = words.get(0);
        StringBuilder last = new StringBuilder();
        for (int i = 1; i < words.size(); i++) {
            if (last.length() > 0) last.append(' ');
            last.append(words.get(i));
        }
        return new String[]{first, last.toString()};
    }

    private static JSONObject organizationFields(BusinessCardFields fields) throws JSONException {
        BusinessCardFields value = fields == null ? new BusinessCardFields() : fields.trimmed();
        JSONObject body = new JSONObject();
        put(body, "phone", value.phone);
        put(body, "email", value.email);
        put(body, "address", value.address);
        put(body, "city", value.city);
        put(body, "state", value.state.toUpperCase(Locale.US));
        put(body, "zip", value.zip);
        put(body, "website", value.website);
        put(body, "contact_name", value.name);
        return body;
    }

    private static JSONObject contactFields(BusinessCardFields fields) throws JSONException {
        BusinessCardFields value = fields == null ? new BusinessCardFields() : fields.trimmed();
        JSONObject body = new JSONObject();
        String[] parts = splitPersonName(value.name);
        put(body, "first_name", parts[0]);
        put(body, "last_name", parts[1]);
        put(body, "title", value.title);
        put(body, "phone", value.phone);
        put(body, "email", value.email);
        return body;
    }

    private static void put(JSONObject body, String key, String value) throws JSONException {
        String trimmed = BusinessCardFields.trim(value);
        if (!trimmed.isEmpty()) body.put(key, trimmed);
    }

    static String iso8601(Date date) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(date);
    }
}
