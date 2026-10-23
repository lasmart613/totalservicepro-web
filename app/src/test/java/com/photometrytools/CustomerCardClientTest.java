package com.photometrytools;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class CustomerCardClientTest {
    @Test
    public void offlineQueuesFieldsAndDoesNotCallTheNetwork() {
        List<String> calls = new ArrayList<>();
        CustomerCardClient.Transport transport = (method, url, body, token, anon, prefer) -> {
            calls.add(method + " " + url);
            return CustomerCardClient.Result.failed("should not be called");
        };
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Acme";
        fields.name = "Ada Lovelace";
        CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft("create", null, fields);
        CustomerCardClient.SaveResult result = CustomerCardClient.save(draft, "{}", false, "[]", transport);
        assertTrue(result.queued);
        assertFalse(result.saved);
        assertTrue(result.done);
        assertEquals(CardScanContract.QUEUED_MESSAGE, result.message);
        assertTrue(calls.isEmpty());
        assertEquals("Acme", CustomerCardDrafts.all(result.draftsJson).get(0).fields.company);
        assertFalse(result.draftsJson.contains("base64"));
    }

    @Test
    public void saveDropsAMissingColumnAndIgnoresADuplicateLink() throws Exception {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"sub\":\"user-1\"}".getBytes(StandardCharsets.UTF_8));
        String session = "{\"currentSession\":{\"access_token\":\"h." + payload + ".s\"}}";
        List<String> posts = new ArrayList<>();
        CustomerCardClient.Transport transport = (method, url, body, token, anon, prefer) -> {
            if ("GET".equals(method) && url.contains("user_profiles")) {
                return CustomerCardClient.Result.http(200, "[{\"organization_id\":\"svc-1\"}]");
            }
            if ("POST".equals(method) && url.contains("/organizations")) {
                posts.add(body);
                if (body.contains("website")) {
                    return CustomerCardClient.Result.http(400,
                            "{\"message\":\"Could not find the 'website' column of 'organizations' in the schema cache\"}");
                }
                return CustomerCardClient.Result.http(201, "[{\"id\":\"cust-1\"}]");
            }
            if ("POST".equals(method) && url.contains("organization_customers")) {
                return CustomerCardClient.Result.http(409, "{\"message\":\"duplicate key value violates unique constraint 23505\"}");
            }
            if ("GET".equals(method) && url.contains("contacts")) {
                return CustomerCardClient.Result.http(200, "[]");
            }
            if ("POST".equals(method) && url.contains("contacts")) {
                return CustomerCardClient.Result.http(201, "[]");
            }
            return CustomerCardClient.Result.http(500, "{\"message\":\"unexpected\"}");
        };
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Desert Dermatology, LLC";
        fields.name = "Jane Q. Smith";
        fields.phone = "602";
        fields.website = "https://desertderm.example";
        CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft("create", null, fields);
        CustomerCardClient.SaveResult result = CustomerCardClient.save(draft, session, true, "[]", transport);
        assertTrue(result.saved);
        assertFalse(result.queued);
        assertEquals("cust-1", result.organizationId);
        assertEquals(2, posts.size());
        assertFalse(new JSONObject(posts.get(1)).has("website"));
        assertTrue(CustomerCardDrafts.all(result.draftsJson).isEmpty());
    }

    @Test
    public void offlineSaveTagsTheSignedInUser() {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"sub\":\"user-1\"}".getBytes(StandardCharsets.UTF_8));
        String session = "{\"currentSession\":{\"access_token\":\"h." + payload + ".s\",\"refresh_token\":\"r\"}}";
        BusinessCardFields fields = new BusinessCardFields();
        fields.company = "Acme";
        CustomerCardDrafts.Draft draft = CustomerCardDrafts.newDraft("create", null, fields);
        CustomerCardClient.SaveResult result = CustomerCardClient.save(draft, session, false, "[]",
                (method, url, body, token, anon, prefer) -> CustomerCardClient.Result.failed("offline"));
        assertTrue(result.queued);
        assertEquals("user-1", CustomerCardDrafts.all(result.draftsJson).get(0).userId);
    }

    @Test
    public void flushUploadsOnlyTheSameUser() {
        BusinessCardFields mineFields = new BusinessCardFields();
        mineFields.company = "Acme";
        CustomerCardDrafts.Draft mine = CustomerCardDrafts.newDraft("create", null, mineFields);
        mine.userId = "user-1";
        BusinessCardFields otherFields = new BusinessCardFields();
        otherFields.company = "Other";
        CustomerCardDrafts.Draft other = CustomerCardDrafts.newDraft("create", null, otherFields);
        other.userId = "user-2";
        BusinessCardFields bareFields = new BusinessCardFields();
        bareFields.company = "Bare";
        CustomerCardDrafts.Draft bare = CustomerCardDrafts.newDraft("create", null, bareFields);
        String store = CustomerCardDrafts.upsert("[]", mine);
        store = CustomerCardDrafts.upsert(store, other);
        store = CustomerCardDrafts.upsert(store, bare);
        List<String> calls = new ArrayList<>();
        CustomerCardClient.Transport transport = (method, url, body, token, anon, prefer) -> {
            calls.add(method + " " + url);
            return CustomerCardClient.Result.http(500, "{}");
        };
        String skipped = CustomerCardClient.flush(store, "token", "user-9", transport);
        assertTrue(calls.isEmpty());
        assertEquals(3, CustomerCardDrafts.all(skipped).size());
        String flushed = CustomerCardClient.flush(store, "token", "user-1", transport);
        assertFalse(calls.isEmpty());
        boolean sawOther = false;
        boolean sawBare = false;
        boolean sawMine = false;
        for (CustomerCardDrafts.Draft draft : CustomerCardDrafts.all(flushed)) {
            if ("user-2".equals(draft.userId)) sawOther = true;
            if (draft.userId == null || draft.userId.isEmpty()) sawBare = true;
            if ("user-1".equals(draft.userId)) sawMine = true;
        }
        assertTrue(sawOther);
        assertTrue(sawBare);
        assertTrue(sawMine);
    }

    @Test
    public void signInDropsUntaggedAndOtherUsersDrafts() {
        BusinessCardFields mineFields = new BusinessCardFields();
        mineFields.company = "Acme";
        CustomerCardDrafts.Draft mine = CustomerCardDrafts.newDraft("create", null, mineFields);
        mine.userId = "user-1";
        BusinessCardFields otherFields = new BusinessCardFields();
        otherFields.company = "Other";
        CustomerCardDrafts.Draft other = CustomerCardDrafts.newDraft("create", null, otherFields);
        other.userId = "user-2";
        BusinessCardFields bareFields = new BusinessCardFields();
        bareFields.company = "Bare";
        CustomerCardDrafts.Draft bare = CustomerCardDrafts.newDraft("create", null, bareFields);
        String store = CustomerCardDrafts.upsert("[]", mine);
        store = CustomerCardDrafts.upsert(store, other);
        store = CustomerCardDrafts.upsert(store, bare);
        String kept = CustomerCardDrafts.keepForUser(store, "user-1");
        assertEquals(1, CustomerCardDrafts.all(kept).size());
        assertEquals("user-1", CustomerCardDrafts.all(kept).get(0).userId);
        assertEquals("Acme", CustomerCardDrafts.all(kept).get(0).fields.company);
    }
}
