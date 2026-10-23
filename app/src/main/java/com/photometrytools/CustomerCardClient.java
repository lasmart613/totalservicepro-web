package com.photometrytools;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;

/**
 * Writes a confirmed card with the signed-in Supabase session.
 * Recognition never comes here — only fields the user tapped Save on.
 * The card image is not part of this request.
 */
public final class CustomerCardClient {
    private CustomerCardClient() {}

    public interface Transport {
        Result send(String method, String url, String body, String token, String anon, String prefer);
    }

    public static final class Result {
        public final int status;
        public final String body;
        public final String transportError;

        private Result(int status, String body, String transportError) {
            this.status = status;
            this.body = body == null ? "" : body;
            this.transportError = transportError;
        }

        public static Result http(int status, String body) {
            return new Result(status, body, null);
        }

        public static Result failed(String message) {
            return new Result(0, "", message == null ? "Save failed." : message);
        }
    }

    public static final class SaveResult {
        public final boolean done;
        public final boolean saved;
        public final boolean queued;
        public final String organizationId;
        public final BusinessCardFields fields;
        public final String title;
        public final String message;
        public final String draftsJson;

        private SaveResult(boolean done, boolean saved, boolean queued, String organizationId,
                           BusinessCardFields fields, String title, String message, String draftsJson) {
            this.done = done;
            this.saved = saved;
            this.queued = queued;
            this.organizationId = organizationId;
            this.fields = fields == null ? new BusinessCardFields() : fields;
            this.title = title;
            this.message = message;
            this.draftsJson = draftsJson == null ? "[]" : draftsJson;
        }

        static SaveResult stay(String message, String draftsJson, BusinessCardFields fields) {
            return new SaveResult(false, false, false, null, fields, null, message, draftsJson);
        }

        static SaveResult queued(CustomerCardDrafts.Draft draft, String draftsJson) {
            return new SaveResult(true, false, true, draft.organizationId, draft.fields,
                    "Saved on this device", CardScanContract.QUEUED_MESSAGE, draftsJson);
        }

        static SaveResult saved(CustomerCardDrafts.Draft draft, String draftsJson) {
            String title = "update".equals(draft.mode) ? "Customer updated" : "Customer saved";
            return new SaveResult(true, true, false, draft.organizationId, draft.fields,
                    title, CardScanContract.SAVED_MESSAGE, draftsJson);
        }
    }

