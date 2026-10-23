package com.photometrytools;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Confirmed card fields still waiting to be written. The photo is never stored.
 */
public final class CustomerCardDrafts {
    private CustomerCardDrafts() {}

    public static final class Draft {
        public String id;
        public String userId;
        public String mode;
        public String organizationId;
        public boolean needsLink;
        public boolean contactSynced;
        public BusinessCardFields fields = new BusinessCardFields();
        public long createdAt;
        public String lastError;
        public boolean pauseAutoRetry;

        public Draft copy() {
            Draft next = new Draft();
            next.id = id;
            next.userId = userId;
            next.mode = mode;
            next.organizationId = organizationId;
            next.needsLink = needsLink;
            next.contactSynced = contactSynced;
            next.fields = fields == null ? new BusinessCardFields() : fields.copy();
            next.createdAt = createdAt;
            next.lastError = lastError;
            next.pauseAutoRetry = pauseAutoRetry;
            return next;
        }
    }

    public static Draft newDraft(String mode, String organizationId, BusinessCardFields fields) {
        Draft draft = new Draft();
        draft.id = UUID.randomUUID().toString();
        draft.mode = mode == null ? "create" : mode;
        draft.organizationId = "update".equals(draft.mode) ? organizationId : null;
        draft.needsLink = "create".equals(draft.mode);
        draft.contactSynced = false;
        draft.fields = fields == null ? new BusinessCardFields() : fields.trimmed();
        draft.createdAt = System.currentTimeMillis();
        draft.pauseAutoRetry = false;
        return draft;
    }

    public static List<Draft> all(String json) {
        List<Draft> drafts = new ArrayList<>();
        if (json == null || json.isEmpty()) return drafts;
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                Draft draft = fromJson(array.optJSONObject(i));
                if (draft != null) drafts.add(draft);
            }
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
        Collections.sort(drafts, new Comparator<Draft>() {
            @Override
            public int compare(Draft a, Draft b) {
                return Long.compare(a.createdAt, b.createdAt);
            }
        });
        return drafts;
    }

    public static String upsert(String json, Draft draft) {
        if (draft == null) return json == null ? "[]" : json;
        List<Draft> drafts = all(json);
        List<Draft> next = new ArrayList<>();
        for (Draft existing : drafts) {
            if (existing.id != null && existing.id.equals(draft.id)) continue;
            next.add(existing);
        }
        next.add(draft);
        return write(next);
    }

    public static String remove(String json, String id) {
        List<Draft> next = new ArrayList<>();
        for (Draft existing : all(json)) {
            if (id != null && id.equals(existing.id)) continue;
            next.add(existing);
        }
        return write(next);
    }

    public static JSONObject toJson(Draft draft) throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("id", draft.id == null ? "" : draft.id);
        obj.put("userId", draft.userId == null ? "" : draft.userId);
        obj.put("mode", draft.mode == null ? "create" : draft.mode);
        obj.put("organizationId", draft.organizationId == null ? "" : draft.organizationId);
        obj.put("needsLink", draft.needsLink);
        obj.put("contactSynced", draft.contactSynced);
        obj.put("fields", draft.fields == null ? new BusinessCardFields().bridgeJson() : draft.fields.bridgeJson());
        obj.put("createdAt", draft.createdAt);
        if (draft.lastError != null) obj.put("lastError", draft.lastError);
        obj.put("pauseAutoRetry", draft.pauseAutoRetry);
        return obj;
    }

    public static Draft fromJson(JSONObject obj) {
        if (obj == null) return null;
        Draft draft = new Draft();
        draft.id = obj.optString("id", "");
        String owner = obj.optString("userId", "");
        draft.userId = owner.isEmpty() ? null : owner;
        draft.mode = obj.optString("mode", "create");
        String org = obj.optString("organizationId", "");
        draft.organizationId = org.isEmpty() ? null : org;
        draft.needsLink = obj.optBoolean("needsLink", "create".equals(draft.mode));
        draft.contactSynced = obj.optBoolean("contactSynced", false);
        draft.fields = fieldsFrom(obj.optJSONObject("fields"));
        draft.createdAt = obj.optLong("createdAt", 0L);
        if (obj.has("lastError") && !obj.isNull("lastError")) draft.lastError = obj.optString("lastError", null);
        draft.pauseAutoRetry = obj.optBoolean("pauseAutoRetry", false);
        return draft;
    }

    private static BusinessCardFields fieldsFrom(JSONObject obj) {
        BusinessCardFields fields = new BusinessCardFields();
        if (obj == null) return fields;
        fields.name = obj.optString("name", "");
        fields.title = obj.optString("title", "");
        fields.company = obj.optString("company", "");
        fields.phone = obj.optString("phone", "");
        fields.email = obj.optString("email", "");
        fields.address = obj.optString("address", "");
        fields.city = obj.optString("city", "");
        fields.state = obj.optString("state", "");
        fields.zip = obj.optString("zip", "");
        fields.website = obj.optString("website", "");
        return fields;
    }

    private static String write(List<Draft> drafts) {
        JSONArray array = new JSONArray();
        for (Draft draft : drafts) {
            try {
                array.put(toJson(draft));
            } catch (JSONException ignored) {
            }
        }
        return array.toString();
    }
}