    public static Transport httpTransport() {
        return new Transport() {
            @Override
            public Result send(String method, String url, String body, String token, String anon, String prefer) {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setRequestMethod(method);
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(20000);
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                    connection.setRequestProperty("apikey", anon);
                    connection.setRequestProperty("Accept", "application/json");
                    if (prefer != null && !prefer.isEmpty()) connection.setRequestProperty("Prefer", prefer);
                    if (body != null) {
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        connection.setDoOutput(true);
                        connection.setRequestProperty("Content-Type", "application/json");
                        OutputStream out = connection.getOutputStream();
                        out.write(bytes);
                        out.close();
                    }
                    int status = connection.getResponseCode();
                    InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    return Result.http(status, read(stream));
                } catch (Exception e) {
                    return Result.failed("You appear to be offline. This card stays on the device until it can sync.");
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
        };
    }

    public static SaveResult save(CustomerCardDrafts.Draft draft, String sessionJson, boolean online,
                                  String draftsJson, Transport transport) {
        CustomerCardDrafts.Draft current = draft == null ? CustomerCardDrafts.newDraft("create", null, null) : draft.copy();
        current.fields = current.fields == null ? new BusinessCardFields() : current.fields.trimmed();
        String store = draftsJson == null ? "[]" : draftsJson;
        if (!current.fields.hasAnyValue()) {
            return SaveResult.stay("Enter at least one field from the card.", store, current.fields);
        }
        if ("create".equals(current.mode) && current.fields.company.isEmpty()) {
            return SaveResult.stay("Company is required. It becomes the customer name.", store, current.fields);
        }
        if (!online) {
            current.lastError = "Waiting for a network connection.";
            current.pauseAutoRetry = false;
            return SaveResult.queued(current, CustomerCardDrafts.upsert(store, current));
        }
        String token = CardScanContract.accessTokenFromSession(sessionJson);
        String userId = CardScanContract.userIdFromAccessToken(token);
        if (token.isEmpty() || userId.isEmpty()) {
            return SaveResult.stay("Sign in again before saving this customer.", store, current.fields);
        }
        if ("update".equals(current.mode) && (current.organizationId == null || current.organizationId.isEmpty())) {
            return SaveResult.stay("Open a customer profile, then use Update from card.", store, current.fields);
        }
        store = flush(store, token, userId, transport);
        try {
            commit(current, token, userId, transport);
            return SaveResult.saved(current, CustomerCardDrafts.remove(store, current.id));
        } catch (JSONException e) {
            return SaveResult.stay("Save failed.", store, current.fields);
        } catch (CardFailure failure) {
            if (failure.retryable || (current.organizationId != null && !current.organizationId.isEmpty())) {
                current.lastError = failure.message;
                current.pauseAutoRetry = !failure.retryable;
                String kept = CustomerCardDrafts.upsert(store, current);
                if (failure.retryable) return SaveResult.queued(current, kept);
                return SaveResult.stay(failure.message, kept, current.fields);
            }
            return SaveResult.stay(failure.message, store, current.fields);
        }
    }

    public static BusinessCardFields fetchFields(String organizationId, String sessionJson, Transport transport) {
        String token = CardScanContract.accessTokenFromSession(sessionJson);
        String userId = CardScanContract.userIdFromAccessToken(token);
        if (organizationId == null || organizationId.isEmpty() || token.isEmpty() || userId.isEmpty() || transport == null) {
            return null;
        }
        try {
            JSONArray orgs = select("organizations",
                    query("id", "eq." + organizationId,
                            "select", "name,address,city,state,zip,phone,email,contact_name,website",
                            "limit", "1"),
                    token, transport);
            if (orgs.length() == 0) return null;
            JSONArray contacts = select("contacts",
                    query("organization_id", "eq." + organizationId,
                            "is_primary", "eq.true",
                            "select", "first_name,last_name,title,phone,email",
                            "limit", "1"),
                    token, transport);
            JSONObject contact = contacts.length() == 0 ? null : contacts.optJSONObject(0);
            return fieldsFrom(orgs.getJSONObject(0), contact);
        } catch (Exception e) {
            return null;
        }
    }

    static String flush(String draftsJson, String token, String userId, Transport transport) {
        String store = draftsJson == null ? "[]" : draftsJson;
        if (token == null || token.isEmpty() || userId == null || userId.isEmpty() || transport == null) return store;
        List<CustomerCardDrafts.Draft> drafts = CustomerCardDrafts.all(store);
        for (CustomerCardDrafts.Draft draft : drafts) {
            if (draft.pauseAutoRetry) continue;
            CustomerCardDrafts.Draft current = draft.copy();
            try {
                commit(current, token, userId, transport);
                store = CustomerCardDrafts.remove(store, current.id);
            } catch (JSONException e) {
                current.lastError = "Save failed.";
                current.pauseAutoRetry = true;
                store = CustomerCardDrafts.upsert(store, current);
            } catch (CardFailure failure) {
                current.lastError = failure.message;
                current.pauseAutoRetry = !failure.retryable;
                store = CustomerCardDrafts.upsert(store, current);
            }
        }
        return store;
    }

    private static void commit(CustomerCardDrafts.Draft draft, String token, String userId, Transport transport)
            throws CardFailure, JSONException {
        String anon = BillingManager.supabaseAnonKey();
        if ("create".equals(draft.mode)) {
            String serviceId = serviceOrganizationId(token, userId, anon, transport);
            if (draft.organizationId == null || draft.organizationId.isEmpty()) {
                JSONObject created = write("POST", "organizations", "",
                        CustomerCardPayload.organizationInsert(draft.fields, userId),
                        "return=representation", token, anon, transport);
                String id = stringValue(created.opt("id"));
                if (id == null) throw CardFailure.rejected("The customer was not created.");
                draft.organizationId = id;
                draft.needsLink = true;
            } else {
                write("PATCH", "organizations", query("id", "eq." + draft.organizationId),
                        CustomerCardPayload.organizationUpdate(draft.fields),
                        "return=minimal", token, anon, transport);
            }
            if (draft.needsLink && draft.organizationId != null) {
                try {
                    write("POST", "organization_customers", "",
                            CustomerCardPayload.linkInsert(serviceId, draft.organizationId, userId),
                            "return=minimal", token, anon, transport);
                    draft.needsLink = false;
                } catch (CardFailure failure) {
                    if (!isDuplicate(failure.message)) throw failure;
                    draft.needsLink = false;
                }
            }
            if (draft.organizationId != null && !draft.contactSynced) {
                syncContact(draft.organizationId, draft.fields, token, anon, transport);
                draft.contactSynced = true;
            }
            return;
        }
        write("PATCH", "organizations", query("id", "eq." + draft.organizationId),
                CustomerCardPayload.organizationUpdate(draft.fields),
                "return=minimal", token, anon, transport);
        if (!draft.contactSynced) {
            syncContact(draft.organizationId, draft.fields, token, anon, transport);
            draft.contactSynced = true;
        }
    }

    private static String serviceOrganizationId(String token, String userId, String anon, Transport transport)
            throws CardFailure {
        JSONArray rows = select("user_profiles",
                query("id", "eq." + userId, "select", "organization_id", "limit", "1"),
                token, transport);
        String id = rows.length() == 0 ? null : stringValue(rows.optJSONObject(0) == null
                ? null : rows.optJSONObject(0).opt("organization_id"));
        if (id == null) {
            throw CardFailure.rejected("Your service organization is not loaded yet. Open Customers while online, then save this card again.");
        }
        return id;
    }

    private static void syncContact(String organizationId, BusinessCardFields fields, String token, String anon,
                                    Transport transport) {
        try {
            JSONObject update = CustomerCardPayload.contactUpdate(fields);
            if (update.length() == 0) return;
            String existing = null;
            JSONArray primary = select("contacts",
                    query("organization_id", "eq." + organizationId,
                            "is_primary", "eq.true",
                            "select", "id",
                            "limit", "1"),
                    token, transport);
            if (primary.length() > 0 && primary.optJSONObject(0) != null) {
                existing = stringValue(primary.optJSONObject(0).opt("id"));
            }
            if (existing == null && !BusinessCardFields.trim(fields.email).isEmpty()) {
                JSONArray byEmail = select("contacts",
                        query("organization_id", "eq." + organizationId,
                                "email", "eq." + BusinessCardFields.trim(fields.email),
                                "select", "id",
                                "limit", "1"),
                        token, transport);
                if (byEmail.length() > 0 && byEmail.optJSONObject(0) != null) {
                    existing = stringValue(byEmail.optJSONObject(0).opt("id"));
                }
            }
            if (existing != null) {
                write("PATCH", "contacts", query("id", "eq." + existing), update, "return=minimal", token, anon, transport);
            } else {
                JSONObject insert = CustomerCardPayload.contactInsert(organizationId, fields);
                if (insert != null) {
                    write("POST", "contacts", "", insert, "return=minimal", token, anon, transport);
                }
            }
        } catch (Exception ignored) {
            // The customer row is the source of truth. A contact-row miss can be edited on the profile.
        }
    }

    private static JSONArray select(String table, String query, String token, Transport transport) throws CardFailure {
        Result result = transport.send("GET", rest(table, query), null, token, BillingManager.supabaseAnonKey(), null);
        if (result.transportError != null) throw CardFailure.retryable(result.transportError);
        if (result.status < 200 || result.status >= 300) throw failure(result);
        try {
            if (result.body.isEmpty()) return new JSONArray();
            return new JSONArray(result.body);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static JSONObject write(String method, String table, String query, JSONObject body, String prefer,
                                    String token, String anon, Transport transport) throws CardFailure {
        JSONObject payload = copy(body);
        String last = "Save failed.";
        for (int attempt = 0; attempt < 8; attempt++) {
            Result result = transport.send(method, rest(table, query), payload.toString(), token, anon, prefer);
            if (result.transportError != null) throw CardFailure.retryable(result.transportError);
            if (result.status >= 200 && result.status < 300) return parseRow(result.body);
            String message = serverMessage(result);
            last = message;
            String column = CustomerCardPayload.missingColumn(message);
            if (column != null && payload.has(column)) {
                payload.remove(column);
                continue;
            }
            throw failure(result);
        }
        throw CardFailure.rejected(last);
    }

    private static JSONObject copy(JSONObject body) {
        JSONObject next = new JSONObject();
        if (body == null) return next;
        Iterator<String> keys = body.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            try {
                next.put(key, body.get(key));
            } catch (JSONException ignored) {
            }
        }
        return next;
    }

    private static JSONObject parseRow(String body) {
        if (body == null || body.isEmpty()) return new JSONObject();
        try {
            String trimmed = body.trim();
            if (trimmed.startsWith("[")) {
                JSONArray rows = new JSONArray(trimmed);
                if (rows.length() == 0 || rows.optJSONObject(0) == null) return new JSONObject();
                return rows.getJSONObject(0);
            }
            if (trimmed.startsWith("{")) return new JSONObject(trimmed);
        } catch (JSONException ignored) {
        }
        return new JSONObject();
    }

    private static CardFailure failure(Result result) {
        String message = serverMessage(result);
        if (result.status == 408 || result.status == 429 || result.status >= 500) {
            return CardFailure.retryable(message);
        }
        return CardFailure.rejected(message);
    }

    private static String serverMessage(Result result) {
        try {
            JSONObject json = new JSONObject(result.body);
            String[] keys = {"message", "error", "details", "hint"};
            for (String key : keys) {
                String value = json.optString(key, "");
                if (!value.isEmpty()) return value;
            }
        } catch (Exception ignored) {
        }
        String text = BusinessCardFields.trim(result.body);
        return text.isEmpty() ? "Save failed (" + result.status + ")." : text;
    }

    private static boolean isDuplicate(String message) {
        String lower = message == null ? "" : message.toLowerCase(java.util.Locale.US);
        return lower.contains("23505") || lower.contains("duplicate") || lower.contains("unique");
    }

    private static BusinessCardFields fieldsFrom(JSONObject org, JSONObject contact) {
        String first = contact == null ? "" : stringOrEmpty(contact.opt("first_name"));
        String last = contact == null ? "" : stringOrEmpty(contact.opt("last_name"));
        String contactName = (first + " " + last).trim();
        BusinessCardFields fields = new BusinessCardFields();
        fields.name = contactName.isEmpty() ? stringOrEmpty(org.opt("contact_name")) : contactName;
        fields.title = contact == null ? "" : stringOrEmpty(contact.opt("title"));
        fields.company = stringOrEmpty(org.opt("name"));
        String contactPhone = contact == null ? "" : stringOrEmpty(contact.opt("phone"));
        fields.phone = contactPhone.isEmpty() ? stringOrEmpty(org.opt("phone")) : contactPhone;
        String contactEmail = contact == null ? "" : stringOrEmpty(contact.opt("email"));
        fields.email = contactEmail.isEmpty() ? stringOrEmpty(org.opt("email")) : contactEmail;
        fields.address = stringOrEmpty(org.opt("address"));
        fields.city = stringOrEmpty(org.opt("city"));
        fields.state = stringOrEmpty(org.opt("state"));
        fields.zip = stringOrEmpty(org.opt("zip"));
        fields.website = stringOrEmpty(org.opt("website"));
        return fields;
    }

    private static String stringOrEmpty(Object value) {
        String text = stringValue(value);
        return text == null ? "" : text;
    }

    private static String stringValue(Object value) {
        if (value == null || value == JSONObject.NULL) return null;
        if (value instanceof String) {
            String trimmed = ((String) value).trim();
            return trimmed.isEmpty() ? null : trimmed;
        }
        if (value instanceof Number) return value.toString();
        return null;
    }

    static String rest(String table, String query) {
        String base = BillingManager.supabaseRest(table);
        if (query == null || query.isEmpty()) return base;
        return base + "?" + query;
    }

    static String query(String... pairs) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            if (sb.length() > 0) sb.append('&');
            sb.append(encode(pairs[i])).append('=').append(encode(pairs[i + 1]));
        }
        return sb.toString();
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return value == null ? "" : value;
        }
    }

    private static String read(InputStream stream) {
        if (stream == null) return "";
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = stream.read(buf)) >= 0) out.write(buf, 0, n);
            stream.close();
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    static final class CardFailure extends Exception {
        final boolean retryable;
        final String message;

        private CardFailure(boolean retryable, String message) {
            this.retryable = retryable;
            this.message = message == null ? "Save failed." : message;
        }

        static CardFailure retryable(String message) {
            return new CardFailure(true, message);
        }

        static CardFailure rejected(String message) {
            return new CardFailure(false, message);
        }
    }
}
